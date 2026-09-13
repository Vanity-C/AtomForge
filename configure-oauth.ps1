[CmdletBinding()]
param(
    [switch]$Check,
    [ValidateSet('github', 'gitee', 'netlify')]
    [string[]]$Provider = @('github', 'gitee', 'netlify')
)
$ErrorActionPreference = 'Stop'
$taskEnvPath = Join-Path $PSScriptRoot 'app/backend/.env.local'
if (-not (Test-Path -LiteralPath $taskEnvPath)) { throw 'Run setup.ps1 first to create app/backend/.env.local.' }
$taskLines = [System.Collections.Generic.List[string]]::new()
foreach ($line in [System.IO.File]::ReadAllLines($taskEnvPath)) { $taskLines.Add($line) }

function Get-Setting([string]$Name) {
    $found = @($taskLines | Where-Object { $_ -match ('^\s*' + [regex]::Escape($Name) + '\s*=') })
    if (-not $found.Count) { return '' }
    return ($found[-1] -split '=', 2)[1].Trim().Trim([char[]]@("'", '"'))
}
function Set-Setting([string]$Name, [string]$Value) {
    $matched = $false
    for ($i = $taskLines.Count - 1; $i -ge 0; $i--) {
        if ($taskLines[$i] -match ('^\s*' + [regex]::Escape($Name) + '\s*=')) {
            if (-not $matched) { $taskLines[$i] = $Name + '=' + $Value; $matched = $true }
            else { $taskLines.RemoveAt($i) }
        }
    }
    if (-not $matched) { $taskLines.Add($Name + '=' + $Value) }
}
function Show-Status {
    $origin = Get-Setting 'ATOMFORGE_PUBLIC_ORIGIN'
    Write-Host ('Website origin: ' + $origin)
    foreach ($taskProvider in $Provider) {
        $prefix = 'ATOMFORGE_' + $taskProvider.ToUpper()
        $configured = (Get-Setting ($prefix + '_CLIENT_ID')) -and (Get-Setting ($prefix + '_CLIENT_SECRET'))
        Write-Host ($taskProvider + ': ' + $(if ($configured) { 'credentials present (not yet verified with provider)' } else { 'application credentials missing' }))
        Write-Host ('Callback: ' + $origin + '/api/v1/af-auth/oauth/' + $taskProvider + '/callback')
    }
}
if ($Check) { Show-Status; return }
Write-Host 'Create an OAuth application on each provider first. Personal access tokens cannot enable sign-in.'
Write-Host 'GitHub: https://github.com/settings/applications/new'
Write-Host 'Gitee:  https://gitee.com/oauth/applications'
Write-Host 'Netlify: https://app.netlify.com/user/applications (OAuth application, not a personal access token)'
$taskOrigin = Get-Setting 'ATOMFORGE_PUBLIC_ORIGIN'
if (-not $taskOrigin) { $taskOrigin = 'http://127.0.0.1:15173' }
$taskOrigin = $taskOrigin.Trim().TrimEnd('/')
$taskEnteredOrigin = Read-Host ('Browser-facing website origin [Enter keeps ' + $taskOrigin + ']')
if ($taskEnteredOrigin.Trim()) { $taskOrigin = $taskEnteredOrigin.Trim().TrimEnd('/') }
$taskUri = $null
if (-not [Uri]::TryCreate($taskOrigin, [UriKind]::Absolute, [ref]$taskUri) -or $taskUri.UserInfo -or $taskUri.Query -or $taskUri.Fragment -or $taskUri.AbsolutePath -ne '/' -or ($taskUri.Scheme -ne 'https' -and -not ($taskUri.Scheme -eq 'http' -and $taskUri.Host -in @('localhost', '127.0.0.1')))) { throw 'Use an HTTPS origin, or http://127.0.0.1:PORT for local development, without any path.' }
Set-Setting 'ATOMFORGE_PUBLIC_ORIGIN' $taskOrigin
foreach ($taskProvider in $Provider) {
    Write-Host ('Callback for ' + $taskProvider + ': ' + $taskOrigin + '/api/v1/af-auth/oauth/' + $taskProvider + '/callback')
    $taskId = Read-Host ($taskProvider + ' OAuth Client ID [Enter skips this provider]')
    if (-not $taskId.Trim()) { continue }
    if ($taskId.Trim() -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Invalid Client ID format.' }
    $taskSecure = Read-Host ($taskProvider + ' OAuth Client Secret (hidden)') -AsSecureString
    $taskPtr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($taskSecure)
    try {
        $taskSecret = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($taskPtr).Trim()
        if ($taskSecret -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Client Secret is empty or has unexpected characters. Nothing has been saved.' }
        $taskPrefix = 'ATOMFORGE_' + $taskProvider.ToUpper()
        Set-Setting ($taskPrefix + '_CLIENT_ID') $taskId.Trim()
        Set-Setting ($taskPrefix + '_CLIENT_SECRET') $taskSecret
    } finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($taskPtr)
        $taskSecret = $null
        $taskSecure.Dispose()
    }
}
[System.IO.File]::WriteAllLines($taskEnvPath, $taskLines, [System.Text.UTF8Encoding]::new($false))
Show-Status
Write-Host 'Saved locally. Restart the AtomForge backend, then open the configured website origin and connect the provider. Netlify is used for deployment, not sign-in.'
