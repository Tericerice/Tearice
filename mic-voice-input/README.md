# mic-voice-input

React hooks for Web Speech API dictation **with real microphone-device selection**, live level meters, and Google speech-service reachability probing.

Extracted and generalized from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (MIT) — the battle-tested voice input of its chat composer — into a standalone library.

## Why this exists

The Web Speech API's `SpeechRecognition` has **no device-selection API**: it always captures from the OS/browser *default* input device. On a laptop with several microphones (built-in array, headset, webcam), the user can never choose which one the engine hears — and a "silent" pick shows up only as an opaque `no-speech` error.

This library solves it with a **warm-up stream**: before the engine starts, it acquires a `getUserMedia` stream pinned to the chosen device (Chrome then remembers the site's last-used device and shares the capture session, so the engine hears that same input), and meters it live so "mic selected but silent" is visible instantly instead of after a timeout. Because Chrome's remembered-device behavior is not guaranteed, it *also* meters the OS-default input whenever the pick is non-default — if the selected mic has audio while the default stays silent, the mismatch is reported instead of a generic no-speech mystery.

## Features

- 🎙️ **Device pinning** — pick a real mic (or the OS default); the pick persists in `localStorage`
- 📊 **Dual live level meters** — pinned device + OS-default comparison capture (~10×/s, Web Audio)
- ✍️ **Final-only dictation** — only finalized transcript segments reach your draft; interim noise never pollutes the undo log
- 🔁 **Single engine instance** — one `SpeechRecognition` per mount, reused across start/stop cycles, released on unmount
- 🌐 **Google reachability probe** — instant verdict on whether the browser's network path reaches Google's speech servers (Chrome's engine is a Google-hosted service; `google.com` vs `gstatic.com` are probed separately to catch partial proxy rules)
- 🌍 **Localized error vocabulary** — stable codes (`not-allowed`, `no-device`, `audio-capture`, `network`, …) you map to your own UI strings
- 🧪 **Tested** — jsdom + vitest coverage of engine lifecycle, device enumeration, stream release, and error mapping

## Install

```sh
npm install mic-voice-input
# or
pnpm add mic-voice-input
```

Requires React ≥ 18. Browser support mirrors the Web Speech API: Chromium/Edge (prefixed), Safari; Firefox has no engine and reports `supported: false`.

## Quick start

```tsx
import { useCallback, useState } from 'react'
import { useMicDevices, useVoiceInput, probeGoogle } from 'mic-voice-input'

function Composer() {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const insertAtCaret = useCallback((text: string) => {
    setDraft(d => d === '' ? text : `${d}${d.endsWith(' ') ? '' : ' '}${text}`)
  }, [])

  const { devices, selectedDeviceId, level, open, close, select } =
    useMicDevices(code => setError(localize(code)))

  const { listening, supported, interim, start, stop } = useVoiceInput({
    onFinal: insertAtCaret,   // final segment → one draft transaction
    onError: code => {
      if (code === 'no-speech' && selectedDeviceId !== '') void probeGoogle()
      setError(localize(code))
    },
  })

  const toggle = async () => {
    if (listening) { stop(); close(); return }
    const ok = await open()   // warm up the pinned mic BEFORE the engine starts
    if (ok) start()
  }

  return (
    <div>
      {devices.length > 1 && (
        <select value={selectedDeviceId} onChange={e => select(e.target.value)}>
          <option value="">系统默认</option>
          {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      )}
      <button onClick={toggle} disabled={!supported}>{listening ? '■' : '🎤'}</button>
      {listening && <meter value={level} min={0} max={1} />}
      {listening && interim && <div>{interim}</div>}
      <textarea value={draft} onChange={e => setDraft(e.target.value)} />
      {error && <div role="alert">{error}</div>}
    </div>
  )
}
```

> **Lifecycle rule:** `open()` (acquire the warm-up stream) must complete *before* `start()` (engine), and `stop()` then `close()` on the way down. The held streams are always released on unmount, but release promptly when capture ends to free the mic indicator.

## API

### `useVoiceInput(options): VoiceInputControl`

| option | description |
| --- | --- |
| `onFinal(text)` | A finalized transcript segment, trimmed and non-empty. Insert it as **one draft transaction** at the caret. |
| `onError(code)` | Raw engine error code (`'aborted'` — the deliberate stop/cleanup path — is filtered by the hook). |

Returns `{ listening, supported, interim, start, stop }` with stable `start`/`stop` identities. `supported` is false on browsers with no engine.

### `useMicDevices(onError, options?): MicDevicesControl`

| option | description |
| --- | --- |
| `onError(code)` | Capture-failure code from the vocabulary below. |
| `options.storageKey` | localStorage key for the persisted pick (`''` = OS default). Default: `'mic-voice-input.deviceId'`. |

Returns `{ devices, selectedDeviceId, activeDeviceId, level, defaultCapturing, defaultMeterRunning, defaultLevel, open, close, select }`.

- `devices` — real audio inputs only (Chrome's `default`/`communications` pseudo-devices excluded); labels appear once mic permission is granted; hot-plug via `devicechange`.
- `level` / `defaultLevel` — live 0..1 levels; `defaultMeterRunning` tells you whether the default meter's AudioContext actually runs (a suspended context reads 0 otherwise).
- `open()` / `select(deviceId)` — acquire (or re-acquire) the warm-up stream; resolve `false` + `onError(code)` on failure. `select` also persists the pick.
- `close()` — release streams and meter loops.

### `probeGoogle(timeoutMs = 5000): Promise<{ google, gstatic }>`

Per-host reachability of Google's speech infrastructure. Call it when a service-suspect error (`network`, `no-speech` with audio) occurs so the user knows whether to fix the proxy rather than the mic. `google: true, gstatic: false` is the signature of a partial proxy rule set.

### Error vocabulary

| code | meaning | typical fix |
| --- | --- | --- |
| `not-allowed` | Mic permission denied | Allow in browser settings |
| `no-device` | No microphone found | Connect a mic |
| `audio-capture` | Device busy / unreadable | Close the app holding the mic |
| `unsupported` | No `navigator.mediaDevices` | Use a newer browser |
| `device-error` | Anything else from capture | Inspect the device |
| `network` | Speech service unreachable | Proxy / switch browser (see below) |
| `no-speech` | Engine heard silence | Speak right after clicking; check the level bars |
| `language-not-supported` | Engine can't handle the language | Check `navigator.language` |

## Troubleshooting: Chrome's engine is a Google service

Chrome (and Electron) route recognition audio to **Google's speech servers**, which are unreachable on some networks — mainland China being the common case. Symptoms: `no-speech` despite the level bar moving, or `network`. Edge uses Microsoft's engine and often works where Chrome doesn't; otherwise enable a proxy that covers `gstatic.com` (many rule-based proxies only cover `google.com`). `probeGoogle()` tells you which case you're in.

## Development

```sh
pnpm install
pnpm test        # vitest run (jsdom)
pnpm build       # tsc → dist/
pnpm typecheck
```

## DeepSeek Harness agent skill

The repository ships an agent skill (`.agents/skills/mic-voice-input/SKILL.md`, DeepSeek Harness skill format) that documents the composer wiring, lifecycle protocol, and diagnosis flow — drop the `.agents/` folder into any DSH-style agent home to make the knowledge loadable by your coding agent.

## License

MIT. Extracted from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (Copyright (c) 2026 DeepSeek, MIT). See [LICENSE](./LICENSE).

---

# mic-voice-input（中文）

为 Web Speech API 语音听写提供 **真实麦克风设备选择**、实时音量条与 Google 语音服务连通性探测的 React hooks。从 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）中提取并通用化——即其聊天输入栏语音输入功能的独立版本。

## 为什么需要它

Web Speech API 的 `SpeechRecognition` **没有设备选择接口**：它永远只采集操作系统/浏览器的*默认*输入设备。笔记本上有多个麦克风（内置阵列、耳机、摄像头）时，用户无法选择引擎听到哪一个——选错时只会得到一句晦涩的 `no-speech` 错误。

本库用**预热流**解决：引擎启动前先按所选设备（未选则用系统默认）获取一条 `getUserMedia` 流钉住麦克风（Chrome 会记住站点最近使用的设备并共享采集会话，引擎听到的就是同一个输入），并实时计量音量——"选了麦克风却没声音"立即可见，而不是等超时。由于 Chrome 记住设备的行为并非保证，当选择非默认设备时还会**同时计量系统默认输入**：若所选麦克风有声而默认设备无声，会直接报告错配，而不是一句笼统的 no-speech。

## 特性

- 🎙️ **设备钉住**——选择真实麦克风（或系统默认），选择持久化到 `localStorage`
- 📊 **双路实时音量条**——所选设备 + 系统默认对比采集（约 10 次/秒，Web Audio）
- ✍️ **只报定稿**——只有定稿文本段到达你的草稿；中间噪音永不污染撤销记录
- 🔁 **单引擎实例**——每次挂载只建一个 `SpeechRecognition`，跨启停复用，卸载即释放
- 🌐 **Google 连通性探测**——快速判断浏览器网络路径能否到达 Google 语音服务（Chrome 引擎是 Google 托管服务；分别探测 `google.com` 与 `gstatic.com` 以识别规则不全的代理）
- 🌍 **稳定错误码词表**——`not-allowed`、`no-device`、`audio-capture`、`network` 等，由你映射到自己的界面文案
- 🧪 **有测试**——jsdom + vitest 覆盖引擎生命周期、设备枚举、流释放与错误映射

## 安装

```sh
npm install mic-voice-input
# 或
pnpm add mic-voice-input
```

要求 React ≥ 18。浏览器支持跟随 Web Speech API：Chromium/Edge（带前缀）、Safari；Firefox 无引擎，`supported` 为 `false`。

## 快速上手

```tsx
import { useCallback, useState } from 'react'
import { useMicDevices, useVoiceInput, probeGoogle } from 'mic-voice-input'

function Composer() {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const insertAtCaret = useCallback((text: string) => {
    setDraft(d => d === '' ? text : `${d}${d.endsWith(' ') ? '' : ' '}${text}`)
  }, [])

  const { devices, selectedDeviceId, level, open, close, select } =
    useMicDevices(code => setError(localize(code)))

  const { listening, supported, interim, start, stop } = useVoiceInput({
    onFinal: insertAtCaret,   // 定稿文本 → 一次草稿事务
    onError: code => {
      if (code === 'no-speech' && selectedDeviceId !== '') void probeGoogle()
      setError(localize(code))
    },
  })

  const toggle = async () => {
    if (listening) { stop(); close(); return }
    const ok = await open()   // 先预热钉住所选麦克风，再启动引擎
    if (ok) start()
  }

  return (
    <div>
      {devices.length > 1 && (
        <select value={selectedDeviceId} onChange={e => select(e.target.value)}>
          <option value="">系统默认</option>
          {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label}</option>)}
        </select>
      )}
      <button onClick={toggle} disabled={!supported}>{listening ? '■' : '🎤'}</button>
      {listening && <meter value={level} min={0} max={1} />}
      {listening && interim && <div>{interim}</div>}
      <textarea value={draft} onChange={e => setDraft(e.target.value)} />
      {error && <div role="alert">{error}</div>}
    </div>
  )
}
```

> **生命周期规则：** `open()`（获取预热流）必须**先于** `start()`（引擎）完成；结束时先 `stop()` 再 `close()`。卸载时流一定会被释放，但建议采集结束立即释放，让出麦克风指示灯。

## API

### `useVoiceInput(options): VoiceInputControl`

| 选项 | 说明 |
| --- | --- |
| `onFinal(text)` | 定稿文本段（已 trim、非空）。请在光标处作为**一次草稿事务**插入。 |
| `onError(code)` | 原始引擎错误码（`'aborted'`——主动停止/清理路径——已被 hook 过滤）。 |

返回 `{ listening, supported, interim, start, stop }`，`start`/`stop` 引用稳定。无引擎的浏览器 `supported` 为 `false`。

### `useMicDevices(onError, options?): MicDevicesControl`

| 选项 | 说明 |
| --- | --- |
| `onError(code)` | 采集失败错误码，见词表。 |
| `options.storageKey` | 持久化设备选择的 localStorage key（`''` = 系统默认）。默认 `'mic-voice-input.deviceId'`。 |

返回 `{ devices, selectedDeviceId, activeDeviceId, level, defaultCapturing, defaultMeterRunning, defaultLevel, open, close, select }`。

- `devices`——仅真实音频输入（排除 Chrome 的 `default`/`communications` 伪设备）；授权后才有标签；`devicechange` 支持热插拔。
- `level` / `defaultLevel`——实时 0..1 音量；`defaultMeterRunning` 表示默认路 AudioContext 是否真的在跑（挂起时读数恒为 0）。
- `open()` / `select(deviceId)`——获取（或重新获取）预热流；失败时 resolve `false` 并回调 `onError(code)`。`select` 同时持久化选择。
- `close()`——释放流与计量循环。

### `probeGoogle(timeoutMs = 5000): Promise<{ google, gstatic }>`

分主机探测 Google 语音基础设施连通性。在疑似服务问题的错误（`network`、有声音却 `no-speech`）时调用，让用户知道该修代理而不是修麦克风。`google: true, gstatic: false` 是代理规则不全的典型特征。

### 错误码词表

| 码 | 含义 | 常见处理 |
| --- | --- | --- |
| `not-allowed` | 麦克风权限被拒 | 浏览器设置中允许 |
| `no-device` | 未找到麦克风 | 连接麦克风 |
| `audio-capture` | 设备被占用/不可读 | 关闭占用麦克风的程序 |
| `unsupported` | 无 `navigator.mediaDevices` | 换新浏览器 |
| `device-error` | 采集的其他错误 | 检查设备 |
| `network` | 语音服务不可达 | 代理 / 换浏览器（见下） |
| `no-speech` | 引擎没听到声音 | 点击后立刻说话；看音量条 |
| `language-not-supported` | 引擎不支持当前语言 | 检查 `navigator.language` |

## 排障：Chrome 引擎是 Google 服务

Chrome（及 Electron）把识别音频路由到 **Google 语音服务器**，部分网络不可达——国内是最常见场景。症状：音量条在动却 `no-speech`，或 `network`。Edge 使用微软引擎，常能替代 Chrome；否则开启覆盖 `gstatic.com` 的代理（很多规则代理只覆盖 `google.com`）。用 `probeGoogle()` 可判断属于哪种情况。

## 开发

```sh
pnpm install
pnpm test        # vitest run (jsdom)
pnpm build       # tsc → dist/
pnpm typecheck
```

## DeepSeek Harness 代理 skill

仓库附带 agent skill（`.agents/skills/mic-voice-input/SKILL.md`，DeepSeek Harness skill 格式），记录了输入栏接线、生命周期协议与诊断流程——把 `.agents/` 目录放进任意 DSH 风格 agent home，即可让编码代理加载这些知识。

## 许可

MIT。提取自 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（Copyright (c) 2026 DeepSeek，MIT）。见 [LICENSE](./LICENSE)。
