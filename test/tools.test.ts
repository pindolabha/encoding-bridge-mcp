import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import iconv from 'iconv-lite'
import { beforeEach, describe, expect, it } from 'vitest'

import { fileStateCache } from '../src/filesystem/index.js'
import { readRegistry } from '../src/core.js'
import { executeEdit } from '../src/tools/edit.js'
import { executeRead } from '../src/tools/read.js'
import { executeWrite } from '../src/tools/write.js'

async function project(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'encoding-mcp-tools-'))
  // The index root is process.cwd() (VS Code working directory), so switch the
  // test process cwd into the temp dir so the fixture files live inside it.
  process.chdir(root)
  return root
}

beforeEach(() => {
  fileStateCache.clear()
})

describe('encoding-transparent text tools', () => {
  it('reads, edits, and writes UTF-8 files without encoding rules', async () => {
    const root = await project()
    const file = path.join(root, 'plain.txt')
    await writeFile(file, 'before\nline', 'utf8')
    await executeRead({ file_path: file })
    await executeEdit({ file_path: file, old_string: 'before', new_string: 'after' })
    await executeWrite({ file_path: file, content: 'rewritten' })
    expect(await readFile(file, 'utf8')).toBe('rewritten')
  })

  it('reads GBK as Unicode and edits back to GBK bytes', async () => {
    const root = await project()
    const file = path.join(root, 'hello.txt')
    await writeFile(file, iconv.encode('你好，世界\r\n第二行\r\n', 'gbk'))

    const read = await executeRead({ file_path: file })
    expect(read.content[0]).toMatchObject({ type: 'text' })
    expect((read.content[0] as { text: string }).text).toContain('你好，世界')

    await executeEdit({ file_path: file, old_string: '世界', new_string: '朋友' })
    const bytes = await readFile(file)
    expect(iconv.decode(bytes, 'gbk')).toBe('你好，朋友\r\n第二行\r\n')
    expect(bytes.equals(Buffer.from('你好，朋友\r\n第二行\r\n', 'utf8'))).toBe(false)
  })

  it('writes an existing GBK file back in GBK', async () => {
    const root = await project()
    const file = path.join(root, 'rewrite.txt')
    await writeFile(file, iconv.encode('原内容', 'gbk'))
    await executeRead({ file_path: file })
    await executeWrite({ file_path: file, content: '完整重写' })
    expect(iconv.decode(await readFile(file), 'gbk')).toBe('完整重写')
  })

  it('creates new files as UTF-8 by default', async () => {
    const root = await project()
    const file = path.join(root, 'new.txt')
    await executeWrite({ file_path: file, content: '新文件' })
    expect(await readFile(file, 'utf8')).toBe('新文件')
  })

  it('allows a large-file edit after reading only the target line', async () => {
    const root = await project()
    const file = path.join(root, 'target-only.txt')
    const lines = Array.from({ length: 1000 }, (_, index) => index === 749 ? 'UNIQUE_TARGET' : `line-${index + 1}`)
    await writeFile(file, iconv.encode(lines.join('\n'), 'gbk'))
    await executeRead({ file_path: file, offset: 750, limit: 1 })
    await executeEdit({ file_path: file, old_string: 'UNIQUE_TARGET', new_string: 'UPDATED_TARGET' })
    expect(iconv.decode(await readFile(file), 'gbk')).toContain('UPDATED_TARGET')
  })

  it('edits a large file without reading the target line once the encoding is indexed', async () => {
    const root = await project()
    const file = path.join(root, 'unread-target.txt')
    await writeFile(file, iconv.encode('one\ntwo\nTARGET\nfour', 'gbk'))
    // Reading any range records the encoding in the index; after that the file
    // is "known" and edits behave like the built-in tools (no read requirement).
    await executeRead({ file_path: file, offset: 1, limit: 2 })
    await executeEdit({ file_path: file, old_string: 'TARGET', new_string: 'updated' })
    expect(iconv.decode(await readFile(file), 'gbk')).toBe('one\ntwo\nupdated\nfour')
  })

  it('edits every replace-all target once the encoding is indexed', async () => {
    const root = await project()
    const file = path.join(root, 'replace-all-ranges.txt')
    await writeFile(file, iconv.encode('MARK\nother\nMARK', 'gbk'))
    await executeRead({ file_path: file, offset: 1, limit: 1 })
    await executeEdit({ file_path: file, old_string: 'MARK', new_string: 'DONE', replace_all: true })
    expect(iconv.decode(await readFile(file), 'gbk')).toBe('DONE\nother\nDONE')
  })
  it('edits a file after a partial read once the encoding is indexed', async () => {
    const root = await project()
    const file = path.join(root, 'segmented.txt')
    await writeFile(file, iconv.encode('line1\nline2\nline3\nline4\nline5', 'gbk'))
    await executeRead({ file_path: file, offset: 1, limit: 2 })
    await executeEdit({ file_path: file, old_string: 'line5', new_string: 'updated' })
    expect(iconv.decode(await readFile(file), 'gbk')).toContain('updated')
  })

  it('merges out-of-order and overlapping read ranges', async () => {
    const root = await project()
    const file = path.join(root, 'ranges.txt')
    await writeFile(file, iconv.encode('one\ntwo\nthree\nfour\nfive\nsix', 'gbk'))
    await executeRead({ file_path: file, offset: 5, limit: 2 })
    await executeRead({ file_path: file, offset: 2, limit: 4 })
    await executeRead({ file_path: file, offset: 1, limit: 1 })
    await executeEdit({ file_path: file, old_string: 'six', new_string: 'SIX' })
    expect(iconv.decode(await readFile(file), 'gbk')).toContain('SIX')
  })

  it('merges concurrently completed read ranges in the shared registry', async () => {
    const root = await project()
    const file = path.join(root, 'parallel.txt')
    await writeFile(file, iconv.encode('a\nb\nc\nd\ne\nf', 'gbk'))
    await Promise.all([
      executeRead({ file_path: file, offset: 1, limit: 2 }),
      executeRead({ file_path: file, offset: 3, limit: 2 }),
      executeRead({ file_path: file, offset: 5, limit: 2 }),
    ])
    await executeEdit({ file_path: file, old_string: 'f', new_string: 'F' })
    expect(iconv.decode(await readFile(file), 'gbk')).toContain('F')
  })

  it('edits after re-reading a file that changed externally', async () => {
    const root = await project()
    const file = path.join(root, 'versioned-ranges.txt')
    await writeFile(file, iconv.encode('a\nb\nc\nd', 'gbk'))
    await executeRead({ file_path: file, offset: 1, limit: 2 })
    await writeFile(file, iconv.encode('x\ny\nz\nw', 'gbk'))
    fileStateCache.clear()
    // Re-reading the changed file records the new version; with the encoding
    // indexed, an edit then succeeds like the built-in tools.
    await executeRead({ file_path: file, offset: 3, limit: 2 })
    await executeEdit({ file_path: file, old_string: 'x', new_string: 'X' })
    expect(iconv.decode(await readFile(file), 'gbk')).toBe('X\ny\nz\nw')
  })
  it('allows editing a target that was included in a partial read', async () => {
    const root = await project()
    const file = path.join(root, 'partial.txt')
    await writeFile(file, iconv.encode('第一行\n第二行\n第三行', 'gbk'))
    await executeRead({ file_path: file, offset: 2, limit: 1 })
    await executeEdit({ file_path: file, old_string: '第二行', new_string: '修改' })
    expect(iconv.decode(await readFile(file), 'gbk')).toContain('修改')
  })

  it('matches old_string despite alignment-tab differences', async () => {
    const root = await project()
    const file = path.join(root, 'tab-align.txt')
    // File uses tabs to align the trailing comment; the old_string below uses
    // a single space (a model miscounting the tabs would write this).
    await writeFile(file, 'void AddHuang2AllCorpScore(DWord dwScore);\t\t\t// 增加皇城战2所有军团军勋\nprivate:\n', 'utf8')
    await executeRead({ file_path: file })
    await executeEdit({
      file_path: file,
      old_string: 'void AddHuang2AllCorpScore(DWord dwScore); // 增加皇城战2所有军团军勋\nprivate:',
      new_string: 'void AddHuang2AllCorpScore(DWord dwScore);\t\t\t// 增加皇城战2所有军团军勋\n\tbool IsHuang2CityBelongJun(DWord dwCityID); // 城池是否属于郡线（太守线）\nprivate:',
    })
    const text = await readFile(file, 'utf8')
    expect(text).toContain('bool IsHuang2CityBelongJun(DWord dwCityID);')
    expect(text).toContain('// 城池是否属于郡线（太守线）')
  })

  it('rejects an edit whose old_string is ambiguous across whitespace variants', async () => {
    const root = await project()
    const file = path.join(root, 'tab-ambig.txt')
    // Two occurrences with identical normalized text (same content, only the
    // alignment whitespace differs). The old_string normalizes to both, so
    // without replace_all it must be rejected as ambiguous.
    await writeFile(file, 'A;\t\t// 甲\nA;\t// 甲\n', 'utf8')
    await executeRead({ file_path: file })
    await expect(executeEdit({ file_path: file, old_string: 'A; // 甲', new_string: 'B; // 甲' }))
      .rejects.toThrow(/more surrounding context/)
  })

  it('rejects stale writes after an external modification', async () => {
    const root = await project()
    const file = path.join(root, 'stale.txt')
    await writeFile(file, iconv.encode('初始', 'gbk'))
    await executeRead({ file_path: file })
    await writeFile(file, iconv.encode('外部修改', 'gbk'))
    fileStateCache.clear()
    await expect(executeWrite({ file_path: file, content: '覆盖' }))
      .rejects.toThrow(/unexpectedly modified/)
  })

  it('rejects Notebook ranges and Notebook editing', async () => {
    const root = await project()
    const file = path.join(root, 'BOOK.IPYNB')
    await writeFile(file, iconv.encode(JSON.stringify({ cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 }), 'gbk'))
    await expect(executeRead({ file_path: file, offset: 1, limit: 1 }))
      .rejects.toThrow(/not supported for Jupyter notebooks/)
    await executeRead({ file_path: file })
    await expect(executeEdit({ file_path: file, old_string: 'cells', new_string: 'items' }))
      .rejects.toThrow(/not supported/)
  })

  it('reads a few lines of a large file without a byte-size cap (chunked)', async () => {
    const root = await project()
    const file = path.join(root, 'chunked.txt')
    // A file over the 10 MB streaming threshold; only line 1 is read, proving
    // the reader decodes just the selected range rather than the whole file.
    const line1 = 'line1'
    const filler = 'x'.repeat(11 * 1024 * 1024) // ~11 MiB of one line
    await writeFile(file, Buffer.from(`${line1}\n${filler}\nlast`))
    const read = await executeRead({ file_path: file, offset: 1, limit: 1 })
    const text = (read.content[0] as { text: string }).text
    expect(text).toContain('line1')
    expect(text).not.toContain('last')
  })

  it('reads a large GBK file by range with correct offset', async () => {
    const root = await project()
    const file = path.join(root, 'large-range.txt')
    const lines = Array.from({ length: 5000 }, (_, i) => `第${i}行 content`)
    await writeFile(file, iconv.encode(lines.join('\n'), 'gbk'))
    const read = await executeRead({ file_path: file, offset: 1000, limit: 2 })
    const text = (read.content[0] as { text: string }).text
    expect(text).toContain('第999行')
    expect(text).toContain('第1000行')
  })

  it('rejects UNC paths before project discovery', async () => {
    await expect(executeRead({ file_path: '\\\\attacker.invalid\\share\\file.txt' }))
      .rejects.toThrow(/UNC and device paths are not allowed/)
  })

  it('detects external changes even when size and mtime are restored', async () => {
    const root = await project()
    const file = path.join(root, 'same-version.txt')
    await writeFile(file, Buffer.from('AAAA'))
    await executeRead({ file_path: file })
    const original = await stat(file)
    await writeFile(file, Buffer.from('BBBB'))
    const { utimes } = await import('node:fs/promises')
    await utimes(file, original.atime, original.mtime)
    await expect(executeWrite({ file_path: file, content: 'CCCC' }))
      .rejects.toThrow(/unexpectedly modified/)
    expect(await readFile(file, 'utf8')).toBe('BBBB')
  })

  it('rejects ambiguous normalized quote matches and replaces all variants', async () => {
    const root = await project()
    const file = path.join(root, 'quotes.txt')
    await writeFile(file, '‘x’ / ’x‘', 'utf8')
    await executeRead({ file_path: file })
    await expect(executeEdit({ file_path: file, old_string: "'x'", new_string: 'Y' }))
      .rejects.toThrow(/Found 2 matches/)
    await executeEdit({ file_path: file, old_string: "'x'", new_string: 'Y', replace_all: true })
    expect(await readFile(file, 'utf8')).toBe('Y / Y')
  })

  it('rejects characters not representable in the configured encoding', async () => {
    const root = await project()
    const file = path.join(root, 'legacy.txt')
    await writeFile(file, iconv.encode('café', 'windows-1252'))
    await executeRead({ file_path: file })
    await expect(executeEdit({ file_path: file, old_string: 'café', new_string: '汉字' }))
      .rejects.toThrow(/not representable/)
    expect(iconv.decode(await readFile(file), 'windows-1252')).toBe('café')
  })
})
