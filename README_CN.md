# Encoding Bridge MCP（中文说明）

[English README](README.md)

Encoding Bridge 是给 Claude Code 用的一组文件工具。

它解决的问题很简单：

如果你的项目不是 UTF-8，而是 GBK、Big5、Shift-JIS、UTF-16 这类编码，Claude Code 自带的 `Read`、`Grep`、`Edit`、`Write` 很容易把文件读乱、搜错、改坏。

Encoding Bridge 会自动识别文件编码，再按原编码写回去：

- 读文件时先解码成正常文字给模型；
- 改已有文件时保持原来的编码、BOM 和换行；
- 新内容如果目标编码表示不了，会直接报错，而不是偷偷写坏。

---

## 适合什么项目

适合这些情况：

- C / C++ 老项目还在用 GBK；
- Windows 老项目用 `windows-1251`、`windows-1252`；
- 日文项目用 `Shift-JIS`；
- 一部分文件是 UTF-16；
- Claude Code 一读文件就乱码，或者一改文件就把编码改坏。

---

## 安装（推荐方式）

只需要执行下面两条命令：

### Windows

```powershell
# 如果以前装过同名的旧版本，先删除旧配置。
claude mcp remove encoding-bridge -s user

# 只在用户级注册一次 npm 包。Windows 需要使用 `cmd` 包装启动器。
claude mcp add --scope user encoding-bridge -- cmd /d /s /c "npx -y encoding-bridge-mcp"
claude mcp get encoding-bridge
```

### macOS / Linux

```bash
# 如果以前装过同名的旧版本，先删除旧配置。
claude mcp remove encoding-bridge -s user

# 只在用户级注册一次 npm 包。
claude mcp add --scope user encoding-bridge -- npx -y encoding-bridge-mcp
claude mcp get encoding-bridge
```

如果第二条命令显示 `Connected`，说明安装成功。请**新开**一个 Claude Code 会话后再用。

安装脚本会自动把权限写进 `~/.claude/settings.json`：允许 MCP 工具，禁用内置 `Read` / `Grep` / `Edit` / `Write` / `NotebookEdit`。第一次打开混编码仓库时会在后台建立本机编码索引，不必手写规则，也不必再跑扫描工具。

### 避免重复注册

`encoding-bridge` 只能在一个配置范围内注册一次。若用户级旧配置仍指向本机构建、而项目 `.mcp.json` 又指向 npm 包，Claude Code 会把同名但命令不同的服务报告为冲突。

用 `claude mcp list` 查看重复项，保留要使用的端点，再删除另一项：

```powershell
# 保留用户级 npm 安装时，删除项目级配置。
claude mcp remove encoding-bridge -s project

# 保留项目级配置时，删除旧的用户级安装。
claude mcp remove encoding-bridge -s user
```

删除后重新运行 `claude mcp get encoding-bridge`。只有一个端点且状态为 `Connected` 才表示配置正确。

### 多根工作区（Multi-root workspace）

**单文件夹工作区**开箱即用，**零配置**：MCP 进程的 `cwd`（VS Code 工作目录）就是索引根，该目录下的文件会自动读取并建立编码索引。

**多根工作区**只有一个文件夹是进程 `cwd`。编码桥**无法自动发现其他文件夹**（VS Code 不会把工作区根列表暴露给 MCP server 进程），所以必须在项目的 `.mcp.json` 里用 `ENCODING_BRIDGE_ROOTS` 显式列出：

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

- `ENCODING_BRIDGE_ROOTS` 是用路径分隔符（Windows 为 `;`，Unix 为 `:`）分隔的根目录列表。每个根各有一份 `.encoding-bridge/encoding-index.json`。
- 文件会被归到「包含它的、最深的」已配置根。
- 这个文件放在项目根，配置一次即可，**重启 VS Code / 重载会话都会沿用，不用每次手动加**。
- 每个用户填**自己的**路径；发布的包本身不含任何写死的路径。

### 大文本文件

`Read` 和 `Grep` 默认允许单个文本文件最大为 `32 MiB`。如需调整，在启动 Claude Code 前把 `ENCODING_BRIDGE_MAX_TEXT_FILE_MIB` 设为正整数：

```powershell
setx ENCODING_BRIDGE_MAX_TEXT_FILE_MIB 64
```

修改环境变量后请重启 Claude Code。

---

## 怎么确认它真的在工作

新开一个 Claude Code 会话，让它读或搜索一个旧编码文件。工具调用应是 `mcp__encoding-bridge__Read` / `Grep` / `Edit` / `Write`，而不是内置同名工具。

---

## 它具体能做什么

### Read

- 自动识别编码并解码；
- 大文件支持 `offset` / `limit` 分段读；
- 支持图片、PDF、Notebook 读取。

### Grep

- ASCII 一次搜索即可，不区分编码；
- 中文等非 ASCII 按本机编码索引分组搜索；
- 支持 `content` / `files_with_matches` / `count`，以及 `glob`、上下文行、分页。

### Edit

- 只要目标行已经读过，就可以改；
- 改之前会检查文件有没有变化；
- 保留原编码、BOM 和换行。

### Write

- 新文件默认 UTF-8；
- 已有文件要求先读过，并按原编码写回。

---

## 常见问题

### 1. `Invalid byte sequence for utf-8`

文件不是 UTF-8。再读一次该文件，或打开该目录后等后台索引建完，Bridge 会探测并记住编码。

### 2. `Text contains characters not representable in ...`

要写入的字符，当前文件编码表示不了。

### 3. `The target text has not been read`

想改的那几行还没读过，按提示补读即可。

### 4. Claude 还是在用内置工具

安装后请新开会话。权限由安装脚本写入 `~/.claude/settings.json`。

---

## 许可证

MIT，见 [LICENSE](LICENSE)。
