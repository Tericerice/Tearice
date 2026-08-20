// @vitest-environment jsdom
/**
 * useVoiceInput lifecycle against a mocked SpeechRecognition: lazy engine
 * creation, final-only result forwarding, error-code routing (with the
 * deliberate 'aborted' stop path filtered), instance reuse across start/stop
 * cycles, and engine release on unmount.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useVoiceInput } from '../src/use-voice-input.ts'
import type { SpeechRecognitionEventLike, SpeechRecognitionLike } from '../src/use-voice-input.ts'

afterEach(() => {
  cleanup()
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition
  delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition
})

let instances: FakeRecognition[]

/** jsdom stand-in for the vendor-prefixed engine; instances record lifecycle calls. */
class FakeRecognition implements SpeechRecognitionLike {
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 1
  onresult: SpeechRecognitionLike['onresult'] = null
  onerror: SpeechRecognitionLike['onerror'] = null
  onend: SpeechRecognitionLike['onend'] = null
  starts = 0
  stops = 0
  aborts = 0

  constructor() {
    instances.push(this)
  }

  start(): void {
    this.starts += 1
  }

  stop(): void {
    this.stops += 1
    this.onend?.()
  }

  abort(): void {
    this.aborts += 1
    this.onend?.()
  }

  /** Drive one result (final or interim) through the engine's handler. */
  emitResult(isFinal: boolean, transcript: string): void {
    const segment = { isFinal, length: 1, 0: { transcript } }
    const event: SpeechRecognitionEventLike = {
      resultIndex: 0,
      results: { length: 1, 0: segment },
    }
    this.onresult?.(event)
  }

  /** Drive one error through the engine's handler. */
  emitError(code: string): void {
    this.onerror?.({ error: code })
  }
}

function installEngine(): void {
  instances = []
  ;(window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition
}

describe('useVoiceInput', () => {
  it('unsupported browsers report supported=false and start is a no-op', () => {
    const { result } = renderHook(() => useVoiceInput({ onFinal: vi.fn(), onError: vi.fn() }))
    expect(result.current.supported).toBe(false)
    expect(result.current.listening).toBe(false)
    act(() => { result.current.start() })
    expect(result.current.listening).toBe(false)
  })

  it('start() mints one engine, flips listening, and forwards only final results (trimmed)', () => {
    installEngine()
    const onFinal = vi.fn()
    const onError = vi.fn()
    const { result } = renderHook(() => useVoiceInput({ onFinal, onError }))
    expect(result.current.supported).toBe(true)

    act(() => { result.current.start() })
    expect(result.current.listening).toBe(true)
    expect(instances).toHaveLength(1)
    expect(instances[0].starts).toBe(1)

    const engine = instances[0]
    act(() => {
      engine.emitResult(false, 'interim noise')
      engine.emitResult(true, '  你好，世界  ')
      engine.emitResult(true, '')
    })
    expect(onFinal).toHaveBeenCalledTimes(1)
    expect(onFinal).toHaveBeenCalledWith('你好，世界')
    expect(onError).not.toHaveBeenCalled()
  })

  it('stop() settles listening through onend; restart reuses the same instance', () => {
    installEngine()
    const { result } = renderHook(() => useVoiceInput({ onFinal: vi.fn(), onError: vi.fn() }))
    act(() => { result.current.start() })
    const engine = instances[0]

    act(() => { result.current.stop() })
    expect(result.current.listening).toBe(false)
    expect(engine.stops).toBe(1)

    act(() => { result.current.start() })
    expect(result.current.listening).toBe(true)
    // No second construction: the ended instance is reused.
    expect(instances).toHaveLength(1)
    expect(engine.starts).toBe(2)
  })

  it('echoes interim transcripts live and clears them on final and on stop', () => {
    installEngine()
    const onFinal = vi.fn()
    const { result } = renderHook(() => useVoiceInput({ onFinal, onError: vi.fn() }))
    act(() => { result.current.start() })
    const engine = instances[0]

    act(() => { engine.emitResult(false, '你') })
    expect(result.current.interim).toBe('你')
    expect(onFinal).not.toHaveBeenCalled()

    act(() => { engine.emitResult(false, '你好世') })
    expect(result.current.interim).toBe('你好世')

    act(() => { engine.emitResult(true, '你好世界') })
    expect(result.current.interim).toBe('')
    expect(onFinal).toHaveBeenCalledWith('你好世界')
    expect(result.current.listening).toBe(true)

    act(() => { result.current.stop() })
    expect(result.current.interim).toBe('')
    expect(result.current.listening).toBe(false)
  })

  it('routes engine error codes, but filters the deliberate aborted stop path', () => {
    installEngine()
    const onError = vi.fn()
    const { result } = renderHook(() => useVoiceInput({ onFinal: vi.fn(), onError }))
    act(() => { result.current.start() })
    const engine = instances[0]

    act(() => {
      engine.emitError('not-allowed')
      engine.emitError('aborted')
      engine.emitError('network')
    })
    expect(onError).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenNthCalledWith(1, 'not-allowed')
    expect(onError).toHaveBeenNthCalledWith(2, 'network')
  })

  it('unmount aborts the live engine', () => {
    installEngine()
    const { result, unmount } = renderHook(() => useVoiceInput({ onFinal: vi.fn(), onError: vi.fn() }))
    act(() => { result.current.start() })
    const engine = instances[0]

    unmount()
    expect(engine.aborts).toBe(1)
  })
})
