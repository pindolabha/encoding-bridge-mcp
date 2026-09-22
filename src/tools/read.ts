import { stat } from 'node:fs/promises'
import path from 'node:path'

import { maxTextFileBytes } from '../limits.js'
import { getProjectFileContext, readDecodedFile, readRegistry } from '../core.js'
import { inspectProjectPath } from '../filesystem/index.js'
import { readImage, readPdf, parseNotebook, mapNotebook } from '../media/index.js'
import type { McpContentBlock } from '../media/index.js'
import type { ReadInput, ToolContent, ToolResponse } from '../toolTypes.js'
import {
  assertObject,
  optionalInteger,
  optionalString,
  rejectUnknown,
  requiredString,
} from '../validation.js'

const DEFAULT_MAX_BYTES = 256 * 1024
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp'])
const BINARY_EXTENSIONS = new Set([
  '.7z', '.a', '.bin', '.class', '.dll', '.dylib', '.exe', '.gz', '.iso', '.jar',
  '.lib', '.o', '.obj', '.rar', '.so', '.tar', '.wasm', '.zip',
])

export function parseReadInput(value: unknown): ReadInput {
  assertObject(value)
  rejectUnknown(value, ['file_path', 'offset', 'limit', 'pages'])
  const file_path = requiredString(value, 'file_path')
  const offset = optionalInteger(value, 'offset', 0)
  const limit = optionalInteger(value, 'limit', 1)
  const pages = optionalString(value, 'pages')
  return {
    file_path,
    ...(offset === undefined ? {} : { offset }),
    ...(limit === undefined ? {} : { limit }),
    ...(pages === undefined ? {} : { pages }),
  }
}

function lineNumber(content: string, startLine: number): string {
  return content
    .split('\n')
    .map((line, index) => `${String(startLine + index).padStart(6)}\t${line}`)
    .join('\n')
}

function notebookContent(text: string): ToolContent[] {
  const notebook = parseNotebook(text)
  const cells = mapNotebook(notebook)
  const blocks: ToolContent[] = []
  for (const [index, cell] of cells.entries()) {
    const original = notebook.cells[index]
    const cellId = original?.id ?? `cell-${index}`
    const source = Array.isArray(original?.source) ? original.source.join('') : (original?.source ?? '')
    blocks.push({
      type: 'text',
      text: `<cell id="${cellId}"><cell_type>${cell.cellType}</cell_type>${source}</cell id="${cellId}">`,
    })
    for (const block of cell.content.slice(source.length === 0 ? 0 : 1)) {
      blocks.push(block as ToolContent)
    }
  }
  return blocks
}

export async function executeRead(input: ReadInput): Promise<ToolResponse> {
  const context = await getProjectFileContext(input.file_path)
  const safe = await inspectProjectPath(context.root, context.absolutePath)
  const info = await stat(safe.target)
  if (info.isDirectory()) throw new Error(`Cannot read a directory: ${input.file_path}`)

  if (await readRegistry.isUnchanged(context.absolutePath, context.root, input.offset, input.limit)) {
    return {
      content: [{
        type: 'text',
        text: 'File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading.',
      }],
      structuredContent: { type: 'file_unchanged', file: { filePath: context.absolutePath } },
    }
  }

  const extension = path.extname(context.absolutePath).toLowerCase()
  if (IMAGE_EXTENSIONS.has(extension)) {
    const block = await readImage(context.absolutePath, { maxWidth: 2000, maxHeight: 2000, quality: 80 })
    return { content: [block] }
  }
  if (extension === '.pdf') {
    const blocks = await readPdf(context.absolutePath, input.pages === undefined ? {} : { pages: input.pages })
    return {
      content: [
        { type: 'text', text: `PDF ${context.absolutePath}${input.pages ? `, pages ${input.pages}` : ''}` },
        ...blocks,
      ],
    }
  }
  if (BINARY_EXTENSIONS.has(extension)) {
    throw new Error(`Cannot read binary file: ${input.file_path}`)
  }
  if (extension === '.ipynb' && (input.offset !== undefined || input.limit !== undefined)) {
    throw new Error('offset and limit are not supported for Jupyter notebooks; read the complete notebook')
  }

  const maximumBytes = maxTextFileBytes()
  if (info.size > maximumBytes) {
    throw new Error(
      `File content (${info.size} bytes) exceeds the absolute maximum (${maximumBytes} bytes). Set ENCODING_BRIDGE_MAX_TEXT_FILE_MIB to raise it.`,
    )
  }
  if (input.limit === undefined && info.size > DEFAULT_MAX_BYTES) {
    throw new Error(
      `File content (${info.size} bytes) exceeds maximum allowed size (${DEFAULT_MAX_BYTES} bytes). Use offset and limit to read a portion of the file.`,
    )
  }

  const snapshot = await readDecodedFile(context)
  const lines = snapshot.text.split('\n')
  const offset = input.offset === undefined || input.offset === 0 ? 1 : input.offset
  const startIndex = offset - 1
  const endIndex = input.limit === undefined ? lines.length : startIndex + input.limit
  const selected = lines.slice(startIndex, endIndex)
  const remembered = {
    ...snapshot,
    complete: false,
    ...(input.offset === undefined ? {} : { offset: input.offset }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  }

  if (snapshot.text.length === 0) {
    readRegistry.remember(remembered, { startLine: 1, endLine: 1, totalLines: 1 })
    return { content: [{ type: 'text', text: '<system-reminder>Warning: the file exists but has empty contents.</system-reminder>' }] }
  }
  if (startIndex >= lines.length) {
    return {
      content: [{
        type: 'text',
        text: `<system-reminder>Warning: offset ${offset} exceeds file length (${lines.length} lines).</system-reminder>`,
      }],
    }
  }
  readRegistry.remember(remembered, {
    startLine: offset,
    endLine: offset + selected.length - 1,
    totalLines: lines.length,
  })
  if (extension === '.ipynb') {
    return { content: notebookContent(snapshot.text) }
  }

  const content = selected.join('\n')
  return {
    content: [{ type: 'text', text: lineNumber(content, offset) }],
    structuredContent: {
      type: 'text',
      file: {
        filePath: context.absolutePath,
        content,
        numLines: selected.length,
        startLine: offset,
        totalLines: lines.length,
        encoding: snapshot.encoding,
      },
    },
  }
}
