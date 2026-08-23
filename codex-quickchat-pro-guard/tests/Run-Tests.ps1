[CmdletBinding()]
param([string]$SourceAsset)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Get-ChildItem -LiteralPath (Join-Path $repoRoot 'scripts') -Filter *.ps1 | ForEach-Object {
    [void][scriptblock]::Create((Get-Content -LiteralPath $_.FullName -Raw))
    Write-Output "PowerShellParse=PASS $($_.Name)"
}

& (Join-Path $PSScriptRoot 'Test-Manifest.ps1')
& (Join-Path $PSScriptRoot 'Test-PatchEngine.ps1') -SourceAsset $SourceAsset
& (Join-Path $PSScriptRoot 'Test-GuardPolicy.ps1')

& node --check (Join-Path $repoRoot 'tools\create-sparse-manifest.mjs')
if ($LASTEXITCODE -ne 0) {
    throw "Node syntax check failed with exit code $LASTEXITCODE."
}
Write-Output 'NodeSyntax=PASS'
Write-Output 'AllTests=PASS'
