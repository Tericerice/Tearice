/**
 * Microphone discovery and warm-up for voice input.
 *
 * Extracted from DeepSeek Harness (MIT) — packages/client/ui-conversation
 * — and generalized into a standalone library.
 *
 * `SpeechRecognition` has NO device-selection API: it always captures from
 * the OS/browser default input. To let the user pick a specific mic, this
 * hook pre-acquires a getUserMedia stream pinned to the chosen device (or the
 * OS default when none is chosen) BEFORE the recognition engine starts.
 * Chrome remembers the site's last-used device and shares the capture
 * session, so the recognition engine then hears that same device. The held
 * stream also powers a live level meter, so "mic selected but silent" shows
 * up immediately instead of arriving as an opaque no-speech error.
 *
 * Because Chrome's site-remembered-device behavior is not guaranteed, the
 * hook ALSO meters the OS default input whenever the pick is non-default: if
 * the selected device has audio while the default stays silent, the engine —
 * which listens on the default — hears nothing, and the mismatch is reported
 * instead of a generic no-speech.
 *
 * Error codes (localized by the caller): 'not-allowed', 'no-device',
 * 'audio-capture' (device busy/unreadable), 'unsupported' (no mediaDevices),
 * and 'device-error' (anything else).
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Default localStorage key for the persisted device pick ('' = OS default). */
const DEFAULT_STORAGE_KEY = 'mic-voice-input.deviceId'

/** Shared echo/noise/gain processing, kept on both capture paths. */
const BASE_AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

/** One real audio-input device (Chrome's 'default'/'communications' pseudo-devices are excluded). */
export interface MicDeviceInfo {
  readonly deviceId: string
  readonly label: string
}

/** Optional tuning for the hook. */
export interface MicDevicesOptions {
  /** localStorage key persisting the device pick ('' = OS default). */
  readonly storageKey?: string
}

/** The control surface a device seat and meter bind to. */
export interface MicDevicesControl {
  /** Known audio-input devices (labels appear once mic permission is granted). */
  readonly devices: readonly MicDeviceInfo[]
  /** The persisted device pick ('' = OS default), shown while idle. */
  readonly selectedDeviceId: string
  /** deviceId the warm-up stream is pinned to ('' = OS default). */
  readonly activeDeviceId: string
  /** Live level 0..1 of the pinned stream (0 = silence). */
  readonly level: number
  /** Whether the OS-default input is being captured for comparison. */
  readonly defaultCapturing: boolean
  /** Whether the default meter actually runs (a suspended AudioContext reads 0 otherwise). */
  readonly defaultMeterRunning: boolean
  /** Live level 0..1 of the OS-default input (valid while defaultMeterRunning). */
  readonly defaultLevel: number
  /** Acquire (or re-acquire) the warm-up stream; false when capture failed. */
  readonly open: () => Promise<boolean>
  /** Release the warm-up stream and the meter loop. */
  readonly close: () => void
  /** Persist a device pick and re-acquire the warm-up stream on it. */
  readonly select: (deviceId: string) => Promise<boolean>
}

/** Chrome's pseudo-devices mirror the OS default; only real inputs are listed. */
function realAudioInputs(list: readonly MediaDeviceInfo[]): readonly MicDeviceInfo[] {
  return list
    .filter(d => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map(d => ({ deviceId: d.deviceId, label: d.label || d.deviceId }))
}

async function audioInputs(): Promise<readonly MicDeviceInfo[]> {
  const m = navigator.mediaDevices
  if (m?.enumerateDevices === undefined) return []
  try {
    return realAudioInputs(await m.enumerateDevices())
  } catch {
    return []
  }
}

/** Map a getUserMedia rejection to the localized error-code vocabulary. */
function captureErrorCode(error: unknown): string {
  if (error instanceof DOMException) {
    switch (error.name) {
      case 'NotFoundError': return 'no-device'
      case 'NotAllowedError': return 'not-allowed'
      case 'NotReadableError': return 'audio-capture'
    }
  }
  return 'device-error'
}

/**
 * Audio-level meter over a held stream; level state updates ~10×/s. `onRunning`
 * fires once the underlying AudioContext actually runs — a suspended context
 * (autoplay policy) would otherwise read as permanent silence.
 */
function startMeter(
  stream: MediaStream,
  setLevel: (level: number) => void,
  onRunning?: () => void,
): () => void {
  const AudioCtx = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof window.AudioContext }).webkitAudioContext
  if (AudioCtx === undefined) return () => {}
  const ctx = new AudioCtx()
  void ctx.resume()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  const source = ctx.createMediaStreamSource(stream)
  source.connect(analyser)
  const data = new Uint8Array(analyser.frequencyBinCount)
  let notified = false
  const timer = window.setInterval(() => {
    if (ctx.state !== 'running') {
      // Re-request activation: the context may have been created just after
      // the user gesture window closed.
      void ctx.resume()
      return
    }
    if (!notified) {
      notified = true
      onRunning?.()
    }
    analyser.getByteTimeDomainData(data)
    let sum = 0
    for (let i = 0; i < data.length; i++) {
      const v = (data[i]! - 128) / 128
      sum += v * v
    }
    setLevel(Math.min(1, Math.sqrt(sum / data.length) * 2.2))
  }, 100)
  return () => {
    clearInterval(timer)
    void ctx.close()
  }
}

/** Stream constraints pinning the picked device (or the OS default). */
function constraintsFor(deviceId: string): MediaStreamConstraints {
  return deviceId === ''
    ? { audio: BASE_AUDIO }
    : { audio: { ...BASE_AUDIO, deviceId: { exact: deviceId } } }
}

/**
 * Device discovery + warm-up for one composer mount. `open`/`close`/`select`
 * identities are stable; the held streams are released with the mount.
 */
export function useMicDevices(onError: (code: string) => void, options: MicDevicesOptions = {}): MicDevicesControl {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
  const [devices, setDevices] = useState<readonly MicDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [activeDeviceId, setActiveDeviceId] = useState('')
  const [level, setLevel] = useState(0)
  const [defaultCapturing, setDefaultCapturing] = useState(false)
  const [defaultMeterRunning, setDefaultMeterRunning] = useState(false)
  const [defaultLevel, setDefaultLevel] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const defaultStreamRef = useRef<MediaStream | null>(null)
  const stopMeterRef = useRef<() => void>(() => {})
  const stopDefaultMeterRef = useRef<() => void>(() => {})
  const pickRef = useRef('')
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  // Restore the persisted pick once ('' = OS default).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved !== null) {
        pickRef.current = saved
        setSelectedDeviceId(saved)
      }
    } catch {
      // storage unavailable — fall back to the OS default
    }
  }, [storageKey])

  const refreshDevices = useCallback((): void => {
    void audioInputs().then(setDevices)
  }, [])

  // Enumerate on mount and on hot-plug; labels need mic permission granted.
  useEffect(() => {
    refreshDevices()
    const m = navigator.mediaDevices
    if (m?.addEventListener === undefined) return
    m.addEventListener('devicechange', refreshDevices)
    return () => { m.removeEventListener('devicechange', refreshDevices) }
  }, [refreshDevices])

  const close = useCallback((): void => {
    stopMeterRef.current()
    stopMeterRef.current = () => {}
    stopDefaultMeterRef.current()
    stopDefaultMeterRef.current = () => {}
    streamRef.current?.getTracks().forEach(track => { track.stop() })
    streamRef.current = null
    defaultStreamRef.current?.getTracks().forEach(track => { track.stop() })
    defaultStreamRef.current = null
    setActiveDeviceId('')
    setDefaultCapturing(false)
    setDefaultMeterRunning(false)
    setLevel(0)
    setDefaultLevel(0)
  }, [])

  const open = useCallback(async (): Promise<boolean> => {
    const m = navigator.mediaDevices
    if (m?.getUserMedia === undefined) {
      onErrorRef.current('unsupported')
      return false
    }
    const deviceId = pickRef.current
    close()
    try {
      const stream = await m.getUserMedia(constraintsFor(deviceId))
      streamRef.current = stream
      setActiveDeviceId(deviceId)
      stopMeterRef.current = startMeter(stream, setLevel)
      if (deviceId === '') {
        // Pinned == default: one stream feeds both meters.
        stopDefaultMeterRef.current = startMeter(stream, setDefaultLevel, () => setDefaultMeterRunning(true))
        setDefaultCapturing(true)
      } else {
        // The engine listens on the OS default; meter it too so a silent
        // default vs. audible pick is visible instead of a no-speech mystery.
        try {
          const defaultStream = await m.getUserMedia({ audio: BASE_AUDIO })
          defaultStreamRef.current = defaultStream
          stopDefaultMeterRef.current = startMeter(defaultStream, setDefaultLevel, () => setDefaultMeterRunning(true))
          setDefaultCapturing(true)
        } catch {
          // Default capture failed (busy/denied) — not fatal for the pinned path.
        }
      }
      return true
    } catch (error) {
      onErrorRef.current(captureErrorCode(error))
      close()
      return false
    }
  }, [close])

  const select = useCallback(async (deviceId: string): Promise<boolean> => {
    pickRef.current = deviceId
    setSelectedDeviceId(deviceId)
    try {
      localStorage.setItem(storageKey, deviceId)
    } catch {
      // storage unavailable — the pick still applies for this session
    }
    return open()
  }, [open, storageKey])

  // Release the held streams with the mount.
  useEffect(() => close, [close])

  return {
    devices, selectedDeviceId, activeDeviceId, level,
    defaultCapturing, defaultMeterRunning, defaultLevel, open, close, select,
  }
}
