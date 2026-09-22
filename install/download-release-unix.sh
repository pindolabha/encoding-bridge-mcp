#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-latest}"
SERVER_NAME="${SERVER_NAME:-encoding-bridge}"
SCOPE="${SCOPE:-user}"
REPO="pindolabha/encoding-bridge-mcp"
INSTALL_ROOT="${HOME}/.encoding-bridge"
RELEASE_ROOT="${INSTALL_ROOT}/releases"

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_command node
require_command claude
require_command curl
require_command tar
require_command uname

mkdir -p "$RELEASE_ROOT"

platform="$(uname -s)"
arch="$(uname -m)"
case "$platform" in
  Linux) os="linux" ;;
  Darwin) os="darwin" ;;
  *) echo "Unsupported platform: $platform" >&2; exit 1 ;;
esac
case "$arch" in
  x86_64|amd64) cpu="x64" ;;
  arm64|aarch64) cpu="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

if [ "$VERSION" = "latest" ]; then
  api_url="https://api.github.com/repos/$REPO/releases/latest"
else
  api_url="https://api.github.com/repos/$REPO/releases/tags/$VERSION"
fi

release_json="$(curl -fsSL -H 'User-Agent: encoding-bridge-installer' "$api_url")"
tag="$(printf '%s' "$release_json" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); process.stdout.write(data.tag_name)")"
asset_name="encoding-bridge-${tag}-${os}-${cpu}.tar.gz"
asset_url="$(printf '%s' "$release_json" | node -e "const fs=require('fs'); const data=JSON.parse(fs.readFileSync(0,'utf8')); const asset=data.assets.find(a=>a.name===process.argv[1]); if(!asset){process.exit(2)} process.stdout.write(asset.browser_download_url)" "$asset_name")" || {
  echo "Release asset not found: $asset_name" >&2
  exit 1
}

archive="$INSTALL_ROOT/$asset_name"
target_dir="$RELEASE_ROOT/$tag"
rm -rf "$target_dir"
mkdir -p "$target_dir"

echo "[1/3] Downloading $asset_name ..."
curl -fsSL -H 'User-Agent: encoding-bridge-installer' "$asset_url" -o "$archive"

echo "[2/3] Extracting release ..."
tar -xzf "$archive" -C "$target_dir"
rm -f "$archive"

package_root="$target_dir/encoding-bridge-${tag}-${os}-${cpu}"
if [ ! -d "$package_root" ]; then
  echo "Expected extracted package directory not found: $package_root" >&2
  exit 1
fi

echo "[3/3] Installing extracted release package ..."
bash "$package_root/install/install-this-release-unix.sh" "$SERVER_NAME"
