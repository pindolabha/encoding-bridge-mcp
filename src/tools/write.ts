import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

import { encodeText, hasIndexedEncoding, rememberIndexedEncoding } from '../encoding/index.js'
import { getProjectFileContext, encodeSnapshotText, readDecodedFile, readRegistry } from '../core.js'
import { createStructuredPatch, formatFileChangeMessage } from '../diff.js'
import { atomicWriteBuffer } from '../filesystem/index.js'
import type { ToolResponse, WriteInput } from '../toolTypes.js'
import { assertObject, rejectUnknown, requiredString } from '../validation.js'

export function parseWriteInput(value: unknown): WriteInput {
  assertObject(value)
  rejectUnknown(value, ['file_path', 'content'])
  return {
    file_path: requiredString(value, 'file_path'),
    content: requiredString(value, 'content'),
  }
}

export async function executeWrite(input: WriteInput): Promise<ToolResponse> {
  const context = await getProjectFileContext(input.file_path)
  let exists = true
  try {
    await stat(context.absolutePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    exists = false
  }

  await mkdir(path.dirname(context.absolutePath), { recursive: true })
  if (!exists) {
    const buffer = encodeText(input.content, context.encoding)
    await atomicWriteBuffer(context.root, context.absolutePath, buffer)
    const info = await stat(context.absolutePath)
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
    readRegistry.updateAfterWrite(snapshot, input.content, buffer, info.mtimeMs)
    void rememberIndexedEncoding(context.root, context.absolutePath, context.encoding, {
      mtimeMs: info.mtimeMs,
      size: info.size,
    })
    const structuredPatch = createStructuredPatch(context.absolutePath, '', input.content)
    return {
      content: [{ type: 'text', text: formatFileChangeMessage(context.absolutePath, '', input.content, 'created', structuredPatch) }],
    }
  }

  const readSnapshot = readRegistry.get(context.absolutePath)
  // A file whose encoding is recorded in the index is "known" and, like the
  // built-in tools, does not require a prior Read. Only unknown-encoding files
  // keep the strict read-before-write rule.
  const indexedKnown = await hasIndexedEncoding(context.root, context.absolutePath)
  if (!readSnapshot && !indexedKnown) throw new Error('File has not been read. Read it before attempting to write it.')
  const current = await readDecodedFile(context)
  // When the encoding is index-known there is no prior snapshot to compare
  // against, so the mtime/size stale check is skipped (matching the built-in
  // tools). For a previously-read file, an external change still refuses.
  if (readSnapshot !== undefined && (current.mtimeMs !== readSnapshot.mtimeMs || current.size !== readSnapshot.size)) {
    throw new Error('File has been unexpectedly modified. Read it again before attempting to write it.')
  }

  const buffer = encodeSnapshotText(current, input.content, false)
  await atomicWriteBuffer(context.root, context.absolutePath, buffer, {
    expected: { mtimeMs: current.mtimeMs, hash: current.hash },
  })
  const info = await stat(context.absolutePath)
  readRegistry.updateAfterWrite(current, input.content, buffer, info.mtimeMs)
  void rememberIndexedEncoding(context.root, context.absolutePath, current.encoding, {
    mtimeMs: info.mtimeMs,
    size: info.size,
  })
  const structuredPatch = createStructuredPatch(context.absolutePath, current.text, input.content)
  return {
    content: [{ type: 'text', text: formatFileChangeMessage(context.absolutePath, current.text, input.content, 'updated', structuredPatch) }],
  }
}
