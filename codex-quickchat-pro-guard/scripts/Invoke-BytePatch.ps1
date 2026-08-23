[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$InputPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [Parameter(Mandatory = $true)]
    [string]$ManifestPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ByteSha256 {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes)

    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        $hash = $hasher.ComputeHash($Bytes)
        return ([BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
}

$resolvedInput = [IO.Path]::GetFullPath($InputPath)
$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$resolvedManifest = [IO.Path]::GetFullPath($ManifestPath)

if (-not (Test-Path -LiteralPath $resolvedInput -PathType Leaf)) {
    throw "Input asset does not exist: $resolvedInput"
}
if (-not (Test-Path -LiteralPath $resolvedManifest -PathType Leaf)) {
    throw "Patch manifest does not exist: $resolvedManifest"
}

$manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
$bytes = [IO.File]::ReadAllBytes($resolvedInput)
$sourceHash = Get-ByteSha256 -Bytes $bytes
if ($sourceHash -ne $manifest.asset.source_sha256) {
    throw "Source asset hash mismatch. Expected $($manifest.asset.source_sha256), got $sourceHash. Refusing to patch an unknown build."
}

$operations = @($manifest.asset.patch_operations | Sort-Object { [int64]$_.offset })
if ($operations.Count -eq 0) {
    throw 'Patch manifest contains no operations.'
}

$previousEnd = [int64]0
foreach ($operation in $operations) {
    $offset = [int64]$operation.offset
    $deleteLength = [int64]$operation.delete_length
    if ($offset -lt 0 -or $deleteLength -lt 0) {
        throw "Patch operation '$($operation.id)' has a negative offset or length."
    }
    if ($offset -lt $previousEnd) {
        throw "Patch operation '$($operation.id)' overlaps a previous operation."
    }
    if ($offset + $deleteLength -gt $bytes.LongLength) {
        throw "Patch operation '$($operation.id)' falls outside the source asset."
    }
    $previousEnd = $offset + $deleteLength
}

foreach ($operation in @($operations | Sort-Object { [int64]$_.offset } -Descending)) {
    $offset = [int]$operation.offset
    $deleteLength = [int]$operation.delete_length
    $deleted = New-Object byte[] $deleteLength
    if ($deleteLength -gt 0) {
        [Buffer]::BlockCopy($bytes, $offset, $deleted, 0, $deleteLength)
    }

    $deletedHash = Get-ByteSha256 -Bytes $deleted
    if ($deletedHash -ne $operation.delete_sha256) {
        throw "Delete hash mismatch for operation '$($operation.id)'. Expected $($operation.delete_sha256), got $deletedHash."
    }

    try {
        $inserted = [Convert]::FromBase64String([string]$operation.insert_utf8_base64)
    } catch {
        throw "Operation '$($operation.id)' contains invalid base64: $($_.Exception.Message)"
    }

    $newLength = $bytes.Length - $deleteLength + $inserted.Length
    $patched = New-Object byte[] $newLength
    if ($offset -gt 0) {
        [Buffer]::BlockCopy($bytes, 0, $patched, 0, $offset)
    }
    if ($inserted.Length -gt 0) {
        [Buffer]::BlockCopy($inserted, 0, $patched, $offset, $inserted.Length)
    }
    $tailSourceOffset = $offset + $deleteLength
    $tailLength = $bytes.Length - $tailSourceOffset
    if ($tailLength -gt 0) {
        [Buffer]::BlockCopy($bytes, $tailSourceOffset, $patched, $offset + $inserted.Length, $tailLength)
    }
    $bytes = $patched
}

$patchedHash = Get-ByteSha256 -Bytes $bytes
if ($patchedHash -ne $manifest.asset.patched_sha256) {
    throw "Patched asset hash mismatch. Expected $($manifest.asset.patched_sha256), got $patchedHash."
}

$patchedText = [Text.Encoding]::UTF8.GetString($bytes)
foreach ($sentinel in @($manifest.asset.required_sentinels)) {
    if (-not $patchedText.Contains([string]$sentinel)) {
        throw "Patched asset is missing required sentinel: $sentinel"
    }
}

$outputDirectory = Split-Path -Parent $resolvedOutput
if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
[IO.File]::WriteAllBytes($resolvedOutput, $bytes)

Write-Output "PatchedAsset=$resolvedOutput"
Write-Output "PatchedSha256=$patchedHash"
Write-Output "OperationCount=$($operations.Count)"
