import { realpathSync } from 'node:fs'
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import iconv from 'iconv-lite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { configuredRoots, getProjectFileContext, readRegistry } from '../src/core.js'
import { clearEncodingIndexCache, flushEncodingIndex, listIndexedEncodings, refreshEncodingIndex } from '../src/encoding/index.js'
import { INDEX_DIRECTORY, INDEX_FILE } from '../src/encoding/detect.js'
import { fileStateCache } from '../src/filesystem/index.js'
import { executeEdit } from '../src/tools/edit.js'
import { executeGrep } from '../src/tools/grep.js'
import { executeRead } from '../src/tools/read.js'
import { executeWrite } from '../src/tools/write.js'

// These tests must NOT use process.chdir(): vitest runs test files in parallel,
// and process.chdir is process-global, so one file's chdir would corrupt the
// cwd another file's tests rely on (visible on macOS where /tmp is a symlink).
// Instead, every test pins its root via ENCODING_BRIDGE_ROOTS, which is
// process-global too but is always restored per test by afterEach, and each test
// overrides it before touching the tools.
async function project(prefix = 'encoding-mcp-matrix-'): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix))
  process.env.ENCODING_BRIDGE_ROOTS = root
  return root
}

// The tools resolve roots via path.resolve() (configuredRoots), NOT realpath.
// On macOS /var is a symlink to /private/var, so path.resolve() keeps the
// symlink spelling while realpathSync() resolves it. Index reads must use the
// exact root string the tools used to write the index, so return path.resolve().
function realRoot(): string {
  return path.resolve(process.env.ENCODING_BRIDGE_ROOTS ?? process.cwd())
}

async function writeIndex(): Promise<void> {
  await flushEncodingIndex(realRoot())
}

async function indexFiles(): Promise<string[]> {
  await writeIndex()
  return readdir(path.join(realRoot(), INDEX_DIRECTORY))
}

let previousRoots: string | undefined

beforeEach(() => {
  fileStateCache.clear()
  readRegistry.clear()
  clearEncodingIndexCache()
  previousRoots = process.env.ENCODING_BRIDGE_ROOTS
})

afterEach(() => {
  if (previousRoots === undefined) delete process.env.ENCODING_BRIDGE_ROOTS
  else process.env.ENCODING_BRIDGE_ROOTS = previousRoots
})

describe('feature matrix: Read', () => {
  it('reads a UTF-16 file from its BOM', async () => {
    const root = await project()
    const file = path.join(root, 'utf16.txt')
    const le = iconv.encode('你好，UTF16', 'utf16-le')
    await writeFile(file, Buffer.concat([Buffer.from([0xff, 0xfe]), le]))
    const read = await executeRead({ file_path: file })
    const text = (read.content[0] as { text: string }).text
    expect(text).toContain('你好，UTF16')
    expect((read.structuredContent as { file: { encoding: string } }).file.encoding).toBe('utf-16le')
  })

  it('returns a warning for an empty file instead of binary', async () => {
    const root = await project()
    const file = path.join(root, 'empty.txt')
    await writeFile(file, Buffer.alloc(0))
    const read = await executeRead({ file_path: file })
    expect((read.content[0] as { text: string }).text).toContain('empty contents')
  })

  it('returns an empty page when the offset exceeds the file length', async () => {
    const root = await project()
    const file = path.join(root, 'short.txt')
    await writeFile(file, 'a\nb\nc\n', 'utf8')
    const read = await executeRead({ file_path: file, offset: 50, limit: 5 })
    const text = (read.content[0] as { text: string }).text
    expect(text).toContain('offset 50 exceeds file length')
  })

  it('rejects a binary extension instead of decoding it as text', async () => {
    const root = await project()
    const file = path.join(root, 'blob.exe')
    await writeFile(file, Buffer.from([0x4d, 0x5a, 0x00, 0x00, 0x90, 0x00]))
    await expect(executeRead({ file_path: file })).rejects.toThrow(/Cannot read binary file/)
  })
})

describe('feature matrix: Write', () => {
  it('rejects writing an existing file that was not read first', async () => {
    const root = await project()
    const file = path.join(root, 'unread.txt')
    await writeFile(file, 'existing', 'utf8')
    await expect(executeWrite({ file_path: file, content: 'overwrite' }))
      .rejects.toThrow(/has not been read/)
  })
})

describe('feature matrix: Edit', () => {
  it('round-trips a GBK edit as valid GBK bytes', async () => {
    const root = await project()
    const file = path.join(root, 'gbk-roundtrip.txt')
    await writeFile(file, iconv.encode('错误码 123\r\n', 'gbk'))
    await executeRead({ file_path: file })
    await executeEdit({ file_path: file, old_string: '123', new_string: '456' })
    const bytes = await readFile(file)
    expect(iconv.decode(bytes, 'gbk')).toBe('错误码 456\r\n')
    expect(bytes.equals(Buffer.from('错误码 456\r\n', 'utf8'))).toBe(false)
  })
})

describe('feature matrix: Grep', () => {
  it('returns an empty result when the pattern matches nothing', async () => {
    const root = await project()
    await writeFile(path.join(root, 'a.txt'), 'alpha beta\n', 'utf8')
    const result = await executeGrep({ pattern: 'nomatch', path: root })
    expect(result.content[0]).toMatchObject({ type: 'text' })
    expect((result.content[0] as { text: string }).text).toBe('')
    expect(result.structuredContent).toMatchObject({ numFiles: 0, numMatches: 0 })
  })
})

describe('feature matrix: encoding index', () => {
  it('generates the index on first access', async () => {
    const root = await project()
    const file = path.join(root, 'indexed.txt')
    await writeFile(file, iconv.encode('索引测试', 'gbk'))
    await executeRead({ file_path: file })
    await writeIndex()
    const files = await indexFiles()
    expect(files).toContain(INDEX_FILE)
    const document = JSON.parse(await readFile(path.join(realRoot(), INDEX_DIRECTORY, INDEX_FILE), 'utf8'))
    const entry = Object.values(document.files)[0] as { encoding: string }
    expect(['gbk', 'gb18030']).toContain(entry.encoding)
  })

  it('updates the index when a file changes (watch refresh path)', async () => {
    const root = await project()
    const file = path.join(root, 'watched.txt')
    await writeFile(file, iconv.encode('汉字', 'gbk'))
    await executeRead({ file_path: file })
    await writeIndex()
    const before = await listIndexedEncodings(realRoot())
    // The GBK/gb18030 detector is ambiguous for some byte sequences; assert membership.
    expect(['gbk', 'gb18030']).toContain([...before.values()][0]?.encoding)

    // Simulate a watcher event after the file's bytes change on disk.
    await writeFile(file, 'plain utf8 text\n', 'utf8')
    const info = await stat(file)
    await refreshEncodingIndex(realRoot(), file)
    await writeIndex()
    const after = await listIndexedEncodings(realRoot())
    expect([...after.values()][0]?.encoding).toBe('utf-8')
    expect(([...after.values()][0]?.size)).toBe(info.size)
  })

  it('re-detects a stale index entry on a later read', async () => {
    const root = await project()
    const file = path.join(root, 'stale.txt')
    await writeFile(file, iconv.encode('旧', 'gbk'))
    await executeRead({ file_path: file })
    await writeIndex()
    // Overwrite with UTF-8; the index still holds gbk but the bytes changed.
    await writeFile(file, 'new utf8 content\n', 'utf8')
    fileStateCache.clear()
    await executeRead({ file_path: file })
    await writeIndex()
    const after = await listIndexedEncodings(realRoot())
    expect([...after.values()][0]?.encoding).toBe('utf-8')
  })
})

describe('feature matrix: roots', () => {
  it('resolves a single-folder workspace to the process cwd', async () => {
    const root = await project()
    const file = path.join(root, 'single.txt')
    await writeFile(file, 'x\n', 'utf8')
    const context = await getProjectFileContext(file)
    expect(realpathSync(context.root)).toBe(realpathSync(realRoot()))
  })

  it('resolves a multi-root workspace to the deepest configured root', async () => {
    const root = await project()
    const outer = path.join(root, 'outer')
    const inner = path.join(root, 'outer', 'inner')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(inner, { recursive: true })
    process.env.ENCODING_BRIDGE_ROOTS = `${outer}${path.delimiter}${inner}`
    const file = path.join(inner, 'deep.txt')
    await writeFile(file, 'deep\n', 'utf8')
    const context = await getProjectFileContext(file)
    expect(realpathSync(context.root)).toBe(realpathSync(inner))
  })

  it('auto-registers a root for a file outside every configured root', async () => {
    const root = await project()
    const outside = await mkdtemp(path.join(tmpdir(), 'encoding-mcp-outside-'))
    const file = path.join(outside, 'ext.txt')
    await writeFile(file, 'out\n', 'utf8')
    delete process.env.ENCODING_BRIDGE_ROOTS
    const context = await getProjectFileContext(file)
    expect(realpathSync(context.root)).toBe(realpathSync(outside))
    expect(configuredRoots().map(item => realpathSync(item))).toContain(realpathSync(outside))
  })
})
