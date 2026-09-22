param(
  [string]$Version = 'latest',
  [string]$ServerName = 'encoding-bridge',
  [string]$Scope = 'user'
)

$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $packageRoot 'dist\src\server.js'

if (Test-Path $entry) {
  Write-Host 'Detected an extracted release package in the current directory. Installing from local files...'
  & (Join-Path $PSScriptRoot 'install-this-release-windows.ps1') -ServerName $ServerName -Scope $Scope
  exit 0
}

Write-Host 'No local extracted release package detected. Downloading from GitHub Release...'
& (Join-Path $PSScriptRoot 'download-release-windows.ps1') -Version $Version -ServerName $ServerName -Scope $Scope
