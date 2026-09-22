import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { createServer, isMainModule } from '../src/server.js'

async function connectedClient(): Promise<{ client: Client; close: () => Promise<void> }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = createServer()
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return {
    client,
    close: async () => {
      await client.close()
      await server.close()
    },
  }
}

describe('MCP protocol', () => {
  it('recognizes a symlinked server entrypoint as the main module', async (ctx) => {
    const root = await mkdtemp(path.join(tmpdir(), 'encoding-mcp-main-'))
    const target = path.join(root, 'server.js')
    const link = path.join(root, 'encoding-bridge-mcp')
    await writeFile(target, '')
    try {
      await symlink(target, link, 'file')
    } catch (err) {
      // Symlinks need developer mode / admin rights on Windows; skip there.
      if ((err as NodeJS.ErrnoException).code === 'EPERM' || (err as NodeJS.ErrnoException).code === 'EACCES') {
        ctx.skip()
        return
      }
      throw err
    }
    expect(isMainModule(pathToFileURL(target).href, link)).toBe(true)
    expect(isMainModule(pathToFileURL(target).href, path.join(root, 'other.js'))).toBe(false)
  })

  it('lists the compatible tools with strict schemas', async () => {
    const { client, close } = await connectedClient()
    try {
      const result = await client.listTools()
      expect(result.tools.map(tool => tool.name)).toEqual(['Read', 'Edit', 'Write', 'Grep'])
      for (const tool of result.tools) {
        expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false })
        expect(tool.description?.length).toBeGreaterThan(100)
      }
    } finally {
      await close()
    }
  })

  it('returns tool errors as MCP isError results', async () => {
    const { client, close } = await connectedClient()
    try {
      const result = await client.callTool({ name: 'Read', arguments: {} })
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('file_path must be a string') }),
      ])
    } finally {
      await close()
    }
  })
})
