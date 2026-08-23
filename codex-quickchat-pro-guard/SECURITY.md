# Security policy

## Reporting a vulnerability

Please use this repository's **Security → Report a vulnerability** flow for issues that could expose credentials, execute unexpected code, weaken hash validation, escape the intended install directory, or accept an unverified route.

Do not include access tokens, cookies, account identifiers, private conversation content, or proprietary Codex application files in a public issue.

## Trust boundary

- The installer reads a locally installed Codex package and creates a user-space copy.
- It does not modify the Microsoft Store package.
- It installs the exact dependency graph recorded in `package-lock.json` with lifecycle scripts disabled.
- It refuses unknown source archive and asset hashes.
- The launcher refuses a changed guarded archive.
- No secrets are required by repository tests.

Review the repository at a pinned commit before running it. If the supported Codex version no longer matches your installed package, stop rather than weakening the checks.

## Supported versions

Security fixes are provided only for the latest repository revision. Each Codex application version needs its own reviewed manifest.
