$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Npm {
    param([string[]]$Arguments)

    & npm @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "npm $($Arguments -join ' ') failed with exit code $LASTEXITCODE."
    }
}

Push-Location (Join-Path $repoRoot 'ui')
try {
    Invoke-Npm run build
    Invoke-Npm run build:pill
}
finally {
    Pop-Location
}

Push-Location $PSScriptRoot
try {
    Invoke-Npm start
}
finally {
    Pop-Location
}
