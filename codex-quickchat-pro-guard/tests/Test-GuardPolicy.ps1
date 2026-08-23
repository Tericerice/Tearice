Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-GuardScenario {
    param(
        [Parameter(Mandatory = $true)][object[]]$Events,
        [switch]$Complete
    )

    $state = [ordered]@{
        Verified = $false
        Failed = $false
        Canceled = $false
        Buffered = [Collections.Generic.List[string]]::new()
        Delivered = [Collections.Generic.List[string]]::new()
        Retracted = 0
        ErrorType = $null
    }

    foreach ($event in $Events) {
        if ($state.Failed) { continue }
        if ($event.type -eq 'message') {
            if ($state.Verified) {
                $state.Delivered.Add($event.text)
            } else {
                $state.Buffered.Add($event.text)
            }
            continue
        }
        if ($event.type -ne 'server_ste_metadata') { continue }

        $routeModels = @(
            @($event.metadata.resolved_model_slug, $event.metadata.model_slug) |
                Where-Object { $_ -is [string] -and $_.Length -gt 0 }
        )
        if ($routeModels.Count -eq 0) { continue }
        if (@($routeModels | Where-Object { $_ -ne 'gpt-5-6-pro' }).Count -gt 0) {
            $state.Buffered.Clear()
            $state.Retracted = $state.Delivered.Count
            $state.Delivered.Clear()
            $state.Failed = $true
            $state.Canceled = $true
            $state.ErrorType = 'model-route-mismatch'
            continue
        }

        $state.Verified = $true
        foreach ($message in $state.Buffered) { $state.Delivered.Add($message) }
        $state.Buffered.Clear()
    }

    if ($Complete -and -not $state.Failed -and -not $state.Verified) {
        $state.Buffered.Clear()
        $state.Failed = $true
        $state.ErrorType = 'model-route-unverified'
    }
    return $state
}

function Assert-Equal {
    param($Actual, $Expected, [Parameter(Mandatory = $true)][string]$Label)
    if ($Actual -ne $Expected) {
        throw "$Label expected '$Expected', got '$Actual'"
    }
}

$normalEvents = @(
    [pscustomobject]@{ type = 'message'; text = 'buffered-before-proof' },
    [pscustomobject]@{
        type = 'server_ste_metadata'
        metadata = [pscustomobject]@{
            model_slug = 'gpt-5-6-pro'
            resolved_model_slug = 'gpt-5-6-pro'
        }
    },
    [pscustomobject]@{ type = 'message'; text = 'delivered-after-proof' }
)
$normal = Invoke-GuardScenario -Complete -Events $normalEvents
Assert-Equal $normal.Failed $false 'normal.failed'
Assert-Equal $normal.Delivered.Count 2 'normal.delivered'

$mini = Invoke-GuardScenario -Complete -Events @(
    [pscustomobject]@{ type = 'message'; text = 'must-not-survive' },
    [pscustomobject]@{
        type = 'server_ste_metadata'
        metadata = [pscustomobject]@{
            model_slug = 'gpt-5-5-mini'
            resolved_model_slug = 'gpt-5-5-mini'
        }
    }
)
Assert-Equal $mini.Failed $true 'mini.failed'
Assert-Equal $mini.Canceled $true 'mini.canceled'
Assert-Equal $mini.Delivered.Count 0 'mini.delivered'
Assert-Equal $mini.ErrorType 'model-route-mismatch' 'mini.error'

$conflict = Invoke-GuardScenario -Complete -Events @(
    [pscustomobject]@{
        type = 'server_ste_metadata'
        metadata = [pscustomobject]@{
            model_slug = 'gpt-5-6-pro'
            resolved_model_slug = 'gpt-5-5-mini'
        }
    }
)
Assert-Equal $conflict.Failed $true 'conflict.failed'

$lateDowngrade = Invoke-GuardScenario -Complete -Events @(
    [pscustomobject]@{ type = 'message'; text = 'buffered' },
    [pscustomobject]@{
        type = 'server_ste_metadata'
        metadata = [pscustomobject]@{
            model_slug = 'gpt-5-6-pro'
            resolved_model_slug = 'gpt-5-6-pro'
        }
    },
    [pscustomobject]@{ type = 'message'; text = 'delivered' },
    [pscustomobject]@{
        type = 'server_ste_metadata'
        metadata = [pscustomobject]@{
            model_slug = 'gpt-5-6-pro'
            resolved_model_slug = 'gpt-5-5-mini'
        }
    }
)
Assert-Equal $lateDowngrade.Failed $true 'late-downgrade.failed'
Assert-Equal $lateDowngrade.Delivered.Count 0 'late-downgrade.delivered'
Assert-Equal $lateDowngrade.Retracted 2 'late-downgrade.retracted'

$missing = Invoke-GuardScenario -Complete -Events @(
    [pscustomobject]@{ type = 'message'; text = 'must-remain-hidden' },
    [pscustomobject]@{
        type = 'server_ste_metadata'
        metadata = [pscustomobject]@{
            model_slug = $null
            resolved_model_slug = $null
        }
    }
)
Assert-Equal $missing.Failed $true 'missing.failed'
Assert-Equal $missing.Delivered.Count 0 'missing.delivered'
Assert-Equal $missing.ErrorType 'model-route-unverified' 'missing.error'

$serverModelOnly = Invoke-GuardScenario -Complete -Events @(
    [pscustomobject]@{ type = 'message'; text = 'server-route-is-pro' },
    [pscustomobject]@{
        type = 'server_ste_metadata'
        metadata = [pscustomobject]@{
            model_slug = 'gpt-5-6-pro'
            resolved_model_slug = $null
        }
    }
)
Assert-Equal $serverModelOnly.Failed $false 'server-model-only.failed'
Assert-Equal $serverModelOnly.Delivered.Count 1 'server-model-only.delivered'

Write-Output 'GuardPolicyScenarios=6'
Write-Output 'GuardPolicyResult=PASS'
