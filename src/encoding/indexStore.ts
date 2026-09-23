import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { INDEX_DIRECTORY, INDEX_FILE } from './detect.js'

export interface IndexedFile {
  encoding: string
  mtimeMs: number
  size: number
}

interface IndexDocument {
  version: 1
  files: Record<string, IndexedFile>
}

interface LoadedIndex {
  root: string
  files: Map<string, IndexedFile>
  dirty: boolean
  writeTimer: ReturnType<typeof setTimeout> | undefined
  load: Promise<void>
}

const indexes = new Map<string, LoadedIndex>()
const WRITE_DELAY_MS = 250

function indexPath(root: string): string {
  return path.join(root, INDEX_DIRECTORY, INDEX_FILE)
}

function toRelative(root: string, filePath: string): string {
  return path.relative(root, filePath).split(path.sep).join('/')
}

async function readDocument(root: string): Promise<IndexDocument> {
  try {
    const raw = await readFile(indexPath(root), 'utf8')
    const parsed = JSON.parse(raw) as IndexDocument
    if (parsed.version !== 1 || typeof parsed.files !== 'object' || parsed.files === null) {
      return { version: 1, files: {} }
    }
    return parsed
  } catch {
    return { version: 1, files: {} }
  }
}

function getLoaded(root: string): LoadedIndex {
  const existing = indexes.get(root)
  if (existing !== undefined) return existing
  const loaded: LoadedIndex = {
    root,
    files: new Map(),
    dirty: false,
    writeTimer: undefined,
    load: Promise.resolve(),
  }
  loaded.load = readDocument(root).then(document => {
    for (const [relative, entry] of Object.entries(document.files)) {
      if (typeof entry?.encoding === 'string' && Number.isFinite(entry.mtimeMs) && Number.isFinite(entry.size)) {
        loaded.files.set(relative, { encoding: entry.encoding, mtimeMs: entry.mtimeMs, size: entry.size })
      }
    }
  })
  indexes.set(root, loaded)
  return loaded
}

async function flush(loaded: LoadedIndex): Promise<void> {
  if (!loaded.dirty) return
  loaded.dirty = false
  const files: Record<string, IndexedFile> = {}
  for (const [relative, entry] of [...loaded.files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    files[relative] = entry
  }
  const directory = path.join(loaded.root, INDEX_DIRECTORY)
  await mkdir(directory, { recursive: true })
  const target = indexPath(loaded.root)
  const temp = `${target}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify({ version: 1, files }, null, 2)}\n`, 'utf8')
  await rename(temp, target)
}

function scheduleWrite(loaded: LoadedIndex): void {
  loaded.dirty = true
  if (loaded.writeTimer !== undefined) return
  loaded.writeTimer = setTimeout(() => {
    loaded.writeTimer = undefined
    void flush(loaded).catch(() => {
      loaded.dirty = true
    })
  }, WRITE_DELAY_MS)
  loaded.writeTimer.unref?.()
}

export async function lookupIndexedEncoding(
  root: string,
  filePath: string,
  stats: { mtimeMs: number; size: number },
): Promise<string | undefined> {
  const loaded = getLoaded(root)
  await loaded.load
  const entry = loaded.files.get(toRelative(root, filePath))
  if (entry === undefined) return undefined
  if (entry.size !== stats.size || Math.abs(entry.mtimeMs - stats.mtimeMs) > 1) return undefined
  return entry.encoding
}

export async function rememberIndexedEncoding(
  root: string,
  filePath: string,
  encoding: string,
  stats: { mtimeMs: number; size: number },
): Promise<void> {
  const loaded = getLoaded(root)
  await loaded.load
  const relative = toRelative(root, filePath)
  const previous = loaded.files.get(relative)
  if (
    previous?.encoding === encoding
    && previous.size === stats.size
    && Math.abs(previous.mtimeMs - stats.mtimeMs) <= 1
  ) {
    return
  }
  loaded.files.set(relative, { encoding, mtimeMs: stats.mtimeMs, size: stats.size })
  scheduleWrite(loaded)
}

export async function forgetIndexedEncoding(root: string, filePath: string): Promise<void> {
  const loaded = getLoaded(root)
  await loaded.load
  if (!loaded.files.delete(toRelative(root, filePath))) return
  scheduleWrite(loaded)
}

export async function listIndexedEncodings(root: string): Promise<Map<string, IndexedFile>> {
  const loaded = getLoaded(root)
  await loaded.load
  return new Map(loaded.files)
}

/**
 * Whether the index holds an encoding record for the given file, regardless of
 * whether the record's mtime/size still matches. This is distinct from
 * `lookupIndexedEncoding`, which only returns a value when the record is fresh.
 * A file with a record (even a stale one) is "known" and does not need to be
 * read before an edit; an unrecorded file is unknown and must be read first.
 */
export async function hasIndexedEncoding(root: string, filePath: string): Promise<boolean> {
  const loaded = getLoaded(root)
  await loaded.load
  return loaded.files.has(toRelative(root, filePath))
}

export async function flushEncodingIndex(root?: string): Promise<void> {
  if (root !== undefined) {
    const loaded = indexes.get(root)
    if (loaded !== undefined) {
      if (loaded.writeTimer !== undefined) {
        clearTimeout(loaded.writeTimer)
        loaded.writeTimer = undefined
      }
      await flush(loaded)
    }
    return
  }
  await Promise.all([...indexes.keys()].map(item => flushEncodingIndex(item)))
}

export function clearEncodingIndexCache(): void {
  for (const loaded of indexes.values()) {
    if (loaded.writeTimer !== undefined) clearTimeout(loaded.writeTimer)
  }
  indexes.clear()
}
