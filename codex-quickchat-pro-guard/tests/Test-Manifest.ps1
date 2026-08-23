Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$manifestPath = Join-Path $repoRoot 'manifests\26.818.3698.0.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$shaPattern = '^[0-9a-f]{64}$'

foreach ($field in @(
    [string]$manifest.source_app_asar_sha256,
    [string]$manifest.guarded_app_asar_sha256,
    [string]$manifest.asset.source_sha256,
    [string]$manifest.asset.patched_sha256
)) {
    if ($field -notmatch $shaPattern) {
        throw "Invalid SHA-256 field: $field"
    }
}

$operations = @($manifest.asset.patch_operations | Sort-Object { [int64]$_.offset })
if ($operations.Count -ne 7) {
    throw "Expected 7 sparse patch operations, got $($operations.Count)."
}
$ids = @{}
$previousEnd = [int64]0
$insertedBytes = 0
foreach ($operation in $operations) {
    if ($ids.ContainsKey([string]$operation.id)) {
        throw "Duplicate operation id: $($operation.id)"
    }
    $ids[[string]$operation.id] = $true
    if ([string]$operation.delete_sha256 -notmatch $shaPattern) {
        throw "Invalid delete hash for operation $($operation.id)."
    }
    if ([int64]$operation.offset -lt $previousEnd) {
        throw "Overlapping operation: $($operation.id)"
    }
    $previousEnd = [int64]$operation.offset + [int64]$operation.delete_length
    try {
        $insertedBytes += [Convert]::FromBase64String([string]$operation.insert_utf8_base64).Length
    } catch {
        throw "Invalid base64 for operation $($operation.id)."
    }
}
if ($insertedBytes -le 0 -or $insertedBytes -gt 16384) {
    throw "Unexpected inserted byte count: $insertedBytes"
}

if ($manifest.routing_policy.requested_model -ne 'gpt-5-6-pro' -or
    $manifest.routing_policy.accepted_server_value -ne 'gpt-5-6-pro' -or
    -not $manifest.routing_policy.fail_closed_when_evidence_is_missing) {
    throw 'Routing policy is not fail-closed for gpt-5-6-pro.'
}

$forbiddenPatterns = @('*.asar', '*.exe', '*.dll', '*.node')
$forbiddenFiles = @()
foreach ($pattern in $forbiddenPatterns) {
    $forbiddenFiles += @(Get-ChildItem -LiteralPath $repoRoot -Recurse -File -Filter $pattern |
        Where-Object { $_.FullName -notlike "*\.work\*" })
}
if ($forbiddenFiles.Count -gt 0) {
    throw "Forbidden binary payload found: $($forbiddenFiles.FullName -join ', ')"
}

Write-Output "ManifestOperations=$($operations.Count)"
Write-Output "ManifestInsertedBytes=$insertedBytes"
Write-Output 'ManifestResult=PASS'
