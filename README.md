# Encoding Bridge MCP

[中文说明 / README_CN](README_CN.md)

Encoding-transparent file tools for Claude Code and other MCP clients.

Encoding Bridge exposes `Read`, `Grep`, `Edit`, and `Write` over MCP. It detects on-disk encodings, shows Unicode to the model, and writes files back in their original encoding.

It is designed for legacy codebases that still use GBK/GB2312/GB18030, Big5, Shift-JIS, EUC-KR, Windows codepages, UTF-16, and other non-UTF-8 encodings.

## Recommended install

This is now the single recommended installation path for end users.

### Windows

```powershell
# Remove an older install with the same name first, if one exists.
claude mcp remove encoding-bridge -s user

# Register the npm package once, at user scope. `cmd` is required on Windows.
claude mcp add --scope user encoding-bridge -- cmd /d /s /c "npx -y encoding-bridge-mcp"
claude mcp get encoding-bridge
```

### macOS / Linux

```bash
# Remove an older install with the same name first, if one exists.
claude mcp remove encoding-bridge -s user

# Register the npm package once, at user scope.
claude mcp add --scope user encoding-bridge -- npx -y encoding-bridge-mcp
claude mcp get encoding-bridge
```

If `claude mcp get` reports `Connected`, installation succeeded. Start a **new** Claude Code session. Install scripts merge permissions automatically (MCP tools allowed, built-in file tools denied). The first Read/Grep in a mixed-encoding repo builds a local encoding index in the background.

What this requires locally:

- `claude`
- `node`

What it does **not** require:

- `git clone`
- `npm install`
- `npm run build`
- downloading a GitHub Release package first

### Avoid duplicate MCP registrations

Register `encoding-bridge` in only one scope. Claude Code treats the same server name with different commands as a configuration conflict—for example, an older user-scoped local build and this repository's project-scoped `.mcp.json` npm command.

Run `claude mcp list` to diagnose duplicates. Keep the endpoint you want, then remove the other registration:

```powershell
# Keep the npm command from the user-scoped installation.
claude mcp remove encoding-bridge -s project

# Or keep a project-local configuration and remove a previous user installation.
claude mcp remove encoding-bridge -s user
```

After removing a registration, run `claude mcp get encoding-bridge` again. It must report one endpoint with status `Connected`.

### Multi-root workspaces

A single-folder workspace works with **zero configuration**: the MCP process
`cwd` (the VS Code working directory) is used as the index root, so files
under it are read and indexed automatically.

In a **multi-root workspace**, only the first folder is the process `cwd`.
Encoding Bridge cannot discover the other folders by itself (VS Code does not
expose them to MCP server processes), so they must be listed explicitly via
the `ENCODING_BRIDGE_ROOTS` environment variable in the project `.mcp.json`:

```json
{
  "mcpServers": {
    "encoding-bridge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "encoding-bridge-mcp"],
      "env": {
        "ENCODING_BRIDGE_ROOTS": "C:/path/to/project-a;C:/path/to/project-b"
      }
    }
  }
}
```

- `ENCODING_BRIDGE_ROOTS` is a path-separator (`;` on Windows, `:` on
  Unix) delimited list of root directories. Each root gets its own
  `.encoding-bridge/encoding-index.json`.
- Files are resolved to the deepest listed root that contains them.
- This file lives in the project root, so it persists across restarts — you
  configure it once, not on every reload.
- Other users put their **own** paths here; the published package contains no
  hard-coded paths.

---

## Why

Claude Code built-in file tools assume UTF-8 for normal text reads. In legacy projects this can lead to:

- unreadable C/C++ comments and string literals;
- searches that silently miss text;
- edits that corrupt the original codepage;
- accidental UTF-8 rewrites of GBK or other legacy files.

Encoding Bridge keeps encoding conversion below the model boundary:

```text
legacy bytes on disk -> detect encoding -> Unicode for the LLM
Unicode from the LLM -> strict encode in the original encoding -> bytes on disk
```

If new text cannot be represented in the target encoding, the write fails instead of silently replacing characters with `?`.

Install scripts merge Claude Code permissions automatically. Start a **new** session after installing. The first file tool use in a project builds a local encoding index if one does not exist yet.

---

## Verify the setup

### 1. Check the MCP is connected

```bash
claude mcp get encoding-bridge
```

Expected:

- name: `encoding-bridge`
- status: `Connected`

### 2. Start a fresh Claude Code session in a legacy project

### 3. Ask Claude to read or search a legacy-encoded file

Examples:

```text
Read SourceCode/Main.cpp and show the first 10 lines.
```

```text
Search SourceCode for the string 错误码.
```

### 4. Confirm the model uses Encoding Bridge tools

In a verbose / print-mode session, the tool call should be one of:

- `mcp__encoding-bridge__Read`
- `mcp__encoding-bridge__Grep`
- `mcp__encoding-bridge__Edit`
- `mcp__encoding-bridge__Write`

It should **not** call built-in `Read`, `Grep`, `Edit`, or `Write`.

---

## Features

- Encoding-aware `Read`, `Grep`, `Edit`, and `Write` tools.
- Automatic encoding detection and a local index built on first use.
- Install scripts deny built-in file tools and allow the MCP tools.
- GBK/GB2312/GB18030, Big5, Shift-JIS, EUC-KR, Windows codepages, UTF-8, and UTF-16 support.
- BOM and dominant line-ending preservation for edits.
- Read-before-write protection and stale-write detection.
- Image, PDF, and Jupyter Notebook reading.
- Grep: ASCII in one pass; non-ASCII grouped by encoding.

---

## Development

```bash
npm install
npm run check
npm test
npm run build
npm start
```

## License

MIT. See [LICENSE](LICENSE).
