import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import iconv from 'iconv-lite'
import { afterEach, describe, expect, it } from 'vitest'

import { clearEncodingIndexCache, flushEncodingIndex } from '../src/encoding/index.js'
import { executeScanEncodings } from '../src/tools/scanEncodings.js'

afterEach(async () => {
  await flushEncodingIndex()
  clearEncodingIndexCache()
})

describe('ScanEncodings', () => {
  it('writes a local index for mixed UTF-8 and GBK files', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'encoding-scan-'))
    process.chdir(root)
    await writeFile(path.join(root, 'utf8.txt'), '错误 utf8', 'utf8')
    await writeFile(path.join(root, 'gbk.txt'), iconv.encode('错误 gbk', 'gbk'))
    const result = await executeScanEncodings({ path: root })
    expect(result.structuredContent).toMatchObject({ scanned: 2 })
    const indexRoot = (result.structuredContent as { root: string }).root
    const index = JSON.parse(await readFile(path.join(indexRoot, '.encoding-bridge', 'encoding-index.json'), 'utf8')) as {
      files: Record<string, { encoding: string }>
    }
    const encodings = Object.fromEntries(Object.entries(index.files).map(([key, value]) => [path.basename(key), value.encoding]))
    expect(encodings['utf8.txt']).toBe('utf-8')
    expect(['gbk', 'gb18030']).toContain(encodings['gbk.txt'])
  })
})
