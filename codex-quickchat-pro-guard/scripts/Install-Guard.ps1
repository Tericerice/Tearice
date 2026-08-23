[CmdletBinding()]
param(
    [string]$ManifestPath,
    [string]$CodexAppRoot,
    [string]$InstallRoot,
    [switch]$NoDesktopShortcut,
    [switch]$Force,
    [switch]$BuildOnly,
    [string]$BuildOutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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

function Invoke-Asar {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & $script:AsarCommand @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "asar command failed with exit code ${LASTEXITCODE}: $($Arguments -join ' ')"
    }
}

function Invoke-RobocopyChecked {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    $output = & robocopy.exe $Source $Destination /E /COPY:DAT /DCOPY:DAT /R:2 /W:1 /NFL /NDL /NJH /NJS /NP
    $exitCode = $LASTEXITCODE
    if ($exitCode -ge 8) {
        throw "robocopy failed with exit code $exitCode while copying '$Source' to '$Destination'.`n$($output -join [Environment]::NewLine)"
    }
}

function Assert-SafeInstallRoot {
    param([Parameter(Mandatory = $true)][string]$Path)

    $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    $root = [IO.Path]::GetPathRoot($fullPath).TrimEnd('\')
    if ($fullPath -eq $root -or $fullPath.Length -le ($root.Length + 8)) {
        throw "InstallRoot is too broad: $fullPath"
    }
    $segments = @($fullPath.Split([char[]]@('\', '/'), [StringSplitOptions]::RemoveEmptyEntries))
    if (@($segments | Where-Object { $_ -eq 'CodexQuickChatProGuard' }).Count -eq 0) {
        throw "InstallRoot must contain a dedicated 'CodexQuickChatProGuard' directory: $fullPath"
    }
    return $fullPath
}

if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'manifests\26.818.3698.0.json'
}
$ManifestPath = [IO.Path]::GetFullPath($ManifestPath)
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    throw "Manifest not found: $ManifestPath"
}
$manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json

$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$npmCommandInfo = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $nodeCommand -or -not $npmCommandInfo) {
    throw 'Node.js and npm are required. Install Node.js 22.12 or newer, then rerun this installer.'
}
$nodeVersionText = (& $nodeCommand.Source --version).Trim().TrimStart('v')
try {
    $nodeVersion = [version]$nodeVersionText
    $minimumNodeVersion = [version]$manifest.asar.minimum_node_version
} catch {
    throw "Unable to parse Node.js version '$nodeVersionText'."
}
if ($nodeVersion -lt $minimumNodeVersion) {
    throw "Node.js $minimumNodeVersion or newer is required; found $nodeVersion."
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$asarCommand = Join-Path $repoRoot 'node_modules\.bin\asar.cmd'
if (-not (Test-Path -LiteralPath $asarCommand -PathType Leaf)) {
    Push-Location $repoRoot
    try {
        & $npmCommandInfo.Source ci --ignore-scripts --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            throw "npm ci failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
}
if (-not (Test-Path -LiteralPath $asarCommand -PathType Leaf)) {
    throw "Locked asar command was not installed: $asarCommand"
}
$script:AsarCommand = $asarCommand

if ([string]::IsNullOrWhiteSpace($CodexAppRoot)) {
    $package = Get-AppxPackage -Name $manifest.package_name |
        Sort-Object Version -Descending |
        Select-Object -First 1
    if (-not $package) {
        throw "The Microsoft Store package '$($manifest.package_name)' is not installed."
    }
    if ($package.Version.ToString() -ne [string]$manifest.package_version) {
        throw "Unsupported Codex package version $($package.Version). This release only supports $($manifest.package_version)."
    }
    $CodexAppRoot = Join-Path $package.InstallLocation 'app'
}
$CodexAppRoot = [IO.Path]::GetFullPath($CodexAppRoot)
$sourceArchive = Join-Path $CodexAppRoot 'resources\app.asar'
$sourceExecutable = Join-Path $CodexAppRoot 'ChatGPT.exe'
if (-not (Test-Path -LiteralPath $sourceArchive -PathType Leaf)) {
    throw "Source app.asar not found: $sourceArchive"
}
if (-not (Test-Path -LiteralPath $sourceExecutable -PathType Leaf)) {
    throw "Source ChatGPT.exe not found: $sourceExecutable"
}

$sourceArchiveHash = Get-LowerFileHash -Path $sourceArchive
if ($sourceArchiveHash -ne $manifest.source_app_asar_sha256) {
    throw "Source app.asar hash mismatch. Expected $($manifest.source_app_asar_sha256), got $sourceArchiveHash. Refusing to modify an unknown build."
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$tempRoot = Join-Path $tempBase ("codex-quickchat-pro-guard-" + [guid]::NewGuid().ToString('N'))
$tempRoot = [IO.Path]::GetFullPath($tempRoot)
if (-not $tempRoot.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing unsafe temporary path: $tempRoot"
}
New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null

$backupRoot = $null
$installWasCreated = $false
try {
    $extractedRoot = Join-Path $tempRoot 'extracted'
    $guardedArchive = Join-Path $tempRoot 'app.asar'
    Invoke-Asar -Arguments @('extract', $sourceArchive, $extractedRoot)

    $assetRelativePath = ([string]$manifest.asset.path).Replace('/', '\')
    $assetPath = Join-Path $extractedRoot $assetRelativePath
    $patchScript = Join-Path $PSScriptRoot 'Invoke-BytePatch.ps1'
    & $patchScript -InputPath $assetPath -OutputPath $assetPath -ManifestPath $ManifestPath

    Invoke-Asar -Arguments @(
        'pack',
        $extractedRoot,
        $guardedArchive,
        '--unpack-dir',
        [string]$manifest.asar.unpack_pattern
    )

    $guardedArchiveHash = Get-LowerFileHash -Path $guardedArchive
    if ($guardedArchiveHash -ne $manifest.guarded_app_asar_sha256) {
        throw "Guarded app.asar hash mismatch. Expected $($manifest.guarded_app_asar_sha256), got $guardedArchiveHash."
    }

    if ($BuildOnly) {
        if ([string]::IsNullOrWhiteSpace($BuildOutputDirectory)) {
            $BuildOutputDirectory = Join-Path (Get-Location) "build\$($manifest.package_version)"
        }
        $BuildOutputDirectory = [IO.Path]::GetFullPath($BuildOutputDirectory)
        if (Test-Path -LiteralPath $BuildOutputDirectory) {
            if (-not $Force) {
                throw "Build output already exists: $BuildOutputDirectory. Use -Force to replace files in it."
            }
        } else {
            New-Item -ItemType Directory -Path $BuildOutputDirectory -Force | Out-Null
        }
        Copy-Item -LiteralPath $guardedArchive -Destination (Join-Path $BuildOutputDirectory 'app.asar') -Force
        $guardedUnpacked = "$guardedArchive.unpacked"
        if (Test-Path -LiteralPath $guardedUnpacked -PathType Container) {
            Invoke-RobocopyChecked -Source $guardedUnpacked -Destination (Join-Path $BuildOutputDirectory 'app.asar.unpacked')
        }
        Write-Output "BUILD_ONLY_OK $BuildOutputDirectory"
        Write-Output "GuardedAsarSha256=$guardedArchiveHash"
        return
    }

    if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
        $InstallRoot = Join-Path $env:LOCALAPPDATA "Programs\CodexQuickChatProGuard\$($manifest.package_version)"
    }
    $InstallRoot = Assert-SafeInstallRoot -Path $InstallRoot
    if (Test-Path -LiteralPath $InstallRoot) {
        if (-not $Force) {
            throw "Install root already exists: $InstallRoot. Use -Force to move it to a timestamped backup first."
        }
        $backupRoot = "$InstallRoot.backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        if (Test-Path -LiteralPath $backupRoot) {
            throw "Backup destination already exists: $backupRoot"
        }
        Move-Item -LiteralPath $InstallRoot -Destination $backupRoot
    }

    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    $installWasCreated = $true
    $installedAppRoot = Join-Path $InstallRoot 'app'
    Invoke-RobocopyChecked -Source $CodexAppRoot -Destination $installedAppRoot

    $installedResources = Join-Path $installedAppRoot 'resources'
    Copy-Item -LiteralPath $guardedArchive -Destination (Join-Path $installedResources 'app.asar') -Force
    $guardedUnpacked = "$guardedArchive.unpacked"
    if (Test-Path -LiteralPath $guardedUnpacked -PathType Container) {
        Invoke-RobocopyChecked -Source $guardedUnpacked -Destination (Join-Path $installedResources 'app.asar.unpacked')
    }

    Copy-Item -LiteralPath $ManifestPath -Destination (Join-Path $InstallRoot 'guard-manifest.json')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-Guard.ps1') -Destination (Join-Path $InstallRoot 'Start-Guard.ps1')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Start-Guard.cmd') -Destination (Join-Path $InstallRoot 'Start-Guard.cmd')

    $installation = [ordered]@{
        schema_version = 1
        installed_at = (Get-Date).ToUniversalTime().ToString('o')
        package_version = [string]$manifest.package_version
        source_app_asar_sha256 = $sourceArchiveHash
        guarded_app_asar_sha256 = $guardedArchiveHash
        install_root = $InstallRoot
    }
    [IO.File]::WriteAllText(
        (Join-Path $InstallRoot 'installation.json'),
        ($installation | ConvertTo-Json -Depth 4),
        [Text.UTF8Encoding]::new($false)
    )

    if (-not $NoDesktopShortcut) {
        $desktop = [Environment]::GetFolderPath('Desktop')
        $shortcutPath = Join-Path $desktop 'Codex Quick Chat Pro Guard.lnk'
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $InstallRoot 'Start-Guard.cmd'
        $shortcut.WorkingDirectory = $InstallRoot
        $shortcut.IconLocation = "$(Join-Path $installedAppRoot 'ChatGPT.exe'),0"
        $shortcut.Description = 'Fail-closed GPT-5.6 Pro route guard for Codex Quick Chat'
        $shortcut.Save()
        Write-Output "DesktopShortcut=$shortcutPath"
    }

    & (Join-Path $InstallRoot 'Start-Guard.ps1') -NoUi -VerifyOnly

    Write-Output "INSTALL_OK $InstallRoot"
    Write-Output "Backup=$backupRoot"
} catch {
    $originalError = $_
    try {
        if ($installWasCreated -and (Test-Path -LiteralPath $InstallRoot)) {
            $failedRoot = "$InstallRoot.failed-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
            Move-Item -LiteralPath $InstallRoot -Destination $failedRoot
            Write-Warning "Partial installation was preserved at: $failedRoot"
        }
        if ($backupRoot -and (Test-Path -LiteralPath $backupRoot) -and -not (Test-Path -LiteralPath $InstallRoot)) {
            Move-Item -LiteralPath $backupRoot -Destination $InstallRoot
            Write-Warning "Previous installation was restored at: $InstallRoot"
        }
    } catch {
        Write-Warning "Installation recovery also failed: $($_.Exception.Message)"
    }
    throw $originalError
} finally {
    if (Test-Path -LiteralPath $tempRoot -PathType Container) {
        $resolvedTemp = [IO.Path]::GetFullPath($tempRoot)
        if ($resolvedTemp.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -and
            (Split-Path -Leaf $resolvedTemp).StartsWith('codex-quickchat-pro-guard-', [StringComparison]::Ordinal)) {
            Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
        }
    }
}
