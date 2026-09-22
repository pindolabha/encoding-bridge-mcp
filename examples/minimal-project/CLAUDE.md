## File encoding policy

Use Encoding Bridge for all project file content operations:

- Read with `mcp__encoding-bridge__Read`.
- Search with `mcp__encoding-bridge__Grep`.
- Edit with `mcp__encoding-bridge__Edit`.
- Create or completely rewrite with `mcp__encoding-bridge__Write`.
- File encodings are detected automatically and indexed on first use; no
  manual configuration is required.

Do not use built-in Read, Grep, Edit, Write, NotebookEdit, shell commands,
PowerShell commands, or scripts as substitutes for project file content access.
Glob may only be used to discover paths.

Do not manually transcode files or normalize line endings. The local encoding
index under `.encoding-bridge/` is maintained automatically.
