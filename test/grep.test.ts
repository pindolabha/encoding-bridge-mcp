import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import iconv from 'iconv-lite'
import { afterEach, describe, expect, it } from 'vitest'

import { clearEncodingIndexCache, flushEncodingIndex } from '../src/encoding/index.js'
import { executeGrep } from '../src/tools/grep.js'

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'encoding-grep-'))
  process.env.ENCODING_BRIDGE_ROOTS = root
  process.chdir(root)
  await mkdir(path.join(root, 'nested'))
  await writeFile(path.join(root, 'a.txt'), iconv.encode('第一行\n错误：连接失败\n第三行', 'gbk'))
  await writeFile(path.join(root, 'nested', 'b.txt'), iconv.encode('正常\n错误：超时', 'gbk'))
  await writeFile(path.join(root, 'note.md'), 'ERROR uppercase\n错误 also here\n', 'utf8')
  return root
}

afterEach(async () => {
  await flushEncodingIndex()
  clearEncodingIndexCache()
})

describe('ripgrep Grep', () => {
  it('searches UTF-8 directories without encoding rules', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'encoding-grep-no-rules-'))
    process.env.ENCODING_BRIDGE_ROOTS = root
    process.chdir(root)
    const file = path.join(root, 'plain.txt')
    await writeFile(file, 'needle', 'utf8')
    const result = await executeGrep({ pattern: 'needle', path: root })
    expect((result.content[0] as { text: string }).text.replaceAll('\\', '/')).toContain('plain.txt')
  })

  it('finds ASCII in both GBK and UTF-8 files without grouping', async () => {
    const root = await fixture()
    const result = await executeGrep({ pattern: 'ERROR', path: root })
    expect((result.content[0] as { text: string }).text).toContain('note.md')
  })

  it('finds Chinese in GBK and UTF-8 files via encoding groups', async () => {
    const root = await fixture()
    const result = await executeGrep({ pattern: '错误', path: root, output_mode: 'content' })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('错误：连接失败')
    expect(text).toContain('错误：超时')
    expect(text).toContain('错误 also here')
  })

  it('supports files, count, glob, and case-insensitive modes', async () => {
    const root = await fixture()
    const files = await executeGrep({ pattern: '错误', path: root, glob: '**/*.txt' })
    const fileLines = (files.content[0] as { text: string }).text.split('\n').filter(line => /\.txt$/.test(line))
    expect(fileLines).toHaveLength(2)
    expect((files.content[0] as { text: string }).text).toMatch(/Matches:/)
    const counts = await executeGrep({ pattern: '错误', path: root, output_mode: 'count' })
    expect((counts.content[0] as { text: string }).text).toMatch(/:\d+/)
    const insensitive = await executeGrep({ pattern: 'error', path: root, glob: '**/*.md', '-i': true })
    expect((insensitive.content[0] as { text: string }).text).toContain('note.md')
  })

  it('supports context, only matching, and pagination', async () => {
    const root = await fixture()
    const context = await executeGrep({
      pattern: '错误',
      path: path.join(root, 'a.txt'),
      output_mode: 'content',
      '-C': 1,
    })
    expect((context.content[0] as { text: string }).text).toContain('第一行')
    const only = await executeGrep({
      pattern: '错误',
      path: root,
      output_mode: 'content',
      '-o': true,
      head_limit: 1,
    })
    const text = (only.content[0] as { text: string }).text
    expect(text).toContain('错误')
    expect(text).toContain('pagination')
  })

  it('counts matches precisely in content mode with context lines', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'ctx.txt'), 'hit\nbefore\nhit\nbetween\nhit\nafter\n', 'utf8')
    const result = await executeGrep({
      pattern: 'hit',
      path: root,
      output_mode: 'content',
      '-C': 1,
    })
    const text = (result.content[0] as { text: string }).text
    // 3 real matches; the output also carries 3 context lines and `--` breaks,
    // which must not inflate the count.
    expect(text).toContain('Matches: 3 across 1 file')
    expect(text).not.toContain('Matches: 8')
  })

  it('reports an out-of-range offset without claiming no matches', async () => {
    const root = await fixture()
    const result = await executeGrep({
      pattern: '错误',
      path: root,
      output_mode: 'content',
      offset: 1000,
    })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('No results at offset 1000')
    expect(text).toContain('total matches: 3')
    expect(text).not.toContain('No matches found')
  })

  it('includes .h headers in the cpp file type', async () => {
    const root = await fixture()
    await writeFile(path.join(root, 'decl.h'), 'class SeFoo;\n', 'utf8')
    const result = await executeGrep({ pattern: 'SeFoo', path: root, type: 'cpp' })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('decl.h')
  })
})
