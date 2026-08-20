/**
 * Web Speech API voice capture for a composer's mic button.
 *
 * Extracted from DeepSeek Harness (MIT) — packages/client/ui-conversation
 * — and generalized into a standalone library. The engine
 * (`SpeechRecognition` / `webkitSpeechRecognition`) is a browser-owned
 * service: only one instance per origin can listen at a time, and instances
 * can be restarted after their `end` event. This hook lazily creates ONE
 * instance per mount and reuses it across start/stop cycles, so repeated
 * dictation never leaks engine handles.
 *
 * Only FINAL results are reported: interim transcript noise must not pollute
 * the host's draft/undo log, so callers insert each finalized segment at the
 * caret as one ordinary draft transaction. Errors surface with the raw
 * engine code ('not-allowed', 'no-speech', 'network', 'audio-capture',
 * 'language-not-supported', ...); the caller localizes them ('aborted' is the
 * user/cleanup stop path and is never reported).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Structural SpeechRecognition type (lib.dom ships no Web Speech API declarations). */
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

/** Structural result-list view the hook reads (best-alternative transcript per segment). */
export interface SpeechRecognitionEventLike {
  readonly resultIndex: number
  readonly results: {
    readonly length: number
    [index: number]: {
      readonly isFinal: boolean
      readonly length: number
      [index: number]: { readonly transcript: string }
    }
  }
}

/** The vendor-prefixed constructor surface, if the browser exposes one. */
interface SpeechRecognitionCtor {
  new (): SpeechRecognitionLike
}

/** Resolve the browser's speech-recognition constructor (Chromium prefixes it). */
function recognitionCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition
}

/** Hook wiring: the caller's per-segment and per-error callbacks. */
export interface VoiceInputOptions {
  /** A finalized transcript segment, trimmed and non-empty. */
  onFinal: (text: string) => void
  /** Engine failure, reported with the raw error code ('aborted' is filtered by the hook). */
  onError: (code: string) => void
}

/** The control surface a composer button binds to. */
export interface VoiceInputControl {
  /** Whether the engine is currently capturing. */
  readonly listening: boolean
  /** Whether this browser exposes any speech-recognition constructor. */
  readonly supported: boolean
  /** Live (non-final) transcript of the current utterance; '' while idle. Display-only — never a draft write. */
  readonly interim: string
  /** Begin capturing; a no-op while already listening or when unsupported. */
  readonly start: () => void
  /** End capturing; pending final results flush through `onend` first. */
  readonly stop: () => void
}

/**
 * Voice capture state + lifecycle for one composer mount. `start`/`stop`
 * identities are stable (empty deps) so a caller can subscribe them in
 * effects without re-binding on every render; the per-call callbacks always
 * see the LATEST options through a ref.
 */
export function useVoiceInput(options: VoiceInputOptions): VoiceInputControl {
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [supported] = useState(() => recognitionCtor() !== undefined)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const stop = useCallback((): void => {
    // stop() triggers onend on every engine; the state flip lives there so a
    // stop initiated by the engine itself (silence timeout) renders identically.
    recognitionRef.current?.stop()
  }, [])

  const start = useCallback((): void => {
    const Ctor = recognitionCtor()
    if (Ctor === undefined || listening) return
    const existing = recognitionRef.current
    if (existing !== null) {
      // Reuse across cycles: an ended instance is restartable as-is; a live
      // one throws InvalidStateError — swallowed, the session keeps running.
      try {
        existing.start()
        setListening(true)
        setInterim('')
      } catch {
        // already started
      }
      return
    }
    const recognition = new Ctor()
    recognition.lang = navigator.language || ''
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 1
    recognition.onresult = (event): void => {
      // Final segments forward as draft transactions; the trailing interim
      // segment (if any) echoes live for the listening hint only.
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const segment = event.results[i]
        if (segment === undefined) continue
        const text = segment[0]?.transcript ?? ''
        if (segment.isFinal) {
          const trimmed = text.trim()
          if (trimmed !== '') optionsRef.current.onFinal(trimmed)
        } else {
          interimText += text
        }
      }
      setInterim(interimText.trim())
    }
    recognition.onerror = (event): void => {
      // 'aborted' is the deliberate stop/cleanup path on engines that report
      // it — the user already knows they stopped.
      if (event.error === 'aborted') return
      optionsRef.current.onError(event.error)
    }
    recognition.onend = (): void => { setListening(false); setInterim('') }
    recognitionRef.current = recognition
    try {
      recognition.start()
      setListening(true)
      setInterim('')
    } catch {
      // A racing engine (another tab) refused the start; stay silent.
    }
  }, [listening])

  // Release the engine with the mount: an in-flight session must not keep
  // capturing (or keep its onresult closure) after the host unmounts.
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
      recognitionRef.current = null
    }
  }, [])

  return { listening, supported, interim, start, stop }
}
