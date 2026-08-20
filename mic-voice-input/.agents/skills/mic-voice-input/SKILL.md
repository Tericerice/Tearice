---
name: mic-voice-input
description: Use when wiring Web Speech API dictation with explicit microphone-device selection into a chat composer or any textarea UI, or when diagnosing voice-input failures (no-speech, network, device mismatch). Covers the SpeechRecognition single-instance lifecycle, getUserMedia warm-up device pinning, dual live level meters, the persisted device pick, the stable error-code vocabulary, and Google speech-service reachability probing.
---

# mic-voice-input — voice input with real mic-device pinning

The `mic-voice-input` library (this repository, also published as an npm-style package) implements a chat composer's mic button on top of the Web Speech API, with one crucial fix: `SpeechRecognition` has **no device-selection API** and always hears the OS-default input, so the library pre-acquires a `getUserMedia` warm-up stream pinned to the user's chosen device before the engine starts, and meters both the pinned device and the OS default so "mic selected but silent" and device mismatches surface immediately instead of as opaque `no-speech` errors.

Source of truth: `src/use-voice-input.ts`, `src/use-mic-devices.ts`, `src/probe-google.ts`, and their specs in `tests/`. This skill is the integration guide, not a re-implementation — reuse the library, do not copy its logic into host code.

## The three exports

- `useVoiceInput({ onFinal, onError }) → { listening, supported, interim, start, stop }` — one lazily created `SpeechRecognition` per mount, reused across start/stop cycles, aborted on unmount. Reports only FINAL trimmed segments via `onFinal`; routes raw engine error codes via `onError` (`'aborted'` is the deliberate stop path and is filtered). `supported` is false on browsers with no engine (e.g. Firefox) — disable the button then.
- `useMicDevices(onError, { storageKey? }) → { devices, selectedDeviceId, activeDeviceId, level, defaultCapturing, defaultMeterRunning, defaultLevel, open, close, select }` — enumerates real audio inputs (Chrome's `default`/`communications` pseudo-devices excluded), restores and persists the pick in localStorage (default key `mic-voice-input.deviceId`), acquires/re-acquires the warm-up stream pinned to the pick (or the OS default when `''`), runs ~10×/s Web Audio level meters on the pinned stream and — when the pick is non-default — on a separate OS-default comparison stream, and releases everything on close/unmount. Capture failures map to codes: `not-allowed`, `no-device`, `audio-capture`, `unsupported`, `device-error`.
- `probeGoogle(timeoutMs = 5000) → { google, gstatic }` — per-host reachability of Google's speech infrastructure (Chrome's engine is a Google-hosted service; unreachable on some networks, mainland China being the common case). Call it on service-suspect errors so the user knows to fix the proxy rather than the mic.

## Wiring protocol (non-negotiable order)

1. Mount both hooks in the composer.
2. On mic-button click (user gesture — required for both permission and AudioContext):
   - Start: `const ok = await open()` — the warm-up stream MUST be acquired BEFORE `start()` so the engine hears the pinned device; only if `ok` is true call `start()`.
   - Stop: call `stop()` first (pending final results flush through `onend`), then `close()` to release streams and meter loops promptly — do not hold the mic indefinitely.
3. Device seat (only when `devices.length > 1`): `<select value={selectedDeviceId} onChange={e => select(e.target.value)}>` with a `''` "system default" option first. `select` persists the pick and re-acquires the stream.
4. Listening hint: show `interim` as display-only echo (never write it to the draft); show `level` as a live bar while listening; surface `defaultMeterRunning`/`defaultLevel` when diagnosing silence.
5. Draft insertion: each `onFinal(text)` call is exactly one undoable transaction at the caret. Interim noise must never reach the draft.

## Error handling

Localize the stable vocabulary in the host's UI strings:

| code | meaning | guidance |
| --- | --- | --- |
| `not-allowed` | mic permission denied | point to browser settings |
| `no-device` | no microphone found | ask to connect one |
| `audio-capture` | device busy/unreadable | another app holds the mic |
| `unsupported` | no `navigator.mediaDevices` | newer browser required |
| `device-error` | other capture failure | inspect the device |
| `network` | speech service unreachable | proxy / switch browser (see below) |
| `no-speech` | engine heard silence | speak right after clicking; check level bars |
| `language-not-supported` | engine rejects the language | check `navigator.language` |

## Diagnosis flow

- `no-speech` with `level` moving → the engine hears nothing: either the pinned device differs from what the engine captures (check `defaultLevel` — `selectedDeviceId !== ''` && pinned level > 0 && default level ≈ 0 is the mismatch signature; fix by setting the OS default input) or the speech service is unreachable — run `probeGoogle()`.
- `probeGoogle()` verdicts: `google: false` → no proxy in effect at all; `google: true, gstatic: false` → partial proxy rules (speech infra lives under `gstatic.com`); both true → service reachable, look at the device/mic instead.
- Known regional caveat: Chrome/Electron route recognition to Google servers; Edge uses Microsoft's engine and often works where Chrome does not. Say so plainly rather than chasing the mic.

## Testing

`pnpm test` runs the jsdom+vitest suites covering engine lifecycle (lazy mint, reuse, unmount abort), final-only forwarding, error routing, device enumeration, pick persistence, stream pinning/release, and failure-code mapping. Any change to the hooks must keep these green; extend them for new behavior.
