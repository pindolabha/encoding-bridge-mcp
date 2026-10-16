import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import iconv from 'iconv-lite'
import { afterEach, describe, expect, it } from 'vitest'

import { clearEncodingIndexCache, flushEncodingIndex } from '../src/encoding/index.js'
import { executeGrep } from '../src/tools/grep.js'
import { runRipgrep } from '../src/tools/ripgrep.js'

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

  // rg drops the `file:` prefix when it is handed exactly one file. Both paths
  // that can hand it a single file are covered here: a file path argument, and
  // an encoding group that happens to contain one file.
  it('keeps the filename for a single-file path argument', async () => {
    const root = await fixture()
    const file = path.join(root, 'note.md')
    const content = await executeGrep({ pattern: 'here', path: file, output_mode: 'content' })
    const contentText = (content.content[0] as { text: string }).text
    expect(contentText).toContain('Matches: 1 across 1 file')
    expect(contentText).toMatch(/note\.md:2:.*also here/)
    expect(contentText).toMatch(/Files \(1\):\s*\n\s+- \S*note\.md/)

    const counts = await executeGrep({ pattern: 'here', path: file, output_mode: 'count' })
    const countText = (counts.content[0] as { text: string }).text
    // A bare `1` here used to be counted as zero files with zero matches.
    expect(countText).toContain('Matches: 1 across 1 file')
    expect(countText).toMatch(/note\.md:1/)
  })

  it('does not read a context line as a filename on a single-file target', async () => {
    const root = await fixture()
    const file = path.join(root, 'context.txt')
    await writeFile(file, 'alpha\nbeta\nalpha\n', 'utf8')
    const result = await executeGrep({ pattern: 'alpha', path: file, output_mode: 'content', '-C': 1 })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Matches: 2 across 1 file')
    expect(text).toContain('Files (1):')
    // Without the prefix, `2-beta` is read as a file named "2".
    expect(text).not.toMatch(/\n\s+- 2\b/)
    expect(text).toContain('context.txt')
  })

  it('keeps the filename when an encoding group holds a single file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'encoding-grep-single-group-'))
    process.env.ENCODING_BRIDGE_ROOTS = root
    process.chdir(root)
    // One GBK and one UTF-8 file, so each encoding group holds exactly one file.
    await writeFile(path.join(root, 'gbk.txt'), iconv.encode('唯一命中\n', 'gbk'))
    await writeFile(path.join(root, 'utf8.txt'), '无关内容\n', 'utf8')
    const result = await executeGrep({ pattern: '唯一命中', path: root, output_mode: 'content' })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Matches: 1 across 1 file')
    expect(text).toMatch(/gbk\.txt:1:/)
  })

  it('refuses to start rg once the shared request deadline has passed', async () => {
    const root = await fixture()
    // The single rg call would finish instantly; only the request-wide deadline
    // can stop it, so this fails if the budget is per-call again.
    await expect(runRipgrep({
      pattern: 'x',
      cwd: root,
      target: root,
      outputMode: 'files_with_matches',
      timeoutMs: 30_000,
      deadline: Date.now() - 1,
    })).rejects.toThrow(/timed out after 30000ms/)
  })

  it('returns a match-heavy result set instead of overflowing the stack', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'encoding-grep-many-'))
    process.env.ENCODING_BRIDGE_ROOTS = root
    process.chdir(root)
    // 200k matching lines in one encoding group. Appending rg's output with
    // `push(...lines)` passes each line as a call argument, which overflows the
    // stack at this size — so this fails if either spread is reintroduced.
    await writeFile(path.join(root, 'many.txt'), iconv.encode('中文\n'.repeat(200_000), 'gbk'))
    const result = await executeGrep({ pattern: '中文', path: root, output_mode: 'content' })
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('Matches: 200000 across 1 file')
    expect(text).toContain('output is capped for server stability')
  })

  it('caps the bytes read from rg and never reports a truncated fragment', async () => {
    const root = await fixture()
    const file = path.join(root, 'many.txt')
    // 100k matches is ~1.7 MiB of rg output — over the assertion below, but
    // still under the ~125k lines where a spread would overflow the stack, so
    // this exercises the byte cap and not the stack fix.
    await writeFile(file, 'MARKER '.repeat(100_000))
    process.env.ENCODING_BRIDGE_MAX_GREP_OUTPUT_BYTES = '1000'
    try {
      const { lines } = await runRipgrep({
        pattern: 'MARKER',
        cwd: root,
        files: [file],
        outputMode: 'content',
        onlyMatching: true,
        lineNumbers: true,
        timeoutMs: 30_000,
      })
      const bytes = lines.reduce((total, line) => total + line.length + 1, 0)
      // The cap is 1 KiB; the overshoot is at most one pipe chunk.
      expect(bytes).toBeLessThan(1024 * 1024)
      expect(lines.length).toBeGreaterThan(0)
      // Truncation lands mid-chunk, so the last buffered line can be a fragment.
      // Every line that is reported must still be a complete match.
      for (const line of lines) expect(line.endsWith('MARKER')).toBe(true)
    } finally {
      delete process.env.ENCODING_BRIDGE_MAX_GREP_OUTPUT_BYTES
    }
  })

  it('bounds -o output by match count, which --max-columns cannot', async () => {
    const root = await fixture()
    const file = path.join(root, 'one-line.txt')
    // One 1 MB line of 'x'. Without -o this line is omitted whole (99 bytes,
    // measured); with -o every byte is its own match, and rg measures
    // --max-columns against each match rather than the line, so it emits
    // 1,000,000 lines / ~66 MB. No rg flag bounds that (-m/--max-count counts
    // matching lines, and rg documents that multiple matches in one line count
    // once), so the cap has to be ours.
    await writeFile(file, 'x'.repeat(1024 * 1024))
    process.env.ENCODING_BRIDGE_MAX_GREP_ONLY_MATCHES = '500'
    try {
      const { lines, truncated } = await runRipgrep({
        pattern: 'x',
        cwd: root,
        files: [file],
        outputMode: 'content',
        onlyMatching: true,
        lineNumbers: true,
        timeoutMs: 30_000,
      })
      // While the cap went unread this was 1,000,000. Stopping can overshoot by
      // at most the one chunk that tripped it, so the bound stays generous.
      expect(lines.length).toBeLessThan(50_000)
      expect(lines.length).toBeGreaterThan(0)
      // The caller has to know these lines are a prefix, not the whole match
      // set — that flag is what the Grep header's lower-bound marker rides on.
      expect(truncated).toBe(true)
      // The trailing line is dropped as a possible fragment, so everything kept
      // must still be a complete match.
      for (const line of lines) expect(line.endsWith('x')).toBe(true)
    } finally {
      delete process.env.ENCODING_BRIDGE_MAX_GREP_ONLY_MATCHES
    }
  })

  it('stops rg at the output cap instead of letting it finish', async () => {
    const root = await fixture()
    const file = path.join(root, 'one-line.txt')
    // 10M one-byte lines. Uncapped, `-o` makes every byte its own match line, so
    // rg has ~740 MiB of stdout to write — measured at 2.97 s, all of it inside
    // the request's shared deadline. That is what merely discarding the output
    // costs; killing the child returns in 53 ms.
    //
    // One long line would amplify twice as hard but is useless here: rg cannot
    // print a match before reading the whole line, so a 50 MB single line takes
    // 1.8 s to produce its first byte and the two timings stop separating.
    await writeFile(file, 'x\n'.repeat(10 * 1024 * 1024))
    process.env.ENCODING_BRIDGE_MAX_GREP_OUTPUT_BYTES = '1000'
    try {
      const startedAt = Date.now()
      const { lines, truncated } = await runRipgrep({
        pattern: 'x',
        cwd: root,
        files: [file],
        outputMode: 'content',
        onlyMatching: true,
        lineNumbers: true,
        timeoutMs: 30_000,
      })
      // Tens of ms when the child is killed, seconds when it is not.
      expect(Date.now() - startedAt).toBeLessThan(1000)
      expect(lines.length).toBeGreaterThan(0)
      expect(truncated).toBe(true)
      for (const line of lines) expect(line.endsWith('x')).toBe(true)
    } finally {
      delete process.env.ENCODING_BRIDGE_MAX_GREP_OUTPUT_BYTES
    }
  })

  it('marks the counts as a lower bound when a cap stopped the scan', async () => {
    const root = await fixture()
    const file = path.join(root, 'many.txt')
    // 100k matching lines is ~7.5 MiB of rg output; the cap below cuts the scan
    // short, so the real count (100000) is unreachable — rg was killed and the
    // rest was never written. Before this change the header printed a bare
    // number that varied run to run for the same query (1956 / 2034 / 2112 /
    // 787 for one file at a 20 KB cap) with nothing to mark it as a floor.
    await writeFile(file, 'MARKER abcdefghij\n'.repeat(100_000))
    process.env.ENCODING_BRIDGE_MAX_GREP_OUTPUT_BYTES = '20000'
    try {
      const result = await executeGrep({ pattern: 'MARKER', path: file, output_mode: 'content' })
      const text = (result.content[0] as { text: string }).text
      // `+` on both totals, and the notice that says what it means.
      expect(text).toMatch(/Matches: \d+\+ across \d+\+ file/)
      expect(text).toContain('The scan stopped at the output cap')
      // The reported number really is short of the truth — that is why it is
      // marked rather than simply corrected.
      const reported = Number(/Matches: (\d+)\+/.exec(text)?.[1])
      expect(reported).toBeGreaterThan(0)
      expect(reported).toBeLessThan(100_000)
    } finally {
      delete process.env.ENCODING_BRIDGE_MAX_GREP_OUTPUT_BYTES
    }
  })

  it('leaves the counts unmarked when nothing was capped', async () => {
    const root = await fixture()
    // Guards the marker against firing on ordinary searches: a `+` on a
    // complete result would be its own kind of wrong.
    const result = await executeGrep({ pattern: '错误', path: root, output_mode: 'content' })
    const text = (result.content[0] as { text: string }).text
    expect(text).toMatch(/Matches: \d+ across \d+ file/)
    expect(text).not.toMatch(/Matches: \d+\+/)
    expect(text).not.toContain('stopped at the output cap')
  })
})
