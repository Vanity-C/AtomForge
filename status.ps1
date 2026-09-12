$ErrorActionPreference = 'Stop'
$portFile = Join-Path $PSScriptRoot '.local/ports.json'
$frontendPort = if (Test-Path -LiteralPath $portFile) { (Get-Content -LiteralPath $portFile -Raw | ConvertFrom-Json).frontendPort } else { 15173 }
$web = Invoke-WebRequest "http://127.0.0.1:$frontendPort" -UseBasicParsing -TimeoutSec 5
$runner = Invoke-RestMethod 'http://127.0.0.1:8001/ready' -TimeoutSec 15
$api = Invoke-RestMethod 'http://127.0.0.1:18000/health' -TimeoutSec 5
$db = Invoke-RestMethod 'http://127.0.0.1:18000/database/health' -TimeoutSec 5
if ($web.StatusCode -ne 200 -or $api.status -ne 'healthy' -or $db.status -ne 'healthy' -or $runner.status -ne 'ready') {
    throw 'AtomForge health check failed. Inspect .local/*.log.'
}
Write-Host "Frontend, backend, database and verification browser are ready: http://127.0.0.1:$frontendPort"
