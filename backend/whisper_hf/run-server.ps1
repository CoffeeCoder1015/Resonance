[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot

Push-Location $projectRoot
try {
    uv run --locked transformers serve openai/whisper-base.en
}
finally {
    Pop-Location
}
