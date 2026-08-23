# Codex Quick Chat Pro Guard

[简体中文](README.zh-CN.md) · [How it works](docs/how-it-works.md) · [Research notes](docs/research.md)

An unofficial, exact-build, fail-closed route guard for **Codex desktop Quick Chat** on Windows.

It requests `gpt-5-6-pro`, buffers assistant messages until the server reports the routing model, and only releases those messages when every routing field present is exactly `gpt-5-6-pro`. If the server reports Mini, reports conflicting models, or finishes without verifiable routing evidence, the response is blocked.

> [!IMPORTANT]
> This project does not unlock GPT-5.6 Pro, bypass a subscription, or control OpenAI's backend. Your account must already be entitled to the model. The guard can only reject responses whose server-declared route is not verifiably Pro.

## Supported build

| Platform | Codex package | Status |
|---|---:|---|
| Windows 11, Microsoft Store | `OpenAI.Codex` `26.818.3698.0` | Verified |

Unknown versions and hashes are refused. This is intentional: silently patching a changed minified bundle would be unsafe.

## What the installer does

1. Finds your locally installed Microsoft Store Codex package.
2. Verifies the full source `app.asar` SHA-256.
3. Installs the lockfile-pinned toolchain with `npm ci --ignore-scripts`, then extracts it with `@electron/asar@4.2.1`.
4. Applies seven sparse byte operations from a public manifest.
5. Verifies the patched asset and rebuilt archive hashes.
6. Copies your local Codex installation into a user-writable, versioned directory.
7. Creates a launcher with an isolated profile and a startup integrity check.

The repository contains no OpenAI application archive, executable, DLL, user profile, cookie, token, or screenshot. The manifest stores offsets, hashes of removed bytes, and the small replacement payload needed to reproduce the transformation.

## Requirements

- Windows 11
- Microsoft Store Codex `26.818.3698.0`
- An account that already has GPT-5.6 Pro access
- Node.js `22.12.0` or newer, including `npm`
- Enough disk space for a second local copy of Codex

Exit Codex completely, including its tray process, before using the guarded launcher.

## Install

```powershell
git clone https://github.com/tonyzaca7755963/codex-quickchat-pro-guard.git
cd codex-quickchat-pro-guard
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Guard.ps1
```

Launch **Codex Quick Chat Pro Guard** from the desktop shortcut. The guarded copy uses a separate local profile, so you may need to sign in once.

The default install location is:

```text
%LOCALAPPDATA%\Programs\CodexQuickChatProGuard\26.818.3698.0
```

Rerunning the installer refuses to overwrite an existing installation. Pass `-Force` to move the old directory to a timestamped backup before reinstalling.

## Audit without installing

The build-only mode reconstructs the guarded archive but does not copy or launch Codex:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Guard.ps1 `
  -BuildOnly `
  -BuildOutputDirectory .\build\26.818.3698.0
```

Expected guarded archive SHA-256:

```text
355fa059551c1c5bd57bc26f350cb74587bb43f96a6216a6de8629c3b73f4ac3
```

## Verify and test

After installation:

```powershell
& "$env:LOCALAPPDATA\Programs\CodexQuickChatProGuard\26.818.3698.0\Start-Guard.ps1" -NoUi -VerifyOnly
```

Repository tests are offline and do not need credentials:

```powershell
.\tests\Run-Tests.ps1
```

Maintainers with the exact source asset can additionally replay the production patch:

```powershell
.\tests\Run-Tests.ps1 -SourceAsset C:\path\to\original\app-initial-izy3qYQi.js
```

## Fail-closed policy

- Outgoing Quick Chat model: always `gpt-5-6-pro`
- Accepted server evidence:
  - `server_ste_metadata.metadata.resolved_model_slug`
  - `server_ste_metadata.metadata.model_slug`
- Every routing field that is present must equal `gpt-5-6-pro`
- Assistant messages remain buffered until evidence passes
- Mini or conflicting evidence cancels the stream and retracts already displayed messages
- Completion without routing evidence blocks the buffered answer

See [the technical design](docs/how-it-works.md) for the state machine and limitations.

## Updating and uninstalling

Codex updates change signed package files and minified bundle offsets. This release will refuse a new build until a separately reviewed manifest is added. Do not disable the hash checks.

To uninstall, exit the guarded app, remove its versioned install directory, and delete the desktop shortcut. The Microsoft Store Codex installation is never modified.

## Legal and trademark notice

This project is unaffiliated with and not endorsed by OpenAI. Codex, ChatGPT, GPT, and OpenAI are trademarks of their respective owner. The MIT license covers only this repository's original scripts, manifests, tests, and documentation; it does not grant rights to any third-party application or service.

Use is at your own risk and subject to the applicable OpenAI terms and your local law.
