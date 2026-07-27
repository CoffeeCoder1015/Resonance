[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot

Push-Location $projectRoot
try {
    uv run --locked uvicorn resonance_backend.app:app `
        --host 127.0.0.1 `
        --port 8000
}
finally {
    Pop-Location
}
