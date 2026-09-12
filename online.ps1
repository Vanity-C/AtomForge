param([ValidateRange(1,65535)][int]$Port = 8080, [ValidatePattern('^[a-z0-9-]+$')][string]$Name = 'tunnel')
$ErrorActionPreference = 'Stop'
$runtime = Join-Path $PSScriptRoot '.local'
$tunnel = Join-Path $runtime 'tools/cloudflared.exe'
if (-not (Test-Path -LiteralPath $tunnel)) { throw 'cloudflared missing: see README.md.' }
$health = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 5
if ($health.status -ne 'healthy') { throw 'Start AtomForge first.' }
$stateFile = Join-Path $runtime "$Name-process.json"
if (Test-Path -LiteralPath $stateFile) {
    $saved = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    $running = Get-Process -Id $saved.id -ErrorAction SilentlyContinue
    if ($running -and $running.StartTime.ToUniversalTime().Ticks.ToString() -eq $saved.started) {
        throw 'Tunnel already running. Use offline.ps1 before creating another link.'
    }
}
$process = Start-Process -FilePath $tunnel -ArgumentList "tunnel --no-autoupdate --protocol http2 --url http://127.0.0.1:$Port" -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput "$runtime/$Name.out.log" -RedirectStandardError "$runtime/$Name.err.log"
@{id=$process.Id; started=$process.StartTime.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8
Write-Host "Tunnel started. The HTTPS link will appear in .local/$Name.err.log."
