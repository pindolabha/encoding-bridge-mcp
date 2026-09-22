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

echo "[2/2] Verifying MCP connection..."
claude mcp get "$SERVER_NAME"

echo
echo "Installed $SERVER_NAME from the current extracted release package."
echo
echo "Next step: allow the MCP tools in the PROJECT's .claude/settings.json."
echo "In the project you want Encoding Bridge to handle, create/edit .claude/settings.json"
echo "with a permissions block like this:"
echo
cat <<'EOF'
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
EOF
echo
echo "This is a project-scoped setting: it applies only in the project that owns"
echo "that .claude/settings.json. No user-level settings file is modified."
echo "Start a new Claude Code session in that project."

