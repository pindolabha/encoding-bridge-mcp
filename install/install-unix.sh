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

echo "[1/3] Registering Encoding Bridge from npm..."
claude mcp remove "$SERVER_NAME" --scope "$SCOPE" >/dev/null 2>&1 || true
claude mcp remove codepage-bridge --scope "$SCOPE" >/dev/null 2>&1 || true
claude mcp add --scope "$SCOPE" "$SERVER_NAME" -- npx -y encoding-bridge-mcp

echo "[2/3] Verifying MCP connection..."
claude mcp get "$SERVER_NAME"

echo "[3/3] Merging Claude Code permissions into ~/.claude/settings.json..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
node "$SCRIPT_DIR/apply-claude-settings.js"

echo
echo "Installed $SERVER_NAME."
echo "Built-in Read/Grep/Edit/Write/NotebookEdit are denied; MCP tools are allowed."
echo "Start a new Claude Code session."

