param([ValidatePattern('^[a-z0-9-]+$')][string]$Name = 'tunnel')
$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot ".local/$Name-process.json"
if (-not (Test-Path -LiteralPath $stateFile)) { Write-Host 'No recorded tunnel.'; return }
$saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
$running = Get-Process -Id $saved.id -ErrorAction SilentlyContinue
if ($running -and $running.StartTime.ToUniversalTime().Ticks.ToString() -eq $saved.started) {
    Stop-Process -Id $saved.id
}
Remove-Item -LiteralPath $stateFile
Write-Host 'Online access stopped. Local AtomForge remains available.'
