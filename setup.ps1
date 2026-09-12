$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    if (-not (Test-Path '.venv/Scripts/python.exe')) {
        uv venv .venv --python 3.12
        if ($LASTEXITCODE -ne 0) { throw 'Python environment creation failed.' }
    }
    uv pip install --python .venv/Scripts/python.exe -r app/backend/requirements.lock.txt
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependency installation failed.' }
    Push-Location app/frontend
    try {
        pnpm install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    } finally { Pop-Location }
} finally { Pop-Location }
Write-Host 'Dependencies ready. Run .\start.ps1'
