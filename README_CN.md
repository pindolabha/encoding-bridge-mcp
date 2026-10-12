# Encoding Bridge MCP（中文说明）

[English README](README.md)

Claude 内置工具默认按 UTF-8 读写文件，非 UTF-8 文件会乱码。Encoding Bridge 自动识别文件编码，再按原编码写回。

---

## 适合什么项目

需要读写非 UTF-8 文件的项目。

## 安装

在需要处理遗留编码（GBK/GB2312 等）的项目里，项目根目录加一个 `.mcp.json`，在 `ENCODING_BRIDGE_ROOTS` 里配置要用 Encoding Bridge 的工作区（根目录）：

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

`ENCODING_BRIDGE_ROOTS` 是要处理的工作区列表，多个用 `;`（Windows）或 `:`（Unix）分隔。

### 在项目里放行工具（项目级）

Encoding Bridge 用的是**项目级**权限：在你想让它处理的每个项目里，创建或编辑该项目的 `.claude/settings.json`，允许 MCP 工具、禁用内置文件工具：

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

## 确认是否正常工作

新开（或重载）一个 Claude Code 会话，让它读或搜索一个旧编码文件。工具调用应是 `mcp__encoding-bridge__Read` / `Grep` / `Edit` / `Write`，而不是内置同名工具。配了 `ENCODING_BRIDGE_ROOTS` 的目录下会生成 `.encoding-bridge/encoding-index.json`，说明已启用。

---

## 许可证

MIT，见 [LICENSE](LICENSE)。
