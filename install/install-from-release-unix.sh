#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-latest}"
SERVER_NAME="${SERVER_NAME:-encoding-bridge}"
SCOPE="${SCOPE:-user}"

PACKAGE_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENTRY="$PACKAGE_ROOT/dist/src/server.js"

if [ -f "$ENTRY" ]; then
  echo "Detected an extracted release package in the current directory. Installing from local files..."
  bash "$PACKAGE_ROOT/install/install-this-release-unix.sh" "$SERVER_NAME"
  exit 0
fi

echo "No local extracted release package detected. Downloading from GitHub Release..."
SCOPE="$SCOPE" SERVER_NAME="$SERVER_NAME" bash "$PACKAGE_ROOT/install/download-release-unix.sh" "$VERSION"
