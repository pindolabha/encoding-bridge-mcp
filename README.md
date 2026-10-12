# Encoding Bridge MCP

[中文说明 / README_CN](README_CN.md)

Encoding-transparent file tools for Claude Code and other MCP clients.

Encoding Bridge exposes `Read`, `Grep`, `Edit`, and `Write` over MCP. It detects on-disk encodings, shows Unicode to the model, and writes files back in their original encoding.

It is designed for legacy codebases that still use GBK/GB2312/GB18030, Big5, Shift-JIS, EUC-KR, Windows codepages, UTF-16, and other non-UTF-8 encodings.

## Recommended install

Encoding Bridge is configured **per project** via that project's `.mcp.json`.
It only engages for roots listed in `ENCODING_BRIDGE_ROOTS`; without
configuration the tools throw, so Claude falls back to its built-in file tools.
The VS Code working directory is NOT auto-treated as a root.

### Per-project `.mcp.json`

In each project you want Encoding Bridge to handle, add a `.mcp.json` in the
project root that registers the MCP server and sets `ENCODING_BRIDGE_ROOTS` to
the directories that have legacy encodings:

```json
{
  "mcpServers": {
    "encoding-bridge": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "encoding-bridge-mcp"],
      "env": {
        "ENCODING_BRIDGE_ROOTS": "E:/path/to/project-a;E:/path/to/project-b"
      }
    }
  }
}
```

- `ENCODING_BRIDGE_ROOTS` is a path-separator (`;` on Windows, `:` on Unix)
  delimited list of root directories. Each listed root gets its own
  `.encoding-bridge/encoding-index.json`.
- A single-folder project only needs its own path listed; you do not need to
  configure anything globally.
- Projects **without** a `.mcp.json` (or without `ENCODING_BRIDGE_ROOTS`) are
  left untouched — Encoding Bridge does not build an index, start a watcher, or
  probe encodings there; Claude uses its built-in tools.

After adding the file, start a **new** Claude Code session in that project.

### Allow the tools in a project

Encoding Bridge uses **project-scoped** permissions: in each project you want it to
handle, create or edit the project's `.claude/settings.json` so the MCP tools are
allowed and the built-in file tools are denied:

```json
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
```

This is deliberately project-scoped: it applies only in the project that owns that
`.claude/settings.json`, and no user-level `~/.claude/settings.json` is modified.
The first Read/Grep in a mixed-encoding repo builds a local encoding index in the
background.

What this requires locally:

- `claude`
- `node`

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

Permissions are configured per project in the project's `.claude/settings.json` (see
[Allow the tools in a project](#allow-the-tools-in-a-project)). Start a **new**
session after installing. The first file tool use in a project builds a local
encoding index if one does not exist yet.

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
- Per-project `permissions` in `.claude/settings.json` to allow the MCP tools and deny the built-in file tools.
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
