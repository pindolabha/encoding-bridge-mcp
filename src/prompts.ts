export const READ_DESCRIPTION = 'Read a file from the local filesystem.'
export const EDIT_DESCRIPTION = 'Performs exact string replacements in files.'
export const WRITE_DESCRIPTION = 'Write a file to the local filesystem.'

export const READ_PROMPT = `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file. Files larger than 256KB will return an error; use offset and limit for larger files
- When you already know which part of the file you need, only read that part. This can be important for larger files.
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.
- This tool can read PDF files (.pdf). For large PDFs (more than 10 pages), you MUST provide the pages parameter to read specific page ranges (e.g., pages: "1-5"). Reading a large PDF without the pages parameter will fail. Maximum 20 pages per request.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- This tool can only read files, not directories. To read a directory, use an ls command via the Bash tool.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot, ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths.
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.`

export const EDIT_PROMPT = `Performs exact string replacements in files.

Usage:
- You must use your \`Read\` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file.
- When editing text from Read tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: line number + tab. Everything after that is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.
- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.
- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.
- The edit will FAIL if \`old_string\` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use \`replace_all\` to change every instance of \`old_string\`.
- Use \`replace_all\` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.`

export const WRITE_PROMPT = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.
- Prefer the Edit tool for modifying existing files — it only sends the diff. Only use this tool to create new files or for complete rewrites.
- NEVER create documentation files (*.md) or README files unless explicitly requested by the User.
- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.`

export const GREP_DESCRIPTION = 'A powerful search tool built on regular expressions.'
export const GREP_PROMPT = `A powerful search tool for file contents.

Usage:
- ALWAYS use Grep for search tasks. NEVER invoke grep or rg as a Bash command.
- Supports full regular expressions, file glob filters, file type filters, context lines, match-only output, multiline matching, pagination, file lists, and per-file counts.
- Use output_mode=files_with_matches when you only need file paths; this is the default.
- Use output_mode=content to see matching lines. Line numbers are included by default.
- Use output_mode=count to see match counts per file.
- scan_mode=exact is the default: pagination never stops scanning, so counts are exact when scanComplete is true. scan_mode=fast is opt-in and only valid for files_with_matches; it stops each matching file at its first match and reports countsExact=false.
- Results are limited to 250 entries by default; use head_limit and offset for pagination. Check structuredContent scanComplete, truncationReason, and outputTruncated whenever a search is resource-limited.
- ASCII patterns are searched once with ripgrep and ignore file encoding.
- Non-ASCII patterns (Chinese, etc.) are grouped by detected file encoding and searched with rg --encoding per group.`