param(
  [string]$Version = 'latest',
  [string]$ServerName = 'encoding-bridge',
  [string]$Scope = 'user'
)

$ErrorActionPreference = 'Stop'

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

Require-Command node
Require-Command claude
Require-Command powershell

$Repo = 'pindolabha/encoding-bridge-mcp'
$InstallRoot = Join-Path $env:USERPROFILE '.encoding-bridge'
$ReleaseRoot = Join-Path $InstallRoot 'releases'
New-Item -ItemType Directory -Force -Path $ReleaseRoot | Out-Null

function Get-ReleaseInfo {
  param([string]$Version)
  if ($Version -eq 'latest') {
    $url = "https://api.github.com/repos/$Repo/releases/latest"
  } else {
    $url = "https://api.github.com/repos/$Repo/releases/tags/$Version"
  }
  Invoke-RestMethod -Uri $url -Headers @{ 'User-Agent' = 'encoding-bridge-installer' }
}

$release = Get-ReleaseInfo -Version $Version
$tag = $release.tag_name
$assetName = "encoding-bridge-$tag-win32-x64.zip"
$asset = $release.assets | Where-Object { $_.name -eq $assetName } | Select-Object -First 1
if (-not $asset) {
  throw "Release asset not found: $assetName"
}

$zipPath = Join-Path $InstallRoot $assetName
$targetDir = Join-Path $ReleaseRoot $tag
if (Test-Path $targetDir) {
  Remove-Item -Recurse -Force $targetDir
}

Write-Host "[1/3] Downloading $assetName ..."
Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath -Headers @{ 'User-Agent' = 'encoding-bridge-installer' }

Write-Host "[2/3] Extracting release ..."
Expand-Archive -Path $zipPath -DestinationPath $targetDir -Force
Remove-Item -Force $zipPath

$packageRoot = Join-Path $targetDir "encoding-bridge-$tag-win32-x64"
if (-not (Test-Path $packageRoot)) {
  throw "Expected extracted package directory not found: $packageRoot"
}

Write-Host "[3/3] Installing extracted release package ..."
& (Join-Path $packageRoot 'install\install-this-release-windows.ps1') -ServerName $ServerName -Scope $Scope
