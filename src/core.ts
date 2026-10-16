import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import {
  decodeText,
  detectEncodingFromBytes,
  encodeText,
  ensureProjectIndex,
  lookupIndexedEncoding,
  readFileRange,
  rememberIndexedEncoding,
  type DecodedText,
} from './encoding/index.js'
import { readFileState, resolveProjectPath } from './filesystem/index.js'

export interface ProjectFileContext {
  absolutePath: string
  root: string
  encoding: string
}

export interface ReadSnapshot {
  absolutePath: string
  root: string
  encoding: string
  text: string
  bom: DecodedText['bom']
  newline: DecodedText['newline']
  mtimeMs: number
  size: number
  hash: string
  complete: boolean
  offset?: number
  limit?: number
}

function digest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Roots auto-registered on first access outside the configured roots. */
/**
 * Resolve the list of index roots. Only roots explicitly listed in
 * `ENCODING_BRIDGE_ROOTS` (path-separator delimited, e.g. `;` on Windows) are
 * used. Without configuration the list is empty and Encoding Bridge does not
 * engage at all (tools are unusable, so Claude falls back to its built-ins);
 * the VS Code working directory is NOT auto-treated as a root.
 */
export function configuredRoots(): string[] {
  const raw = process.env.ENCODING_BRIDGE_ROOTS
  if (!raw) return []
  return raw.split(path.delimiter).map(p => p.trim()).filter(Boolean).map(p => path.resolve(p))
}

/** Find which configured root contains the path (deepest match wins). */
function rootFor(roots: string[], absolutePath: string): string | undefined {
  let best: string | undefined
  for (const root of roots) {
    const rel = path.relative(root, absolutePath)
    const within = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    if (within && (best === undefined || root.length > best.length)) best = root
  }
  return best
}

export async function getProjectFileContext(filePath: string): Promise<ProjectFileContext> {
  if (filePath.includes('\0')) throw new Error('file_path must not contain NUL bytes')
  if (/^[/\\]{2}/.test(filePath) || /^\\\\[?.]\\/.test(filePath)) {
    throw new Error('UNC and device paths are not allowed')
  }
  if (!path.isAbsolute(filePath)) throw new Error('file_path must be an absolute path')
  const absolutePath = path.resolve(filePath)
  const roots = configuredRoots()
  // Without any configured root Encoding Bridge is not engaged: throw so the
  // model falls back to Claude's built-in tools.
  if (roots.length === 0) {
    throw new Error('Encoding Bridge is not configured. Set ENCODING_BRIDGE_ROOTS in the project .mcp.json to enable it.')
  }
  // Files inside a configured root get a persistent index + watcher; files
  // outside every root are handled transiently (memory-only cache).
  const root = rootFor(roots, absolutePath) ?? path.dirname(absolutePath)
  const inConfiguredRoot = rootFor(roots, absolutePath) !== undefined
  resolveProjectPath(root, absolutePath)
  if (inConfiguredRoot) ensureProjectIndex(root)
  return {
    absolutePath,
    root,
    encoding: 'utf-8',
  }
}

export async function resolveFileEncoding(
  root: string,
  filePath: string,
  state?: { buffer: Buffer; mtimeMs: number; size: number },
): Promise<string> {
  if (state === undefined) {
    // Index-first: a fresh index entry answers without reading content, so
    // range reads of indexed files touch only the requested lines. On an index
    // miss (or a stale entry caught by the mtime/size check) read once, detect,
    // remember.
    try {
      const info = await stat(filePath)
      const indexed = await lookupIndexedEncoding(root, filePath, { mtimeMs: info.mtimeMs, size: info.size })
      if (indexed !== undefined) return indexed
      const buffer = await readFile(filePath)
      const detected = detectEncodingFromBytes(buffer)
      const encoding = detected.kind === 'text' && detected.encoding !== undefined ? detected.encoding : 'utf-8'
      await rememberIndexedEncoding(root, filePath, encoding, { mtimeMs: info.mtimeMs, size: info.size })
      return encoding
    } catch {
      // Unreadable — same answer the old read-then-detect path gave on failure.
      return 'utf-8'
    }
  }
  const indexed = await lookupIndexedEncoding(root, filePath, state)
  if (indexed !== undefined) return indexed
  const detected = detectEncodingFromBytes(state.buffer)
  const encoding = detected.kind === 'text' && detected.encoding !== undefined ? detected.encoding : 'utf-8'
  await rememberIndexedEncoding(root, filePath, encoding, { mtimeMs: state.mtimeMs, size: state.size })
  return encoding
}

export async function readDecodedFile(context: ProjectFileContext): Promise<ReadSnapshot> {
  const state = await readFileState(context.root, context.absolutePath)
  const encoding = await resolveFileEncoding(context.root, context.absolutePath, state)
  const decoded = decodeText(state.buffer, encoding)
  await rememberIndexedEncoding(context.root, context.absolutePath, decoded.encoding, {
    mtimeMs: state.mtimeMs,
    size: state.size,
  })
  return {
    absolutePath: context.absolutePath,
    root: context.root,
    encoding: decoded.encoding,
    text: decoded.text.replaceAll('\r\n', '\n').replaceAll('\r', '\n'),
    bom: decoded.bom,
    newline: decoded.newline,
    mtimeMs: state.mtimeMs,
    size: state.size,
    hash: state.hash,
    complete: true,
  }
}

export function encodeSnapshotText(snapshot: ReadSnapshot, text: string, preserveNewline = true): Buffer {
  return encodeText(text, snapshot.encoding, {
    bom: snapshot.bom,
    newline: preserveNewline ? snapshot.newline : null,
  })
}

export interface ReadRangeSnapshot {
  absolutePath: string
  root: string
  encoding: string
  text: string
  bom: DecodedText['bom']
  newline: DecodedText['newline']
  mtimeMs: number
  size: number
  hash: string
  complete: boolean
  /** Total lines in the file, or undefined when the read stopped early
   *  (large-file streaming) and the total was never counted. */
  totalLines: number | undefined
}

/**
 * Chunked, encoding-aware line read, mirroring Claude's readFileInRange: only
 * the selected line range is decoded, so reading a few lines of a huge legacy
 * file doesn't balloon memory. Uses the precomputed encoding from the index.
 */
export async function readDecodedRange(
  context: ProjectFileContext,
  startLine: number,
  limit?: number,
): Promise<ReadRangeSnapshot> {
  // Read-only path: no full-file read here at all. The encoding comes from the
  // index when it is fresh (stat-fresh, so stale entries re-detect), and the
  // range itself is read by readFileRange — a 50-line read of a 500 MB indexed
  // file touches ~50 lines instead of the whole file.
  const info = await stat(context.absolutePath)
  const encoding = await resolveFileEncoding(context.root, context.absolutePath)
  // readFileRange uses 0-based line offsets (like Claude's readFileInRange);
  // startLine here is 1-based.
  const result = await readFileRange(
    context.absolutePath,
    encoding,
    Math.max(0, startLine - 1),
    limit,
  )
  const normalized = result.text
    .replaceAll('\r\n', '\n')
    .replaceAll('\r', '\n')
  return {
    absolutePath: context.absolutePath,
    root: context.root,
    encoding: result.encoding,
    text: normalized,
    bom: null,
    newline: null,
    mtimeMs: info.mtimeMs,
    size: info.size,
    hash: '',
    complete: false,
    totalLines: result.totalLines,
  }
}

interface ReadCoverage {
  hash: string
  mtimeMs: number
  size: number
  totalLines: number | undefined
  intervals: Array<{ start: number; end: number }>
}

const MAX_REGISTRY_ENTRIES = 128

function mergeIntervals(
  intervals: Array<{ start: number; end: number }>,
  next: { start: number; end: number },
): Array<{ start: number; end: number }> {
  if (next.end < next.start) return intervals
  const merged: Array<{ start: number; end: number }> = []
  let current = next
  for (const interval of [...intervals, next].sort((left, right) => left.start - right.start)) {
    if (interval === next) continue
    if (interval.end + 1 < current.start) merged.push(interval)
    else if (current.end + 1 < interval.start) {
      merged.push(current)
      current = interval
    } else {
      current = {
        start: Math.min(current.start, interval.start),
        end: Math.max(current.end, interval.end),
      }
    }
  }
  merged.push(current)
  return merged.sort((left, right) => left.start - right.start)
}

export class ReadRegistry {
  private readonly snapshots = new Map<string, Pick<ReadSnapshot, 'mtimeMs' | 'size'>>()
  private readonly coverage = new Map<string, ReadCoverage>()
  private readonly ranges = new Map<string, { mtimeMs: number; size: number; hash: string; offset?: number; limit?: number }>()

  private evictIfNeeded(): void {
    while (this.coverage.size >= MAX_REGISTRY_ENTRIES) {
      const oldest = this.coverage.keys().next().value
      if (oldest === undefined) return
      this.clear(oldest)
    }
  }

  private touch(filePath: string): void {
    const coverage = this.coverage.get(filePath)
    const range = this.ranges.get(filePath)
    const snapshot = this.snapshots.get(filePath)
    if (coverage !== undefined) {
      this.coverage.delete(filePath)
      this.coverage.set(filePath, coverage)
    }
    if (range !== undefined) {
      this.ranges.delete(filePath)
      this.ranges.set(filePath, range)
    }
    if (snapshot !== undefined) {
      this.snapshots.delete(filePath)
      this.snapshots.set(filePath, snapshot)
    }
  }

  get(filePath: string): Pick<ReadSnapshot, 'mtimeMs' | 'size'> | undefined {
    const absolutePath = path.resolve(filePath)
    const snapshot = this.snapshots.get(absolutePath)
    if (snapshot !== undefined) this.touch(absolutePath)
    return snapshot
  }

  clear(filePath?: string): void {
    if (filePath === undefined) {
      this.snapshots.clear()
      this.coverage.clear()
      this.ranges.clear()
      return
    }
    const absolutePath = path.resolve(filePath)
    this.snapshots.delete(absolutePath)
    this.coverage.delete(absolutePath)
    this.ranges.delete(absolutePath)
  }

  remember(
    snapshot: ReadSnapshot,
    range: { startLine: number; endLine: number; totalLines: number | undefined },
  ): void {
    const key = snapshot.absolutePath
    const existing = this.coverage.get(key)
    if (existing === undefined) this.evictIfNeeded()
    else this.touch(key)
    const sameVersion = existing?.hash === snapshot.hash
      && existing.mtimeMs === snapshot.mtimeMs
    const intervals = sameVersion ? existing.intervals : []
    const merged = mergeIntervals(intervals, {
      start: Math.max(1, range.startLine),
      end: range.totalLines === undefined ? range.endLine : Math.min(range.totalLines, range.endLine),
    })
    const complete = range.totalLines !== undefined
      && merged.length === 1
      && merged[0]?.start === 1
      && merged[0].end >= range.totalLines
    const remembered: ReadSnapshot = { ...snapshot, complete }
    this.coverage.set(key, {
      hash: remembered.hash,
      mtimeMs: remembered.mtimeMs,
      size: remembered.size,
      totalLines: range.totalLines,
      intervals: merged,
    })
    if (complete) this.snapshots.set(key, { mtimeMs: remembered.mtimeMs, size: remembered.size })
    else this.snapshots.delete(key)
    this.ranges.set(key, {
      mtimeMs: snapshot.mtimeMs,
      size: snapshot.size,
      hash: snapshot.hash,
      ...(snapshot.offset === undefined ? {} : { offset: snapshot.offset }),
      ...(snapshot.limit === undefined ? {} : { limit: snapshot.limit }),
    })
  }

  authorizeEdit(
    filePath: string,
    currentMtimeMs: number,
    currentSize: number,
    requiredRanges: Array<{ startLine: number; endLine: number }>,
    indexedKnown: boolean,
  ):
    | { status: 'authorized' }
    | { status: 'unread' }
    | { status: 'changed' }
    | { status: 'uncovered'; missing: Array<{ startLine: number; endLine: number }> } {
    const entry = this.coverage.get(path.resolve(filePath))
    if (!entry) return { status: 'unread' }
    // Compare mtime+size (like Claude's built-in tools) instead of a full-file
    // sha256. Reads skip the hash for speed; a changed mtime/size means the file
    // was touched externally since it was read.
    if (entry.mtimeMs !== currentMtimeMs || entry.size !== currentSize) return { status: 'changed' }
    // A file whose encoding is recorded in the index is "known" and behaves like
    // the built-in tools: the target range need not have been read first. Only
    // unrecorded (unknown-encoding) files keep the strict read-before-edit rule.
    if (indexedKnown) return { status: 'authorized' }
    const missing = requiredRanges.filter(required => !entry.intervals.some(
      interval => interval.start <= required.startLine && interval.end >= required.endLine,
    ))
    if (missing.length > 0) return { status: 'uncovered', missing }
    return { status: 'authorized' }
  }
  async isUnchanged(filePath: string, root: string, offset?: number, limit?: number): Promise<boolean> {
    const absolutePath = path.resolve(filePath)
    const previous = this.ranges.get(absolutePath)
    if (!previous || previous.offset !== offset || previous.limit !== limit) return false
    // Compare mtime+size via stat alone — reading the file just to check for
    // changes wasted a full-file read on every repeat Read. (Claude's own
    // dedup uses a stat-only modification-time check for the same reason.)
    const info = await stat(absolutePath)
    return info.mtimeMs === previous.mtimeMs && info.size === previous.size
  }

  updateAfterWrite(snapshot: ReadSnapshot, text: string, buffer: Buffer, mtimeMs: number): void {
    const hash = digest(buffer)
    const totalLines = text.split('\n').length
    this.evictIfNeeded()
    this.snapshots.set(snapshot.absolutePath, { mtimeMs, size: buffer.length })
    this.coverage.set(snapshot.absolutePath, {
      hash,
      mtimeMs,
      size: buffer.length,
      totalLines,
      intervals: [{ start: 1, end: totalLines }],
    })
    this.ranges.set(snapshot.absolutePath, { mtimeMs, size: buffer.length, hash })
  }
}
export const readRegistry = new ReadRegistry()
