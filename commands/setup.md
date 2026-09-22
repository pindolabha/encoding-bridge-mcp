---
description: Set up Encoding Bridge in Claude Code. Use when the user says things like "install encoding bridge", "set up the plugin", or "configure encoding bridge".
allowed-tools: Read, Edit, AskUserQuestion
---

# /setup

Use this command after the plugin is installed.

## What to do

1. Confirm the MCP is connected (`claude mcp get encoding-bridge`).
2. Confirm the **project's** `.claude/settings.json` allows the MCP tools and denies built-in Read/Grep/Edit/Write/NotebookEdit. If not, have the user add the permissions block from the README (see "Allow the tools in a project").
3. Tell the user to start a new Claude Code session. Encoding indexing runs automatically the first time a project is opened.
