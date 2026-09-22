---
description: Configure the current repository to use Encoding Bridge. Use when the user says "set this project up" or "make this repo use encoding bridge".
allowed-tools: Read, Edit, AskUserQuestion
---

# /setup-project

## What to do

1. Confirm the project root.
2. Confirm the user-scoped MCP is connected. A project `.mcp.json` is optional and can conflict with the user install.
3. Encoding is detected automatically and indexed on first use; no config file or scan is required.
4. Remind them to start a new session after first install so denied built-in tools take effect.
