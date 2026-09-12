$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $PSScriptRoot '.local/processes.json'
$saved = if (Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json } else { @() }
foreach ($entry in $saved) {
    $running = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if ($running -and $running.StartTime.ToUniversalTime().Ticks.ToString() -eq $entry.started) {
        Stop-Process -Id $entry.id
        Write-Host "Stopped $($entry.service)."
    }
}
if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile }
& docker compose -f (Join-Path $PSScriptRoot 'compose.local.yaml') stop
