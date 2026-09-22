import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const DEFAULT_GLOBS = [
  '!node_modules',
  '!.git',
  '!.svn',
  '!.hg',
  '!dist',
  '!.encoding-bridge',
  '!**/Log/**',
  '!**/FileLog/**',
  '!*.log',
]

const MAX_ARGS_CHARS = 24_000

function ripgrepPath(): string {
  const require = createRequire(import.meta.url)
  const module = require('@vscode/ripgrep') as { rgPath: string }
  return module.rgPath
}

export interface RipgrepRunOptions {
  pattern: string
  cwd: string
  target?: string
  files?: string[]
  encoding?: string
  outputMode: 'content' | 'files_with_matches' | 'count'
  caseInsensitive?: boolean
  lineNumbers?: boolean
  onlyMatching?: boolean
  before?: number
  after?: number
  multiline?: boolean
  glob?: string
  typeGlobs?: string[]
  timeoutMs: number
}

function searchArgs(options: RipgrepRunOptions): string[] {
  const args = [
    '--hidden',
    '--no-config',
    '--color', 'never',
    '--max-columns', '500',
  ]
  if (options.files === undefined) args.push('--no-ignore')
  if (options.encoding !== undefined) args.push('--encoding', options.encoding)
  if (options.caseInsensitive) args.push('-i')
  if (options.multiline) args.push('-U', '--multiline-dotall')
  if (options.outputMode === 'files_with_matches') args.push('-l')
  else if (options.outputMode === 'count') args.push('-c')
  else {
    if (options.lineNumbers !== false) args.push('-n')
    if (options.onlyMatching) args.push('-o')
    if (options.before) args.push('-B', String(options.before))
    if (options.after) args.push('-A', String(options.after))
  }
  if (options.files === undefined) {
    for (const glob of DEFAULT_GLOBS) args.push('--glob', glob)
    if (options.glob) args.push('--glob', options.glob)
    for (const glob of options.typeGlobs ?? []) args.push('--glob', glob)
  }
  args.push('-e', options.pattern)
  return args
}

function chunkFiles(files: string[], prefixLength: number): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let size = prefixLength
  for (const file of files) {
    const extra = file.length + 1
    if (current.length > 0 && size + extra > MAX_ARGS_CHARS) {
      chunks.push(current)
      current = []
      size = prefixLength
    }
    current.push(file)
    size += extra
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

function runProcess(args: string[], cwd: string, timeoutMs: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(ripgrepPath(), args, {
      cwd,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`ripgrep timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    child.stdout?.on('data', chunk => { stdout += chunk.toString() })
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0 || code === 1) {
        resolve(stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean))
        return
      }
      reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`))
    })
  })
}

export async function runRipgrep(options: RipgrepRunOptions): Promise<string[]> {
  if (options.files !== undefined && options.files.length === 0) return []
  const args = searchArgs(options)
  if (options.files === undefined) {
    if (options.target !== undefined) args.push(options.target)
    return runProcess(args, options.cwd, options.timeoutMs)
  }
  const relativeFiles = options.files.map(file => path.isAbsolute(file) ? path.relative(options.cwd, file) : file)
  const chunks = chunkFiles(relativeFiles, args.reduce((total, item) => total + item.length + 1, 0))
  const lines: string[] = []
  for (const chunk of chunks) {
    lines.push(...await runProcess([...args, ...chunk], options.cwd, options.timeoutMs))
  }
  return lines
}

export function isAsciiPattern(pattern: string): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern.charCodeAt(index) > 127) return false
  }
  return true
}
