import { watch, type FSWatcher } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { detectEncodingFromBytes, isSourceFileName, shouldIgnoreDirectoryName } from './detect.js'
import { forgetIndexedEncoding, rememberIndexedEncoding } from './indexStore.js'

const watchers = new Map<string, FSWatcher>()

function watchEnabled(): boolean {
  if (process.env.VITEST !== undefined) return false
  const value = process.env.ENCODING_BRIDGE_WATCH
  if (value === undefined) return true
  return !['0', 'false', 'off', 'no'].includes(value.toLowerCase())
}

function ignoredPath(root: string, filePath: string): boolean {
  const relative = path.relative(root, filePath)
  if (relative.startsWith('..')) return true
  return relative.split(path.sep).some(part => shouldIgnoreDirectoryName(part) || part.endsWith('.log'))
}

async function refresh(root: string, filePath: string): Promise<void> {
  if (ignoredPath(root, filePath) || !isSourceFileName(path.basename(filePath))) return
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return
    const buffer = await readFile(filePath)
    const detected = detectEncodingFromBytes(buffer)
    if (detected.kind !== 'text' || detected.encoding === undefined) {
      await forgetIndexedEncoding(root, filePath)
      return
    }
    await rememberIndexedEncoding(root, filePath, detected.encoding, { mtimeMs: info.mtimeMs, size: info.size })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      await forgetIndexedEncoding(root, filePath)
    }
  }
}

/** Refresh the encoding index for a single file (used by the watcher and by tests). */
export async function refreshEncodingIndex(root: string, filePath: string): Promise<void> {
  return refresh(root, filePath)
}

export function ensureEncodingWatch(root: string): void {
  if (!watchEnabled()) return
  const absolute = path.resolve(root)
  if (watchers.has(absolute)) return
  try {
    const watcher = watch(absolute, { recursive: true, persistent: false }, (_event, filename) => {
      if (filename === null) return
      const filePath = path.resolve(absolute, filename.toString())
      void refresh(absolute, filePath)
    })
    watcher.on('error', () => {
      watchers.delete(absolute)
    })
    watchers.set(absolute, watcher)
  } catch {
    // Recursive watch is unavailable on this platform/filesystem; lazy updates still apply.
  }
}

export function stopEncodingWatches(): void {
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
}
