import { access } from 'node:fs/promises'
import path from 'node:path'

import { INDEX_DIRECTORY, INDEX_FILE } from './detect.js'
import { ensureEncodingWatch } from './watch.js'
import { executeScanEncodings } from '../tools/scanEncodings.js'

const startedRoots = new Set<string>()

export function ensureProjectIndex(root: string): void {
  if (process.env.VITEST !== undefined) return
  const absolute = path.resolve(root)
  if (startedRoots.has(absolute)) return
  startedRoots.add(absolute)
  void (async () => {
    try {
      await access(path.join(absolute, INDEX_DIRECTORY, INDEX_FILE))
      ensureEncodingWatch(absolute)
    } catch {
      await executeScanEncodings({ path: absolute })
    }
  })().catch(() => {
    startedRoots.delete(absolute)
  })
}
