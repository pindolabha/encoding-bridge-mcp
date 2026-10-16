import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

import { grepLimits } from '../limits.js'

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
  /** Absolute epoch-ms deadline shared by every rg call in one Grep request.
   *  Without it each call (and each chunk) would get a fresh full budget, so a
   *  request spanning an enumeration plus one pass per encoding could run for
   *  (calls x timeoutMs) instead of timeoutMs. */
  deadline?: number
  /** Content mode only: sentinel separators so matches can be counted
   *  precisely even when context lines are mixed into the output. */
  fieldSeparators?: { match: string; context: string; group: string }
}

/**
 * What one rg run produced. `truncated` says a cap stopped rg before it
 * finished, which makes `lines` a prefix of the matches rather than all of
 * them — the difference is unrecoverable (rg was killed, so the rest was never
 * written), and callers must report it instead of presenting the count as a
 * total.
 */
export interface RipgrepOutput {
  lines: string[]
  truncated: boolean
}

function searchArgs(options: RipgrepRunOptions): string[] {
  const args = [
    '--hidden',
    '--no-config',
    '--color', 'never',
    // Bounds the largest single printed line, so base64 blobs and minified
    // bundles cannot flood the output. Under `-o` this only bounds each MATCH
    // rather than the line it came from (rg measures the text it prints, and
    // that text is the match), which is what maxOnlyMatches exists to cover.
    '--max-columns', '500',
    // rg omits the `file:` prefix when it is handed exactly one file, which
    // silently breaks everything downstream: content lines lose the filename
    // (and a context line's `-` separator then parses as a filename), and
    // count mode returns a bare number that has no file to attach to. Always
    // asking for the prefix keeps both paths parseable.
    '--with-filename',
  ]
  if (options.files === undefined) args.push('--no-ignore')
  if (options.encoding !== undefined) args.push('--encoding', options.encoding)
  if (options.fieldSeparators) {
    args.push(
      '--field-match-separator', options.fieldSeparators.match,
      '--field-context-separator', options.fieldSeparators.context,
      '--context-separator', options.fieldSeparators.group,
    )
  }
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

/** Newlines in a chunk, counted at the byte level so the whole chunk is never
 *  turned into a second string just to be measured. */
function countNewlines(chunk: Buffer): number {
  let count = 0
  for (let index = 0; index < chunk.length; index += 1) {
    if (chunk[index] === 0x0a) count += 1
  }
  return count
}

/**
 * @param matchLimit Content-mode `-o` only. Output lines to accept before
 *   stopping rg — see DEFAULT_GREP_MAX_ONLY_MATCHES for why `-o` needs a cap
 *   of its own.
 */
function runProcess(
  args: string[],
  cwd: string,
  timeoutMs: number,
  matchLimit?: number,
): Promise<RipgrepOutput> {
  // Read once, before spawning: a malformed value should fail the call outright
  // rather than midway through a stream.
  const { maxOutputBytes } = grepLimits()
  return new Promise((resolve, reject) => {
    const child = spawn(ripgrepPath(), args, {
      cwd,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let stdoutBytes = 0
    let stdoutLines = 0
    let stdoutTruncated = false
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`ripgrep timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    // Stop accumulating AND stop rg. Letting it run on would spend the request's
    // shared deadline producing output that nothing will read — the 66 MB that a
    // minified line makes `-o` emit still costs seconds even with the buffer
    // capped. Claude's own cap terminates the child the same way (`execFile`'s
    // maxBuffer kills it; measured 298 ms to return, not the 5 s timeout).
    const stop = () => {
      stdoutTruncated = true
      child.kill()
    }
    child.stdout?.on('data', chunk => {
      if (stdoutTruncated) return
      stdout += chunk.toString()
      stdoutBytes += chunk.length
      // Two counters because the caps bound different things: bytes bound the
      // volume, output lines bound the amplification `-o` introduces.
      if (matchLimit !== undefined) stdoutLines += countNewlines(chunk)
      if (stdoutBytes > maxOutputBytes || (matchLimit !== undefined && stdoutLines > matchLimit)) {
        stop()
      }
    })
    child.stderr?.on('data', chunk => { stderr += chunk.toString() })
    child.on('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      // A child killed by us closes with no exit code and a signal instead
      // (Windows: code null, signal SIGTERM). Requiring the signal — rather than
      // trusting the truncation flag alone — keeps a genuine rg failure (exit 2)
      // reported even when it happens after a cap was hit. The timeout path also
      // kills, but it has already rejected by the time this runs.
      if (code === 0 || code === 1 || (stdoutTruncated && signal !== null)) {
        const lines = stdout.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(Boolean)
        // The cap lands mid-chunk, so the final line may be a fragment: it is
        // not a real result and is dropped rather than reported as one.
        resolve({
          lines: stdoutTruncated ? lines.slice(0, -1) : lines,
          truncated: stdoutTruncated,
        })
        return
      }
      reject(new Error(stderr.trim() || `ripgrep exited with code ${code}`))
    })
  })
}

/** Time left for the next rg call: the request deadline caps the configured
 *  budget, and an exhausted deadline means the request is already out of time. */
function remainingBudget(options: { timeoutMs: number; deadline?: number }): number {
  const deadline = options.deadline ?? Date.now() + options.timeoutMs
  const budget = Math.min(options.timeoutMs, deadline - Date.now())
  if (budget <= 0) throw new Error(`ripgrep timed out after ${options.timeoutMs}ms`)
  return budget
}

export async function runRipgrep(options: RipgrepRunOptions): Promise<RipgrepOutput> {
  if (options.files !== undefined && options.files.length === 0) return { lines: [], truncated: false }
  const args = searchArgs(options)
  // Only `-o` needs it: every other mode prints at most one line per matching
  // input line, so the byte cap alone bounds the volume.
  const matchLimit = options.onlyMatching === true ? grepLimits().maxOnlyMatches : undefined
  if (options.files === undefined) {
    const budget = remainingBudget(options)
    if (options.target !== undefined) args.push(options.target)
    return runProcess(args, options.cwd, budget, matchLimit)
  }
  const relativeFiles = options.files.map(file => path.isAbsolute(file) ? path.relative(options.cwd, file) : file)
  const chunks = chunkFiles(relativeFiles, args.reduce((total, item) => total + item.length + 1, 0))
  const lines: string[] = []
  // One capped chunk is enough to make the combined list a prefix of the
  // matches, so this is an OR over the runs, not the last run's flag.
  let truncated = false
  for (const chunk of chunks) {
    const found = await runProcess([...args, ...chunk], options.cwd, remainingBudget(options), matchLimit)
    // Appended one at a time on purpose: `lines.push(...found)` passes every
    // element as a call argument, and a match-heavy search can return enough
    // lines to exceed the argument limit (RangeError: Maximum call stack size
    // exceeded) — a crash, not a truncated result.
    for (const line of found.lines) lines.push(line)
    if (found.truncated) truncated = true
  }
  return { lines, truncated }
}

export function isAsciiPattern(pattern: string): boolean {
  for (let index = 0; index < pattern.length; index += 1) {
    if (pattern.charCodeAt(index) > 127) return false
  }
  return true
}

export interface RipgrepListOptions {
  cwd: string
  target?: string
  glob?: string
  typeGlobs?: string[]
  timeoutMs: number
  /** Same request-wide deadline the follow-up searches share. */
  deadline?: number
}

/**
 * List candidate files with `rg --files` — a Rust-side parallel walk, replacing
 * the serial `readdir` recursion the encoding-grouped search used to do in JS.
 * The default exclude globs and the caller's glob/type filters are applied so
 * the list matches what the search would look at. Needed because a legacy
 * encoding search cannot hand rg the directory (rg takes one `--encoding` per
 * run); it must bucket files by encoding first.
 */
export async function listRipgrepFiles(options: RipgrepListOptions): Promise<{ files: string[]; truncated: boolean }> {
  const args = ['--files', '--hidden', '--no-config', '--color', 'never', '--no-ignore']
  for (const glob of DEFAULT_GLOBS) args.push('--glob', glob)
  if (options.glob) args.push('--glob', options.glob)
  for (const glob of options.typeGlobs ?? []) args.push('--glob', glob)
  if (options.target !== undefined) args.push(options.target)
  const { lines, truncated } = await runProcess(args, options.cwd, remainingBudget(options))
  // Truncation is reported rather than swallowed: this list decides which files
  // the encoding-grouped search ever looks at, so a capped enumeration silently
  // drops files from the result — the same class of lie as a capped count.
  return { files: lines.map(line => path.resolve(options.cwd, line)), truncated }
}
