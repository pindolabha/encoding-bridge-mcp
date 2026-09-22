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
require_command npm
require_command claude

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="$REPO_ROOT/dist/src/server.js"

echo "[1/4] Installing npm dependencies..."
npm --prefix "$REPO_ROOT" install

echo "[2/4] Building Encoding Bridge..."
npm --prefix "$REPO_ROOT" run build

if [ ! -f "$ENTRY" ]; then
  echo "Build did not produce $ENTRY" >&2
  exit 1
fi

echo "[3/4] Registering Claude Code MCP..."
claude mcp remove "$SERVER_NAME" --scope "$SCOPE" >/dev/null 2>&1 || true
claude mcp add --scope "$SCOPE" "$SERVER_NAME" -- node "$ENTRY"

echo "[4/5] Verifying MCP connection..."
claude mcp get "$SERVER_NAME"

echo "[5/5] Merging Claude Code permissions into ~/.claude/settings.json..."
node "$(cd "$(dirname "$0")" && pwd)/apply-claude-settings.js"

echo
echo "Installed $SERVER_NAME from source."
echo "Built-in Read/Grep/Edit/Write/NotebookEdit are denied; MCP tools are allowed."
echo "Start a new Claude Code session."
