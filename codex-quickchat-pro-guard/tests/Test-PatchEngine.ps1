[CmdletBinding()]
param([string]$SourceAsset)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-ByteSha256 {
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($hasher.ComputeHash($Bytes)) -replace '-', '').ToLowerInvariant()
    } finally {
        $hasher.Dispose()
    }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$patchScript = Join-Path $repoRoot 'scripts\Invoke-BytePatch.ps1'
$productionManifest = Join-Path $repoRoot 'manifests\26.818.3698.0.json'
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$tempRoot = Join-Path $tempBase ("codex-pro-guard-test-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

try {
    $sourceBytes = [Text.Encoding]::UTF8.GetBytes('alpha-old-omega')
    $deletedBytes = [Text.Encoding]::UTF8.GetBytes('old')
    $insertedBytes = [Text.Encoding]::UTF8.GetBytes('new-value')
    $expectedBytes = [Text.Encoding]::UTF8.GetBytes('alpha-new-value-omega')
    $syntheticManifest = [ordered]@{
        asset = [ordered]@{
            source_sha256 = Get-ByteSha256 -Bytes $sourceBytes
            patched_sha256 = Get-ByteSha256 -Bytes $expectedBytes
            patch_operations = @(
                [ordered]@{
                    id = 'synthetic-replacement'
                    offset = 6
                    delete_length = 3
                    delete_sha256 = Get-ByteSha256 -Bytes $deletedBytes
                    insert_utf8_base64 = [Convert]::ToBase64String($insertedBytes)
                }
            )
            required_sentinels = @('new-value')
        }
    }

    $sourcePath = Join-Path $tempRoot 'source.bin'
    $outputPath = Join-Path $tempRoot 'output.bin'
    $manifestPath = Join-Path $tempRoot 'manifest.json'
    [IO.File]::WriteAllBytes($sourcePath, $sourceBytes)
    [IO.File]::WriteAllText(
        $manifestPath,
        ($syntheticManifest | ConvertTo-Json -Depth 8),
        [Text.UTF8Encoding]::new($false)
    )

    & $patchScript -InputPath $sourcePath -OutputPath $outputPath -ManifestPath $manifestPath | Out-Null
    $actual = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($outputPath))
    if ($actual -ne 'alpha-new-value-omega') {
        throw "Synthetic patch result mismatch: $actual"
    }

    [IO.File]::WriteAllText($sourcePath, 'tampered', [Text.UTF8Encoding]::new($false))
    $unknownBuildRejected = $false
    try {
        & $patchScript -InputPath $sourcePath -OutputPath (Join-Path $tempRoot 'should-not-exist.bin') -ManifestPath $manifestPath | Out-Null
    } catch {
        $unknownBuildRejected = $_.Exception.Message -like '*unknown build*'
    }
    if (-not $unknownBuildRejected) {
        throw 'Patch engine did not reject a source hash mismatch.'
    }

    if (-not [string]::IsNullOrWhiteSpace($SourceAsset)) {
        $realOutput = Join-Path $tempRoot 'production-output.js'
        & $patchScript -InputPath $SourceAsset -OutputPath $realOutput -ManifestPath $productionManifest | Out-Null
        $manifest = Get-Content -LiteralPath $productionManifest -Raw | ConvertFrom-Json
        $realHash = Get-ByteSha256 -Bytes ([IO.File]::ReadAllBytes($realOutput))
        if ($realHash -ne $manifest.asset.patched_sha256) {
            throw "Production replay mismatch: $realHash"
        }
        Write-Output "ProductionReplaySha256=$realHash"
    }

    Write-Output 'PatchEngineResult=PASS'
} finally {
    $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
    if ((Test-Path -LiteralPath $resolvedTemp) -and
        $resolvedTemp.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and
        (Split-Path -Leaf $resolvedTemp).StartsWith('codex-pro-guard-test-', [StringComparison]::Ordinal)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}
