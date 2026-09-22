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

Write-Host "[1/3] Registering Encoding Bridge from npm..."
try { claude mcp remove $ServerName --scope $Scope | Out-Null } catch {}
claude mcp add --scope $Scope $ServerName -- npx -y encoding-bridge-mcp

Write-Host "[2/3] Verifying MCP connection..."
claude mcp get $ServerName

Write-Host "[3/3] Merging Claude Code permissions into ~/.claude/settings.json..."
$apply = Join-Path $PSScriptRoot 'apply-claude-settings.js'
node $apply

Write-Host ""
Write-Host "Installed $ServerName." -ForegroundColor Green
Write-Host "Built-in Read/Grep/Edit/Write/NotebookEdit are denied; MCP tools are allowed."
Write-Host "Start a new Claude Code session."

