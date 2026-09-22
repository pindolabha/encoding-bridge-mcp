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

Write-Host "[2/2] Verifying MCP connection..."
claude mcp get $ServerName

Write-Host ""
Write-Host "Installed $ServerName from the current extracted release package." -ForegroundColor Green
Write-Host ""
Write-Host "Next step: allow the MCP tools in the PROJECT's .claude/settings.json."
Write-Host "In the project you want Encoding Bridge to handle, create/edit .claude/settings.json"
Write-Host "with a permissions block like this:"
Write-Host ""

$settingsSnippet = @'
{
  "permissions": {
    "allow": [
      "mcp__encoding-bridge__Read",
      "mcp__encoding-bridge__Grep",
      "mcp__encoding-bridge__Edit",
      "mcp__encoding-bridge__Write"
    ],
    "deny": ["Read", "Grep", "Edit", "Write", "NotebookEdit"]
  }
}
'@
Write-Host $settingsSnippet
Write-Host ""
Write-Host "This is a project-scoped setting: it applies only in the project that owns"
Write-Host "that .claude/settings.json. No user-level settings file is modified."
Write-Host "Start a new Claude Code session in that project."

