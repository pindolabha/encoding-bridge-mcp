param(
  [string]$ServerName = "encoding-bridge",
  [string]$Scope = "user"
)

$ErrorActionPreference = "Stop"

function Require-Command($name) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $name"
  }
}

Require-Command node
Require-Command npm
Require-Command claude

$repoRoot = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $repoRoot "dist\src\server.js"

Write-Host "[1/4] Installing npm dependencies..."
npm --prefix $repoRoot install

Write-Host "[2/4] Building Encoding Bridge..."
npm --prefix $repoRoot run build

if (-not (Test-Path $entry)) {
  throw "Build did not produce $entry"
}

Write-Host "[3/4] Registering Claude Code MCP..."
try {
  claude mcp remove $ServerName --scope $Scope | Out-Null
} catch {}
claude mcp add --scope $Scope $ServerName -- node $entry

Write-Host "[4/5] Verifying MCP connection..."
claude mcp get $ServerName

Write-Host "[5/5] Merging Claude Code permissions into ~/.claude/settings.json..."
node (Join-Path $PSScriptRoot 'apply-claude-settings.js')

Write-Host ""
Write-Host "Installed $ServerName from source." -ForegroundColor Green
Write-Host "Built-in Read/Grep/Edit/Write/NotebookEdit are denied; MCP tools are allowed."
Write-Host "Start a new Claude Code session."
