import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { encodeText, hasIndexedEncoding, rememberIndexedEncoding } from '../encoding/index.js'
import { getProjectFileContext, encodeSnapshotText, readDecodedFile, readRegistry } from '../core.js'
import { createStructuredPatch, formatFileChangeMessage } from '../diff.js'
import { atomicWriteBuffer } from '../filesystem/index.js'
import type { EditInput, ToolResponse } from '../toolTypes.js'
import {
  assertObject,
  optionalBoolean,
  rejectUnknown,
  requiredString,
} from '../validation.js'

const MAX_EDIT_BYTES = 1024 * 1024 * 1024
const SMART_QUOTES = new Map<string, string>([
  ['‘', "'"], ['’', "'"], ['‚', "'"], ['‛', "'"],
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'],
])

export function parseEditInput(value: unknown): EditInput {
  assertObject(value)
  rejectUnknown(value, ['file_path', 'old_string', 'new_string', 'replace_all'])
  const replace_all = optionalBoolean(value, 'replace_all')
  return {
    file_path: requiredString(value, 'file_path'),
    old_string: requiredString(value, 'old_string'),
    new_string: requiredString(value, 'new_string'),
    ...(replace_all === undefined ? {} : { replace_all }),
  }
}

function normalizeQuotes(text: string): string {
  return [...text].map(character => SMART_QUOTES.get(character) ?? character).join('')
}

interface QuoteMatch {
  index: number
  actual: string
}

function lineRangeForMatch(content: string, match: QuoteMatch): { startLine: number; endLine: number } {
  const startLine = content.slice(0, match.index).split('\n').length
  const endLine = startLine + match.actual.split('\n').length - 1
  return { startLine, endLine }
}

/**
 * Whitespace- and quote-insensitive matching, mirroring how the built-in Edit
 * tolerates quote differences but extending it to alignment whitespace.
 *
 * The core problem: tabs used to align trailing `//` comments are invisible, so
 * a model copying a Read/Grep line to build an `old_string` frequently miscounts
 * them, producing `old_string not found`. Here we match by comparing a normalized
 * form (leading whitespace dropped, runs of whitespace collapsed to one space,
 * curly quotes folded to straight) and then resolve the normalized hit back to
 * the exact original byte range so the replacement is applied to the real text.
 *
 * `normalizeWithMap` returns the normalized text plus a per-character map back to
 * the original offsets. Leading whitespace on a line is skipped entirely (not
 * mapped), so a search string that omits or varies indentation still lines up.
 */
interface CharMap {
  start: number
  end: number
}

function normalizeWithMap(text: string): { norm: string; map: CharMap[] } {
  const norm: string[] = []
  const map: CharMap[] = []
  const atLineStart = (): boolean => norm.length === 0 || norm[norm.length - 1] === '\n'
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (ch === ' ' || ch === '\t') {
      if (atLineStart()) continue
      if (norm.length > 0 && norm[norm.length - 1] === ' ') {
        map[map.length - 1]!.end = i + 1
        continue
      }
      norm.push(' ')
      map.push({ start: i, end: i + 1 })
    } else {
      const folded = SMART_QUOTES.get(ch) ?? ch
      norm.push(folded)
      map.push({ start: i, end: i + 1 })
    }
  }
  return { norm: norm.join(''), map }
}

function findQuoteMatches(content: string, search: string): QuoteMatch[] {
  const { norm: normContent, map } = normalizeWithMap(content)
  const normSearch = normalizeWithMap(search).norm
  if (normSearch.length === 0) return []
  const matches: QuoteMatch[] = []
  let index = normContent.indexOf(normSearch)
  while (index !== -1) {
    const startEntry = map[index]
    const endEntry = map[index + normSearch.length - 1]
    if (startEntry !== undefined && endEntry !== undefined) {
      matches.push({
        index: startEntry.start,
        actual: content.slice(startEntry.start, endEntry.end),
      })
    }
    index = normContent.indexOf(normSearch, index + 1)
  }
  return matches
}

function adaptReplacementQuotes(replacement: string, actual: string, requested: string): string {
  const style = new Map<string, string>()
  for (let index = 0; index < Math.min(actual.length, requested.length); index += 1) {
    const normalized = normalizeQuotes(requested[index] ?? '')
    const actualCharacter = actual[index]
    if ((normalized === "'" || normalized === '"') && actualCharacter) {
      style.set(normalized, actualCharacter)
    }
  }
  return [...replacement].map(character => style.get(normalizeQuotes(character)) ?? character).join('')
}

function replaceText(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
  matches = findQuoteMatches(content, oldString),
): { content: string; actual: string; count: number } {
  if (matches.length === 0) throw new Error('old_string not found in file')
  if (matches.length > 1 && !replaceAll) {
    throw new Error(`Found ${matches.length} matches of old_string. Provide more surrounding context or set replace_all to true.`)
  }

  const selected = replaceAll ? matches : matches.slice(0, 1)
  let next = content
  for (const match of [...selected].reverse()) {
    const replacement = adaptReplacementQuotes(newString, match.actual, oldString)
    let end = match.index + match.actual.length
    if (replacement.length === 0 && !match.actual.endsWith('\n') && next[end] === '\n') end += 1
    next = `${next.slice(0, match.index)}${replacement}${next.slice(end)}`
  }
  return { content: next, actual: matches[0]!.actual, count: matches.length }
}

export async function executeEdit(input: EditInput): Promise<ToolResponse> {
  if (input.old_string === input.new_string) throw new Error('old_string and new_string must be different')
  if (path.extname(input.file_path).toLowerCase() === '.ipynb') {
    throw new Error('Editing Jupyter notebooks is not supported')
  }

  const context = await getProjectFileContext(input.file_path)
  let exists = true
  try {
    const info = await stat(context.absolutePath)
    if (info.size > MAX_EDIT_BYTES) throw new Error('File exceeds the 1 GiB edit limit')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    exists = false
  }

  if (!exists) {
    if (input.old_string !== '') throw new Error(`File does not exist: ${input.file_path}`)
    await mkdir(path.dirname(context.absolutePath), { recursive: true })
    const snapshot = {
      absolutePath: context.absolutePath,
      root: context.root,
      encoding: context.encoding,
      text: '',
      bom: null,
      newline: null,
      mtimeMs: 0,
      size: 0,
      hash: '',
      complete: true,
    } as const
    const buffer = encodeText(input.new_string, context.encoding)
    await atomicWriteBuffer(context.root, context.absolutePath, buffer)
    const info = await stat(context.absolutePath)
    readRegistry.updateAfterWrite(snapshot, input.new_string, buffer, info.mtimeMs)
    void rememberIndexedEncoding(context.root, context.absolutePath, context.encoding, {
      mtimeMs: info.mtimeMs,
      size: info.size,
    })
    const structuredPatch = createStructuredPatch(context.absolutePath, '', input.new_string)
    return {
      content: [{ type: 'text', text: formatFileChangeMessage(context.absolutePath, '', input.new_string, 'created', structuredPatch) }],
    }
  }

  const current = await readDecodedFile(context)
  if (input.old_string === '' && current.text.trim().length > 0) {
    throw new Error('Cannot use an empty old_string to overwrite a non-empty file')
  }
  const matches = input.old_string === '' ? [] : findQuoteMatches(current.text, input.old_string)
  if (input.old_string !== '' && matches.length === 0) throw new Error('old_string not found in file')
  if (matches.length > 1 && !(input.replace_all ?? false)) {
    throw new Error(`Found ${matches.length} matches of old_string. Provide more surrounding context or set replace_all to true.`)
  }
  const selectedMatches = input.replace_all ? matches : matches.slice(0, 1)
  const indexedKnown = await hasIndexedEncoding(context.root, context.absolutePath)
  const authorization = readRegistry.authorizeEdit(
    context.absolutePath,
    current.mtimeMs,
    current.size,
    selectedMatches.map(match => lineRangeForMatch(current.text, match)),
    indexedKnown,
  )
  if (authorization.status === 'unread') {
    throw new Error('File has not been read. Read the target lines before attempting to edit them.')
  }
  if (authorization.status === 'changed') {
    throw new Error('File has been unexpectedly modified. Read the target lines again before attempting to write it.')
  }
  if (authorization.status === 'uncovered') {
    const ranges = authorization.missing
      .map(range => range.startLine === range.endLine ? String(range.startLine) : `${range.startLine}-${range.endLine}`)
      .join(', ')
    throw new Error(`The target text has not been read. Read line range(s) ${ranges} before attempting this edit.`)
  }

  const result = input.old_string === ''
    ? { content: input.new_string, actual: '', count: 1 }
    : replaceText(current.text, input.old_string, input.new_string, input.replace_all ?? false, matches)
  const buffer = encodeSnapshotText(current, result.content)
  await atomicWriteBuffer(context.root, context.absolutePath, buffer, {
    expected: { mtimeMs: current.mtimeMs, hash: current.hash },
  })
  const info = await stat(context.absolutePath)
  readRegistry.updateAfterWrite(current, result.content, buffer, info.mtimeMs)
  void rememberIndexedEncoding(context.root, context.absolutePath, current.encoding, {
    mtimeMs: info.mtimeMs,
    size: info.size,
  })

  const structuredPatch = createStructuredPatch(context.absolutePath, current.text, result.content)
  return {
    content: [{ type: 'text', text: formatFileChangeMessage(context.absolutePath, current.text, result.content, 'updated', structuredPatch) }],
  }
}
