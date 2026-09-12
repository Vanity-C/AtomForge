param([int]$Port = 15173)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$runtime = Join-Path $root '.local'
$python = Join-Path $root '.venv/Scripts/python.exe'
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
foreach ($servicePort in @($Port, 18000)) {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $servicePort)
    try { $listener.Start() } finally { $listener.Stop() }
}
& docker compose -f (Join-Path $root 'compose.local.yaml') up -d --build --wait --wait-timeout 90
if ($LASTEXITCODE -ne 0) { throw 'Verification service could not start. Check Docker Desktop and .\compose.local.yaml.' }
$ready = Invoke-RestMethod 'http://127.0.0.1:8001/ready' -TimeoutSec 15
if ($ready.status -ne 'ready') { throw 'Verification compiler/browser is not ready.' }
Push-Location (Join-Path $root 'app/backend')
try {
    & $python (Join-Path $root 'scripts/init_local.py')
    if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed.' }
} finally { Pop-Location }
$api = Start-Process -FilePath $python -ArgumentList '-m uvicorn main:app --host 127.0.0.1 --port 18000 --env-file .env.local' -WorkingDirectory (Join-Path $root 'app/backend') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime/backend.out.log" -RedirectStandardError "$runtime/backend.err.log"
$node = (Get-Command node.exe).Source
$env:BACKEND_PORT = '18000'
$web = Start-Process -FilePath $node -ArgumentList "node_modules/vite/bin/vite.js --host 127.0.0.1 --port $Port --strictPort" -WorkingDirectory (Join-Path $root 'app/frontend') -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime/frontend.out.log" -RedirectStandardError "$runtime/frontend.err.log"
@(
    @{ id = $api.Id; started = $api.StartTime.ToUniversalTime().Ticks.ToString(); service = 'backend' }
    @{ id = $web.Id; started = $web.StartTime.ToUniversalTime().Ticks.ToString(); service = 'frontend' }
) | ConvertTo-Json | Set-Content (Join-Path $runtime 'processes.json') -Encoding UTF8
@{ frontendPort = $Port } | ConvertTo-Json | Set-Content (Join-Path $runtime 'ports.json') -Encoding UTF8
$launched = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $apiHealth = Invoke-RestMethod 'http://127.0.0.1:18000/database/health' -TimeoutSec 2
        $webHealth = Invoke-WebRequest "http://127.0.0.1:$Port" -UseBasicParsing -TimeoutSec 2
        if ($apiHealth.status -eq 'healthy' -and $webHealth.StatusCode -eq 200) { $launched = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $launched) {
    Stop-Process -Id $api.Id,$web.Id -ErrorAction SilentlyContinue
    throw 'Frontend/backend startup did not complete. Inspect .local/*.log.'
}
Write-Host "Services launched. AtomForge: http://127.0.0.1:$Port"
Write-Host 'Logs: .local/*.log. Stop: .\stop.ps1'

