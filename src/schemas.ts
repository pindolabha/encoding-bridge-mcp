export const readInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['file_path'],
  properties: {
    file_path: {
      type: 'string',
      description: 'The absolute path to the file to read',
    },
    offset: {
      type: 'integer',
      minimum: 0,
      description:
        'The line number to start reading from. Only provide if the file is too large to read at once',
    },
    limit: {
      type: 'integer',
      minimum: 1,
      description:
        'The number of lines to read. Only provide if the file is too large to read at once.',
    },
    pages: {
      type: 'string',
      description:
        'Page range for PDF files (e.g., "1-5", "3", "10-20"). Only applicable to PDF files. Maximum 20 pages per request.',
    },
  },
} as const

export const editInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['file_path', 'old_string', 'new_string'],
  properties: {
    file_path: {
      type: 'string',
      description: 'The absolute path to the file to modify',
    },
    old_string: { type: 'string', description: 'The text to replace' },
    new_string: {
      type: 'string',
      description: 'The text to replace it with (must be different from old_string)',
    },
    replace_all: {
      type: 'boolean',
      default: false,
      description: 'Replace all occurrences of old_string (default false)',
    },
  },
} as const

export const writeInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['file_path', 'content'],
  properties: {
    file_path: {
      type: 'string',
      description:
        'The absolute path to the file to write (must be absolute, not relative)',
    },
    content: { type: 'string', description: 'The content to write to the file' },
  },
} as const

export const grepInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['pattern'],
  properties: {
    pattern: { type: 'string', description: 'The regular expression pattern to search for in file contents' },
    path: { type: 'string', description: 'File or directory to search. Defaults to the current working directory.' },
    glob: { type: 'string', description: 'Glob pattern used to filter files, for example *.js or **/*.ts' },
    type: { type: 'string', description: 'File type filter such as js, ts, py, rust, go, or java' },
    output_mode: { type: 'string', enum: ['content', 'files_with_matches', 'count'], description: 'Output mode. Defaults to files_with_matches.' },
    scan_mode: { type: 'string', enum: ['exact', 'fast'], default: 'exact', description: 'exact scans all eligible files and returns exact counts when complete. fast is opt-in for files_with_matches only and stops each matching file after its first match, so counts are not exact.' },
    '-i': { type: 'boolean', description: 'Case-insensitive search' },
    '-n': { type: 'boolean', description: 'Show line numbers in content mode. Defaults to true.' },
    '-o': { type: 'boolean', description: 'Print only matching non-empty parts of each line' },
    '-A': { type: 'integer', minimum: 0, description: 'Show lines after each match' },
    '-B': { type: 'integer', minimum: 0, description: 'Show lines before each match' },
    '-C': { type: 'integer', minimum: 0, description: 'Show lines before and after each match' },
    context: { type: 'integer', minimum: 0, description: 'Alias for -C' },
    multiline: { type: 'boolean', description: 'Enable multiline matching where dot also matches newlines' },
    head_limit: { type: 'integer', minimum: 0, description: 'Limit returned lines or entries. Defaults to 250; 0 means unlimited.' },
    offset: { type: 'integer', minimum: 0, description: 'Skip the first N result lines or entries' }
  }
} as const

export const scanEncodingsInputSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: {
      type: 'string',
      description: 'File or directory to scan. Defaults to the current working directory.',
    },
  },
} as const