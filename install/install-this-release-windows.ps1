param(
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

$packageRoot = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $packageRoot 'dist\src\server.js'

if (-not (Test-Path $entry)) {
  throw "This directory does not look like an extracted Encoding Bridge release package. Missing: $entry"
}

Write-Host "[1/2] Registering Claude Code MCP from this release package..."
try { claude mcp remove $ServerName --scope $Scope | Out-Null } catch {}
claude mcp add --scope $Scope $ServerName -- node $entry

Write-Host "[2/3] Verifying MCP connection..."
claude mcp get $ServerName

Write-Host "[3/3] Merging Claude Code permissions into ~/.claude/settings.json..."
node (Join-Path $PSScriptRoot 'apply-claude-settings.js')

Write-Host ""
Write-Host "Installed $ServerName from the current extracted release package." -ForegroundColor Green
Write-Host "Built-in Read/Grep/Edit/Write/NotebookEdit are denied; MCP tools are allowed."
Write-Host "Start a new Claude Code session."

