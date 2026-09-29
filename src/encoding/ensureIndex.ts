import { access } from 'node:fs/promises'
import path from 'node:path'

import { INDEX_DIRECTORY, INDEX_FILE } from './detect.js'
import { ensureEncodingWatch } from './watch.js'
import { executeScanEncodings } from '../tools/scanEncodings.js'
import { markPersistentRoot } from './indexStore.js'

const startedRoots = new Set<string>()

export function ensureProjectIndex(root: string): void {
  const absolute = path.resolve(root)
  // Mark the root as persistent unconditionally (even under vitest, so tests
  // can assert the on-disk index). Only configured roots reach this function;
  // files outside them are handled in-memory only.
  markPersistentRoot(absolute)
  if (process.env.VITEST !== undefined) return
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
