#!/usr/bin/env bash
set -euo pipefail

SERVER_NAME="${1:-encoding-bridge}"
SCOPE="${SCOPE:-user}"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_command node
require_command claude

PACKAGE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="$PACKAGE_ROOT/dist/src/server.js"

if [ ! -f "$ENTRY" ]; then
  echo "This directory does not look like an extracted Encoding Bridge release package. Missing: $ENTRY" >&2
  exit 1
fi

echo "[1/2] Registering Claude Code MCP from this release package..."
claude mcp remove "$SERVER_NAME" --scope "$SCOPE" >/dev/null 2>&1 || true
claude mcp add --scope "$SCOPE" "$SERVER_NAME" -- node "$ENTRY"

echo "[2/3] Verifying MCP connection..."
claude mcp get "$SERVER_NAME"

echo "[3/3] Merging Claude Code permissions into ~/.claude/settings.json..."
node "$(cd "$(dirname "$0")" && pwd)/apply-claude-settings.js"

echo
echo "Installed $SERVER_NAME from the current extracted release package."
echo "Built-in Read/Grep/Edit/Write/NotebookEdit are denied; MCP tools are allowed."
echo "Start a new Claude Code session."

