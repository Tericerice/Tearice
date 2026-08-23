# Contributing

Contributions are welcome, especially independently reproduced manifests for new Codex desktop builds.

## Non-negotiable rules

- Never commit `app.asar`, extracted Codex source, executables, DLLs, native modules, user profiles, screenshots containing account data, cookies, tokens, or logs with conversation content.
- Do not weaken source, deletion, final-asset, rebuilt-archive, or launcher integrity checks.
- Do not describe the project as an entitlement or subscription bypass.
- Keep each application version in a separate manifest.

## New-version evidence

A pull request for a new supported build should include:

1. Exact package version and source archive SHA-256.
2. Exact source and patched asset SHA-256 values.
3. Minimal sparse patch operations; never include an unmodified application asset.
4. Exact `@electron/asar` and minimum Node.js versions.
5. Expected rebuilt archive SHA-256.
6. Passing offline tests, production replay, and build-only reconstruction.
7. A manual Quick Chat check showing exact server route metadata for `gpt-5-6-pro`, with all personal data removed.

The helper in `tools/create-sparse-manifest.mjs` can derive sparse operations from two locally held asset files. Its JSON output still requires human review before inclusion.

## Test

```powershell
.\tests\Run-Tests.ps1
git diff --check
```

If you have the exact original asset, also run:

```powershell
.\tests\Run-Tests.ps1 -SourceAsset C:\path\to\source.js
.\scripts\Install-Guard.ps1 -BuildOnly -BuildOutputDirectory .\build\verification
```
