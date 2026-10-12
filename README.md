# Encoding Bridge MCP

[中文说明 / README_CN](README_CN.md)

Claude Code's built-in file tools assume UTF-8, so non-UTF-8 files show
garbled text. Encoding Bridge auto-detects the file encoding and writes back
in the original encoding.

---

## What it's for

Projects that need to read and write non-UTF-8 files.

## Install

In a project that handles legacy encodings (GBK/GB2312, etc.), add a
`.mcp.json` in the project root and set `ENCODING_BRIDGE_ROOTS` to the
workspaces Encoding Bridge should handle:

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

`ENCODING_BRIDGE_ROOTS` is the list of workspaces to handle; separate multiple
entries with `;` (Windows) or `:` (Unix).

The `.mcp.json` lives in the first workspace folder VS Code opens.

### Allow the tools in a project

Encoding Bridge uses project-scoped permissions. In each project you want it to
handle, create or edit that project's `.claude/settings.json` to allow the MCP
tools and deny the built-in file tools:

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

---

## Verify it works

Start (or reload) a Claude Code session and ask it to read or search a legacy
file. The tool calls should be `mcp__encoding-bridge__Read` / `Grep` / `Edit` /
`Write`, not the built-in tools. A configured `ENCODING_BRIDGE_ROOTS` directory
will get a `.encoding-bridge/encoding-index.json`, confirming it is enabled.

---

## License

MIT. See [LICENSE](LICENSE).
