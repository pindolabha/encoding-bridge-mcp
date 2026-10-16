import { stat } from 'node:fs/promises'
import path from 'node:path'

import {
  listIndexedEncodings,
  ripgrepEncodingLabel,
} from '../encoding/index.js'
import { inspectProjectPath } from '../filesystem/index.js'
import { grepLimits } from '../limits.js'
import { getProjectFileContext, resolveFileEncoding } from '../core.js'
import type { ToolResponse } from '../toolTypes.js'
import { isAsciiPattern, listRipgrepFiles, runRipgrep, type RipgrepListOptions } from './ripgrep.js'
import {
  assertObject,
  optionalBoolean,
  optionalInteger,
  optionalString,
  rejectUnknown,
  requiredString,
} from '../validation.js'

export type GrepOutputMode = 'content' | 'files_with_matches' | 'count'
export type GrepScanMode = 'exact' | 'fast'

export interface GrepInput {
  pattern: string
  path?: string
  glob?: string
  type?: string
  output_mode?: GrepOutputMode
  scan_mode?: GrepScanMode
  '-i'?: boolean
  '-n'?: boolean
  '-o'?: boolean
  '-A'?: number
  '-B'?: number
  '-C'?: number
  context?: number
  multiline?: boolean
  head_limit?: number
  offset?: number
}

const MAX_GREP_ENTRIES = 10_000
const MAX_GREP_RESPONSE_CHARS = 1024 * 1024

// Content mode asks rg for control-character field separators (never present
// in real source files) so matches can be counted precisely even when context
// lines and `--` group breaks are mixed into the output; the standard
// `:`/`-` format is restored before display.
const MATCH_SEP = '\x01'
const CONTEXT_SEP = '\x02'
const GROUP_SEP = '\x03'

const TYPE_GLOBS: Readonly<Record<string, string[]>> = {
  js: ['**/*.js', '**/*.jsx', '**/*.mjs', '**/*.cjs'],
  ts: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
  py: ['**/*.py', '**/*.pyi'],
  rust: ['**/*.rs'],
  go: ['**/*.go'],
  java: ['**/*.java'],
  c: ['**/*.c', '**/*.h'],
  cpp: ['**/*.cc', '**/*.cpp', '**/*.cxx', '**/*.hpp', '**/*.hh', '**/*.h', '**/*.hxx'],
  cs: ['**/*.cs'],
  json: ['**/*.json'],
  yaml: ['**/*.yaml', '**/*.yml'],
  toml: ['**/*.toml'],
  markdown: ['**/*.md', '**/*.markdown'],
  html: ['**/*.html', '**/*.htm'],
  css: ['**/*.css'],
  xml: ['**/*.xml'],
  sh: ['**/*.sh', '**/*.bash'],
}

export function parseGrepInput(value: unknown): GrepInput {
  assertObject(value)
  const allowed = ['pattern', 'path', 'glob', 'type', 'output_mode', 'scan_mode', '-i', '-n', '-o', '-A', '-B', '-C', 'context', 'multiline', 'head_limit', 'offset']
  rejectUnknown(value, allowed)
  const outputMode = optionalString(value, 'output_mode')
  if (outputMode !== undefined && !['content', 'files_with_matches', 'count'].includes(outputMode)) {
    throw new Error('output_mode must be content, files_with_matches, or count')
  }
  const scanMode = optionalString(value, 'scan_mode')
  if (scanMode !== undefined && !['exact', 'fast'].includes(scanMode)) {
    throw new Error('scan_mode must be exact or fast')
  }
  if (scanMode === 'fast' && outputMode !== undefined && outputMode !== 'files_with_matches') {
    throw new Error('scan_mode=fast is only supported with output_mode=files_with_matches')
  }
  const result: GrepInput = { pattern: requiredString(value, 'pattern') }
  for (const key of ['path', 'glob', 'type'] as const) {
    const item = optionalString(value, key)
    if (item !== undefined) result[key] = item
  }
  if (outputMode !== undefined) result.output_mode = outputMode as GrepOutputMode
  if (scanMode !== undefined) result.scan_mode = scanMode as GrepScanMode
  for (const key of ['-i', '-n', '-o', 'multiline'] as const) {
    const item = optionalBoolean(value, key)
    if (item !== undefined) result[key] = item
  }
  for (const [key, minimum] of [['-A', 0], ['-B', 0], ['-C', 0], ['context', 0], ['head_limit', 0], ['offset', 0]] as const) {
    const item = optionalInteger(value, key, minimum)
    if (item !== undefined) result[key] = item
  }
  return result
}

function typeGlobs(type: string | undefined): string[] | undefined {
  if (type === undefined) return undefined
  const patterns = TYPE_GLOBS[type]
  if (patterns === undefined) throw new Error(`Unsupported file type: ${type}`)
  return patterns
}

function paginate(lines: string[], offset: number, limit: number): { entries: string[]; truncated: boolean } {
  const sliced = lines.slice(offset, offset + limit)
  let characters = 0
  const entries: string[] = []
  for (const line of sliced) {
    if (characters + line.length > MAX_GREP_RESPONSE_CHARS) {
      return { entries, truncated: true }
    }
    entries.push(line)
    characters += line.length + 1
  }
  return { entries, truncated: lines.length > offset + entries.length }
}

function countModeTotals(lines: string[]): { numFiles: number; numMatches: number } {
  let numFiles = 0
  let numMatches = 0
  for (const line of lines) {
    const colon = line.lastIndexOf(':')
    if (colon < 0) continue
    const count = Number(line.slice(colon + 1))
    if (!Number.isFinite(count)) continue
    numFiles += 1
    numMatches += count
  }
  return { numFiles, numMatches }
}

function contentFileCount(lines: string[]): number {
  const files = new Set<string>()
  for (const line of lines) {
    const match = line.match(/^(.*?)[:\-]\d+[:\-]/) ?? line.match(/^(.*?):/)
    if (match?.[1]) files.add(match[1])
  }
  return files.size
}

async function bucketByEncoding(root: string, files: string[]): Promise<Map<string, string[]>> {
  const indexed = await listIndexedEncodings(root)
  const buckets = new Map<string, string[]>()
  for (const file of files) {
    const relative = path.relative(root, file).split(path.sep).join('/')
    const cached = indexed.get(relative)?.encoding
    const encoding = cached ?? await resolveFileEncoding(root, file)
    const label = ripgrepEncodingLabel(encoding)
    if (label === undefined) {
      throw new Error(`Encoding ${encoding} is not supported by ripgrep`)
    }
    const bucket = buckets.get(label) ?? []
    bucket.push(file)
    buckets.set(label, bucket)
  }
  return buckets
}

function commonRipgrepOptions(input: GrepInput, mode: GrepOutputMode, timeoutMs: number, deadline: number) {
  const context = input.context ?? input['-C']
  const before = context ?? input['-B']
  const after = context ?? input['-A']
  const types = typeGlobs(input.type)
  return {
    pattern: input.pattern,
    outputMode: mode,
    ...(mode === 'content' ? { fieldSeparators: { match: MATCH_SEP, context: CONTEXT_SEP, group: GROUP_SEP } } : {}),
    ...(input['-i'] === undefined ? {} : { caseInsensitive: input['-i'] }),
    lineNumbers: input['-n'] ?? true,
    ...(input['-o'] === undefined ? {} : { onlyMatching: input['-o'] }),
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    ...(input.multiline === undefined ? {} : { multiline: input.multiline }),
    ...(input.glob === undefined ? {} : { glob: input.glob }),
    ...(types === undefined ? {} : { typeGlobs: types }),
    timeoutMs,
    deadline,
  }
}

export async function executeGrep(input: GrepInput): Promise<ToolResponse> {
  const startedAt = Date.now()
  const limits = grepLimits()
  // One budget for the whole request: enumerating candidates and every
  // per-encoding search share this deadline, instead of each rg call getting a
  // fresh full timeout (which multiplied the limit by the number of calls).
  const deadline = startedAt + limits.maxDurationMs
  const targetInput = path.resolve(input.path ?? process.cwd())
  const initialContext = await getProjectFileContext(targetInput)
  const safeTarget = await inspectProjectPath(initialContext.root, targetInput)
  // Existence check with a friendly message; rg itself would otherwise fail
  // with a bare "No such file or directory".
  await stat(safeTarget.target)
  const mode = input.output_mode ?? 'files_with_matches'
  const scanMode = input.scan_mode ?? 'exact'
  if (scanMode === 'fast' && mode !== 'files_with_matches') {
    throw new Error('scan_mode=fast is only supported with output_mode=files_with_matches')
  }
  const offset = input.offset ?? 0
  const requestedLimit = input.head_limit ?? 250
  const limit = requestedLimit === 0 ? MAX_GREP_ENTRIES : Math.min(requestedLimit, MAX_GREP_ENTRIES)
  const shared = commonRipgrepOptions(input, mode, limits.maxDurationMs, deadline)
  let lines: string[] = []
  let usedRipgrepGroups = 1

  if (isAsciiPattern(input.pattern)) {
    lines = await runRipgrep({
      ...shared,
      cwd: path.dirname(targetInput),
      target: targetInput,
    })
  } else {
    // rg --files enumerates candidates Rust-side (vs the serial JS walk it
    // replaces); the encoding index then buckets them for per-encoding passes.
    const listOptions: RipgrepListOptions = {
      cwd: safeTarget.root,
      target: safeTarget.target,
      timeoutMs: limits.maxDurationMs,
      deadline,
    }
    if (input.glob !== undefined) listOptions.glob = input.glob
    if (input.type !== undefined) {
      const typeGlobList = typeGlobs(input.type)
      if (typeGlobList !== undefined) listOptions.typeGlobs = typeGlobList
    }
    const files = await listRipgrepFiles(listOptions)
    const buckets = await bucketByEncoding(safeTarget.root, files)
    usedRipgrepGroups = buckets.size
    const grouped: string[] = []
    for (const [encoding, bucket] of buckets) {
      const rgEncoding = ripgrepEncodingLabel(encoding)
      if (rgEncoding === undefined) {
        throw new Error(`Encoding ${encoding} is not supported by ripgrep`)
      }
      const found = await runRipgrep({
        ...shared,
        cwd: safeTarget.root,
        files: bucket,
        encoding: rgEncoding,
      })
      // Appended one at a time, not `grouped.push(...found)` — see runRipgrep.
      for (const line of found) grouped.push(line)
    }
    lines = grouped
  }

  // Content mode returns sentinel-separated lines: count actual matches (a
  // context request would otherwise inflate the number with context lines and
  // `--` breaks), then restore rg's standard `:`/`-` format for display.
  const matchCount = mode === 'content'
    ? lines.filter(line => line.includes(MATCH_SEP)).length
    : lines.length
  const outputLines = mode === 'content'
    ? lines.map(line => line === GROUP_SEP
      ? '--'
      : line.includes(MATCH_SEP)
        ? line.replaceAll(MATCH_SEP, ':')
        : line.replaceAll(CONTEXT_SEP, '-'))
    : lines

  const { entries, truncated } = paginate(outputLines, offset, limit)
  const counts = mode === 'count'
    ? countModeTotals(lines)
    : mode === 'files_with_matches'
      ? { numFiles: lines.length, numMatches: lines.length }
      : { numFiles: contentFileCount(outputLines), numMatches: matchCount }
  const notices: string[] = []
  if (truncated) notices.push(`Showing results with pagination = limit: ${limit}, offset: ${offset}; output is capped for server stability`)
  const suffix = notices.length === 0 ? '' : `\n\n[${notices.join('] [')}]`
  const body = entries.join('\n')
  if (body.length === 0) {
    // Distinguish "the pattern matched nothing" from "matches exist but the
    // requested offset is past the end of the result list" — the flat message
    // made Claude conclude a keyword does not exist in the project.
    const reason = lines.length === 0
      ? `No matches found for \`${input.pattern}\`.`
      : `No results at offset ${offset}; total matches: ${counts.numMatches}.`
    return { content: [{ type: 'text', text: `${reason}${suffix}` }] }
  }
  const files = new Set<string>()
  for (const line of entries) {
    const match = line.match(/^(.*?)[:\-]\d+[:\-]/) ?? line.match(/^(.*?):/)
    files.add(match?.[1] ?? line)
  }
  const headerLines = [
    `Pattern: \`${input.pattern}\``,
    `Matches: ${counts.numMatches} across ${counts.numFiles} file${counts.numFiles === 1 ? '' : 's'}`,
  ]
  // files_with_matches returns the file paths themselves as the body, so a
  // separate file list would repeat them; only content/count modes add one.
  if (mode !== 'files_with_matches') {
    headerLines.push(`Files (${files.size}):`, ...[...files].map(file => `  - ${file}`))
  }
  const header = headerLines.join('\n')
  return {
    content: [{
      type: 'text',
      text: `${header}\n\n${body}${suffix}`,
    }],
  }
}
