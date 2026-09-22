---
description: Diagnose why Encoding Bridge is not being used or not decoding files correctly.
allowed-tools: Read, Edit, AskUserQuestion
---

# /doctor

Use this command when the user reports that Encoding Bridge is not working correctly.

## Checklist

1. Verify the MCP is connected.
2. Verify the session tool list contains `mcp__encoding-bridge__Read`, `Grep`, `Edit`, and `Write`.
3. Verify built-in `Read`, `Grep`, `Edit`, `Write`, and `NotebookEdit` are denied in `~/.claude/settings.json`. If not, run `node install/apply-claude-settings.js` and start a new session.
4. If Chinese searches miss GBK files, check that `.encoding-bridge/encoding-index.json` exists under the project; the first Read/Grep should create it.
5. Verify the model is not bypassing through shell commands or scripts.
6. If editing failed, determine whether the target lines were not read, the file changed after reading, or the new text is not representable in the file encoding.
