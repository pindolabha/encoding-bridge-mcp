import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import { getProjectFileContext } from '../core.js'
import {
  detectEncodingFromBytes,
  ensureEncodingWatch,
  flushEncodingIndex,
  forgetIndexedEncoding,
  isSourceFileName,
  rememberIndexedEncoding,
  shouldIgnoreDirectoryName,
} from '../encoding/index.js'
import { inspectProjectPath } from '../filesystem/index.js'
import type { ToolResponse } from '../toolTypes.js'
import { assertObject, optionalString, rejectUnknown } from '../validation.js'

export interface ScanEncodingsInput {
  path?: string
}

export function parseScanEncodingsInput(value: unknown): ScanEncodingsInput {
  assertObject(value)
  rejectUnknown(value, ['path'])
  const target = optionalString(value, 'path')
  return target === undefined ? {} : { path: target }
}

export async function executeScanEncodings(input: ScanEncodingsInput): Promise<ToolResponse> {
  const targetInput = path.resolve(input.path ?? process.cwd())
  const context = await getProjectFileContext(targetInput)
  const safe = await inspectProjectPath(context.root, targetInput)
  const root = safe.root
  const info = await stat(safe.target)
  const counts = new Map<string, number>()
  let scanned = 0
  let skipped = 0
  let binary = 0

  const visitFile = async (file: string): Promise<void> => {
    if (!isSourceFileName(path.basename(file))) {
      skipped += 1
      return
    }
    const fileInfo = await stat(file)
    if (!fileInfo.isFile()) return
    scanned += 1
    const buffer = await readFile(file)
    const detected = detectEncodingFromBytes(buffer)
    if (detected.kind !== 'text' || detected.encoding === undefined) {
      binary += 1
      await forgetIndexedEncoding(root, file)
      return
    }
    await rememberIndexedEncoding(root, file, detected.encoding, {
      mtimeMs: fileInfo.mtimeMs,
      size: fileInfo.size,
    })
    counts.set(detected.encoding, (counts.get(detected.encoding) ?? 0) + 1)
  }

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (shouldIgnoreDirectoryName(entry.name)) continue
        await visit(path.join(directory, entry.name))
        continue
      }
      if (entry.isFile()) await visitFile(path.join(directory, entry.name))
    }
  }

  if (info.isFile()) {
    await visitFile(safe.target)
  } else if (info.isDirectory()) {
    await visit(safe.target)
  } else {
    throw new Error(`Path is not a file or directory: ${targetInput}`)
  }

  await flushEncodingIndex(root)
  ensureEncodingWatch(root)
  const summary = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([encoding, count]) => `${encoding}: ${count}`)
  const text = [
    `Scanned ${scanned} source files under ${targetInput}`,
    ...summary,
    binary > 0 ? `binary/unreadable: ${binary}` : undefined,
    skipped > 0 ? `skipped non-source: ${skipped}` : undefined,
    `Index written to ${path.join(root, '.encoding-bridge', 'encoding-index.json')}`,
  ].filter(Boolean).join('\n')

  return {
    content: [{ type: 'text', text }],
    structuredContent: {
      root,
      scanned,
      skipped,
      binary,
      encodings: Object.fromEntries(counts),
    },
  }
}
