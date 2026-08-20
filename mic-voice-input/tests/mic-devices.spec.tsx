// @vitest-environment jsdom
/**
 * useMicDevices: device enumeration (real inputs only), the persisted device
 * pick, warm-up stream pinning (exact deviceId), the dual meter (pinned +
 * OS-default comparison capture), capture-failure code mapping, and stream
 * release on close/unmount — all against mocked mediaDevices. jsdom has no
 * Web Audio, so the meter numerics are a no-op here (levels stay 0).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useMicDevices } from '../src/use-mic-devices.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true })
})

interface FakeTrack { stopped: boolean }

function installMediaDevices(opts: {
  devices?: Array<{ deviceId: string; label: string; kind: string }>
  failWith?: DOMException
  defaultFailWith?: DOMException
} = {}) {
  const tracks: FakeTrack[] = []
  const getUserMedia = vi.fn(async (constraints?: MediaStreamConstraints) => {
    // The second capture in a session is the OS-default comparison stream.
    const audioConstraints = typeof constraints?.audio === 'object' ? constraints.audio : undefined
    const isDefaultProbe = audioConstraints === undefined || audioConstraints.deviceId === undefined
    if (isDefaultProbe && opts.defaultFailWith !== undefined) throw opts.defaultFailWith
    if (opts.failWith !== undefined) throw opts.failWith
    const track: FakeTrack = { stopped: false }
    tracks.push(track)
    return {
      getTracks: () => [{ stop: () => { track.stopped = true } }],
    }
  })
  const enumerateDevices = vi.fn(async () => opts.devices ?? [])
  const md = {
    getUserMedia,
    enumerateDevices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(navigator, 'mediaDevices', { value: md, configurable: true })
  return { md, tracks }
}

/** Flush the mount-time enumeration effect. */
async function settle() {
  await act(async () => { await Promise.resolve() })
}

describe('useMicDevices', () => {
  it('enumerates only real audio inputs (pseudo default/communications excluded)', async () => {
    const { md } = installMediaDevices({
      devices: [
        { deviceId: 'default', label: 'Default', kind: 'audioinput' },
        { deviceId: 'communications', label: 'Communications', kind: 'audioinput' },
        { deviceId: 'mic-1', label: '麦克风 (Realtek)', kind: 'audioinput' },
        { deviceId: 'mic-2', label: 'Webcam Mic', kind: 'audioinput' },
      ],
    })
    const { result } = renderHook(() => useMicDevices(vi.fn()))
    await settle()
    expect(md.enumerateDevices).toHaveBeenCalled()
    expect(result.current.devices.map(d => d.deviceId)).toEqual(['mic-1', 'mic-2'])
    expect(result.current.selectedDeviceId).toBe('')
  })

  it('restores a persisted pick as the selected device', async () => {
    localStorage.setItem('mic-voice-input.deviceId', 'mic-9')
    installMediaDevices()
    const { result } = renderHook(() => useMicDevices(vi.fn()))
    await settle()
    expect(result.current.selectedDeviceId).toBe('mic-9')
  })

  it('select() pins the picked device and also meters the OS default', async () => {
    const { md, tracks } = installMediaDevices()
    const { result } = renderHook(() => useMicDevices(vi.fn()))
    await settle()

    let ok = false
    await act(async () => { ok = await result.current.select('mic-1') })
    expect(ok).toBe(true)
    expect(localStorage.getItem('mic-voice-input.deviceId')).toBe('mic-1')
    expect(result.current.selectedDeviceId).toBe('mic-1')
    expect(result.current.activeDeviceId).toBe('mic-1')
    // Pinned capture carries the exact deviceId; the comparison probe does not.
    const audio0 = md.getUserMedia.mock.calls[0]![0]!.audio as MediaTrackConstraints
    const audio1 = md.getUserMedia.mock.calls[1]![0]!.audio as MediaTrackConstraints
    expect((audio0.deviceId as ConstrainDOMStringParameters).exact).toBe('mic-1')
    expect(audio1.deviceId).toBeUndefined()
    expect(result.current.defaultCapturing).toBe(true)
    expect(tracks).toHaveLength(2)

    // An unpinned (default) pick needs no separate probe: one stream feeds both.
    await act(async () => { ok = await result.current.select('') })
    expect(ok).toBe(true)
    expect(md.getUserMedia).toHaveBeenCalledTimes(3)
    expect((md.getUserMedia.mock.calls[2]![0]!.audio as MediaTrackConstraints).deviceId).toBeUndefined()
    expect(result.current.defaultCapturing).toBe(true)
    expect(tracks).toHaveLength(3)
    // Both prior streams were released before re-acquiring.
    expect(tracks[0]!.stopped).toBe(true)
    expect(tracks[1]!.stopped).toBe(true)
  })

  it('a failing default probe does not fail the pinned capture', async () => {
    const onError = vi.fn()
    installMediaDevices({ defaultFailWith: new DOMException('busy', 'NotReadableError') })
    const { result } = renderHook(() => useMicDevices(onError))

    let ok: boolean | undefined
    await act(async () => { ok = await result.current.select('mic-1') })
    expect(ok).toBe(true)
    expect(result.current.activeDeviceId).toBe('mic-1')
    expect(result.current.defaultCapturing).toBe(false)
    expect(onError).not.toHaveBeenCalled()
  })

  it('maps capture failures to error codes and reports false', async () => {
    const onError = vi.fn()
    installMediaDevices({ failWith: new DOMException('denied', 'NotAllowedError') })
    const { result } = renderHook(() => useMicDevices(onError))

    let ok: boolean | undefined
    await act(async () => { ok = await result.current.open() })
    expect(ok).toBe(false)
    expect(onError).toHaveBeenCalledWith('not-allowed')
  })

  it('close() releases the held tracks', async () => {
    const { tracks } = installMediaDevices()
    const { result } = renderHook(() => useMicDevices(vi.fn()))
    await act(async () => { await result.current.select('mic-1') })
    expect(tracks[0]!.stopped).toBe(false)
    expect(tracks[1]!.stopped).toBe(false)

    act(() => { result.current.close() })
    expect(tracks[0]!.stopped).toBe(true)
    expect(tracks[1]!.stopped).toBe(true)
    expect(result.current.activeDeviceId).toBe('')
    expect(result.current.defaultCapturing).toBe(false)
    expect(result.current.level).toBe(0)
    expect(result.current.defaultLevel).toBe(0)
  })

  it('unmount releases the held streams', async () => {
    const { tracks } = installMediaDevices()
    const { result, unmount } = renderHook(() => useMicDevices(vi.fn()))
    await act(async () => { await result.current.open() })

    unmount()
    expect(tracks[0]!.stopped).toBe(true)
  })
})
