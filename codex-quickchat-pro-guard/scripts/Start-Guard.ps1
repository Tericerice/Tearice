[CmdletBinding()]
param(
    [switch]$NoUi,
    [switch]$VerifyOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$manifestPath = Join-Path $PSScriptRoot 'guard-manifest.json'
$appRoot = Join-Path $PSScriptRoot 'app'
$profileRoot = Join-Path $PSScriptRoot 'profile'
$executable = Join-Path $appRoot 'ChatGPT.exe'
$archive = Join-Path $appRoot 'resources\app.asar'

function Get-LowerFileHash {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($hasher.ComputeHash($stream)) -replace '-', '').ToLowerInvariant()
    } finally {
        $hasher.Dispose()
        $stream.Dispose()
    }
}

function Show-GuardError {
    param([Parameter(Mandatory = $true)][string]$Message)

    if ($NoUi) {
        [Console]::Error.WriteLine($Message)
        return
    }

    Add-Type -AssemblyName System.Windows.Forms
    [void][System.Windows.Forms.MessageBox]::Show(
        $Message,
        'Codex Quick Chat Pro Guard',
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
}

try {
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Guard manifest is missing: $manifestPath"
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $expectedArchiveSha256 = [string]$manifest.guarded_app_asar_sha256

    if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
        throw "Guarded Codex executable is missing: $executable"
    }
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) {
        throw "Guarded app archive is missing: $archive"
    }

    $actualArchiveSha256 = Get-LowerFileHash -Path $archive
    if ($actualArchiveSha256 -ne $expectedArchiveSha256) {
        throw "Integrity check failed. Expected app.asar $expectedArchiveSha256, got $actualArchiveSha256. Launch refused."
    }

    if ($VerifyOnly) {
        Write-Output "GUARD_INTEGRITY_OK $actualArchiveSha256"
        return
    }

    $appRootResolved = [IO.Path]::GetFullPath($appRoot).TrimEnd('\') + '\'
    $codexProcesses = @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -in @('ChatGPT.exe', 'Codex.exe') -and $_.ExecutablePath
    })
    $unguardedProcesses = @($codexProcesses | Where-Object {
        -not $_.ExecutablePath.StartsWith($appRootResolved, [StringComparison]::OrdinalIgnoreCase)
    })
    if ($unguardedProcesses.Count -gt 0) {
        throw 'Another Codex/ChatGPT desktop process is running outside this guarded copy. Exit it completely, including the tray process, then retry.'
    }

    $guardAlreadyRunning = @($codexProcesses | Where-Object {
        $_.ExecutablePath.StartsWith($appRootResolved, [StringComparison]::OrdinalIgnoreCase)
    }).Count -gt 0

    if (-not (Test-Path -LiteralPath $profileRoot -PathType Container)) {
        New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null
    }

    $previousUserDataPath = [Environment]::GetEnvironmentVariable('CODEX_ELECTRON_USER_DATA_PATH', 'Process')
    try {
        [Environment]::SetEnvironmentVariable('CODEX_ELECTRON_USER_DATA_PATH', $profileRoot, 'Process')
        $process = Start-Process -FilePath $executable `
            -ArgumentList "--user-data-dir=`"$profileRoot`"" `
            -WorkingDirectory $appRoot `
            -PassThru
    } finally {
        [Environment]::SetEnvironmentVariable('CODEX_ELECTRON_USER_DATA_PATH', $previousUserDataPath, 'Process')
    }

    if (-not $guardAlreadyRunning) {
        Start-Sleep -Seconds 3
        if ($process.HasExited) {
            throw "Guarded Codex exited during startup with code $($process.ExitCode)."
        }
    }
} catch {
    Show-GuardError -Message $_.Exception.Message
    if ($NoUi) {
        throw
    }
    exit 1
}
