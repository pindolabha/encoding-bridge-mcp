#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'

import {
  EDIT_DESCRIPTION,
  EDIT_PROMPT,
  GREP_DESCRIPTION,
  GREP_PROMPT,
  READ_DESCRIPTION,
  READ_PROMPT,
  WRITE_DESCRIPTION,
  WRITE_PROMPT,
} from './prompts.js'
import {
  editInputSchema,
  grepInputSchema,
  readInputSchema,
  writeInputSchema,
} from './schemas.js'
import { executeEdit, parseEditInput } from './tools/edit.js'
import { executeGrep, parseGrepInput } from './tools/grep.js'
import { executeRead, parseReadInput } from './tools/read.js'
import { executeWrite, parseWriteInput } from './tools/write.js'
import { configuredRoots } from './core.js'
import { ensureProjectIndex } from './encoding/ensureIndex.js'
import type { ToolResponse } from './toolTypes.js'

export const toolDefinitions = [
  {
    name: 'Read',
    title: READ_DESCRIPTION,
    description: READ_PROMPT,
    inputSchema: readInputSchema,
  },
  {
    name: 'Edit',
    title: EDIT_DESCRIPTION,
    description: EDIT_PROMPT,
    inputSchema: editInputSchema,
  },
  {
    name: 'Write',
    title: WRITE_DESCRIPTION,
    description: WRITE_PROMPT,
    inputSchema: writeInputSchema,
  },
  {
    name: 'Grep',
    title: GREP_DESCRIPTION,
    description: GREP_PROMPT,
    inputSchema: grepInputSchema,
  },
] as const

async function dispatch(name: string, input: unknown): Promise<ToolResponse> {
  switch (name) {
    case 'Read':
      return executeRead(parseReadInput(input))
    case 'Edit':
      return executeEdit(parseEditInput(input))
    case 'Write':
      return executeWrite(parseWriteInput(input))
    case 'Grep':
      return executeGrep(parseGrepInput(input))
    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}

function toCallToolResult(response: ToolResponse): CallToolResult {
  return {
    content: response.content,
    ...(response.isError === undefined ? {} : { isError: response.isError }),
    ...(response.structuredContent === undefined ? {} : { structuredContent: response.structuredContent }),
  }
}

export function createServer(): Server {
  const server = new Server(
    { name: 'encoding-bridge', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...toolDefinitions] }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const started = Date.now()
    try {
      const result = toCallToolResult(await dispatch(request.params.name, request.params.arguments ?? {}))
      const elapsed = Date.now() - started
      const text = result.content.find(block => block.type === 'text')
      if (text) {
        text.text = `${text.text}\n\n[encoding-bridge-timing: ${request.params.name} ${elapsed}ms]`
      }
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        isError: true,
        content: [{ type: 'text', text: `<tool_use_error>${message}</tool_use_error>` }],
      }
    }
  })
  return server
}

export async function main(): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()
  // Ensure every configured root (cwd + ENCODING_BRIDGE_ROOTS) has its encoding
  // index built and its watcher running, not just roots whose files have been
  // accessed already. Each root is scanned only if its index is missing; roots
  // with an index just start a watcher. Fire-and-forget so server startup is not
  // blocked by a large initial scan.
  for (const root of configuredRoots()) {
    ensureProjectIndex(root)
  }
  let closing = false
  const close = async (): Promise<void> => {
    if (closing) return
    closing = true
    await server.close()
  }
  process.stdin.on('end', () => void close())
  process.stdin.on('error', error => {
    console.error(error)
    void close()
  })
  await server.connect(transport)
}

export function isMainModule(moduleUrl: string, entryPath = process.argv[1]): boolean {
  if (entryPath === undefined) return false
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath)
  } catch {
    return false
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
