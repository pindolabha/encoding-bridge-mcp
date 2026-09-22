import { open, stat } from 'node:fs/promises'

import { decodeText, normalizeEncoding } from './codec.js'

/**
 * Line-oriented, encoding-aware file reader with two code paths, mirroring
 * Claude's readFileInRange but adapted for legacy encodings (GBK, Big5,
 * Shift-JIS, EUC, windows codepages, UTF-16).
 *
 * Claude splits on '\n' at the string level because it reads UTF-8. Legacy
 * encodings cannot be stream-decoded (variable-width byte boundaries), so we
 * locate line boundaries at the BYTE level and only decode the byte span the
 * requested range needs. `0x0A` is never a byte inside a multi-byte character
 * for any supported encoding, so byte-scanning for `\n` is safe.
 *
 * Fast path (regular files < FAST_PATH_MAX_SIZE): read the whole file into a
 * Buffer and scan for newlines in memory. ~2x faster for typical source files.
 *
 * Streaming path (large files): read the file in chunks, scanning for newlines
 * and accumulating only the byte span inside the requested range. Lines outside
 * the range are counted (for totalLines) but discarded, so reading line 1 of a
 * 100 GB file won't balloon RSS.
 */

const FAST_PATH_MAX_SIZE = 10 * 1024 * 1024 // 10 MB
const STREAM_CHUNK_SIZE = 256 * 1024

export interface ReadRangeResult {
  text: string
  lineCount: number
  totalLines: number
  totalBytes: number
  readBytes: number
  encoding: string
}

type NewlineScanner = (buffer: Buffer, from: number, end: number) => number

function isUtf16(encoding: string): boolean {
  return encoding === 'utf-16le' || encoding === 'utf-16be'
}

function newlineWidth(encoding: string): number {
  return isUtf16(encoding) ? 2 : 1
}

/** Build a newline scanner for the encoding. UTF-16 steps by 2; others scan bytes. */
function makeScanner(encoding: string): NewlineScanner {
  if (isUtf16(encoding)) {
    const lowByte = encoding === 'utf-16le' ? 0x0a : 0x00
    const highByte = encoding === 'utf-16le' ? 0x00 : 0x0a
    return (buffer, from, end) => {
      const start = from % 2 === 0 ? from : from + 1
      for (let i = start; i + 1 < end; i += 2) {
        if (buffer[i] === lowByte && buffer[i + 1] === highByte) return i
      }
      return -1
    }
  }
  return (buffer, from, end) => buffer.indexOf(0x0a, from)
}

function bomOffset(buffer: Buffer, encoding: string): number {
  if (encoding === 'utf-8' && buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 3
  if (encoding === 'utf-16le' && buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 2
  if (encoding === 'utf-16be' && buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 2
  return 0
}

interface ByteSpan {
  startByte: number
  endByte: number
  totalLines: number
  lineCount: number
}

/** Compute the byte span of lines [offset, offset+maxLines) over one buffer. */
function spanInBuffer(
  buffer: Buffer,
  encoding: string,
  contentStart: number,
  offset: number,
  maxLines: number | undefined,
): ByteSpan {
  const scanner = makeScanner(encoding)
  const width = newlineWidth(encoding)
  const endLine = maxLines !== undefined ? offset + maxLines : Infinity
  const len = buffer.length
  let startByte = -1
  let endByte = -1
  let lineIndex = 0
  let from = contentStart

  while (true) {
    const nl = scanner(buffer, from, len)
    const inRange = lineIndex >= offset && lineIndex < endLine
    if (inRange) {
      if (startByte === -1) startByte = from
      // End before the newline: subarray(start, end) excludes the line's own
      // trailing newline, while internal newlines between selected lines are
      // naturally kept. CRLF's 0x0D is included here but stripped at decode.
      endByte = nl === -1 ? len : nl
    }
    lineIndex++
    if (nl === -1) break
    from = nl + width
  }

  return {
    startByte: startByte === -1 ? 0 : startByte,
    endByte: endByte === -1 ? 0 : endByte,
    totalLines: lineIndex,
    lineCount: Math.max(0, Math.min(endLine, lineIndex) - offset),
  }
}

/** Accumulate a growing selected byte span as streaming chunks arrive. */
class StreamingSpanAccumulator {
  private readonly encoding: string
  private readonly width: number
  private readonly scanner: NewlineScanner
  private readonly endLine: number
  private readonly offset: number
  private lineIndex = 0
  private startByte: number | undefined
  private endByte: number | undefined
  private partial: Buffer = Buffer.alloc(0)

  constructor(encoding: string, offset: number, maxLines: number | undefined) {
    this.encoding = encoding
    this.width = newlineWidth(encoding)
    this.scanner = makeScanner(encoding)
    this.offset = offset
    this.endLine = maxLines !== undefined ? offset + maxLines : Infinity
  }

  /** Feed a chunk (already BOM-stripped on the first call). Returns selected bytes appended so far, if any. */
  push(chunk: Buffer): Buffer[] {
    const data = this.partial.length > 0 ? Buffer.concat([this.partial, chunk]) : chunk
    this.partial = Buffer.alloc(0)
    const selectedChunks: Buffer[] = []
    let from = 0
    const len = data.length

    while (true) {
      const nl = this.scanner(data, from, len)
      const inRange = this.lineIndex >= this.offset && this.lineIndex < this.endLine
      if (inRange) {
        const lineEnd = nl === -1 ? len : nl
        if (this.startByte === undefined) this.startByte = from
        // Accumulate up to (excluding) the newline; internal newlines between
        // selected lines are naturally preserved by the next iteration.
        selectedChunks.push(data.subarray(from, lineEnd))
      }
      this.lineIndex++
      if (nl === -1) {
        // Keep the trailing fragment (may be a partial final line).
        this.partial = data.subarray(from)
        break
      }
      from = nl + this.width
    }
    return selectedChunks
  }

  finish(): { bytes: Buffer[]; totalLines: number; lineCount: number; startByte: number; endByte: number } {
    // Flush the retained partial line if it's inside the range.
    const chunks = this.partial.length > 0 && this.lineIndex >= this.offset && this.lineIndex < this.endLine
      ? [this.partial]
      : []
    const totalLines = this.partial.length > 0 ? this.lineIndex + 1 : this.lineIndex
    return {
      bytes: chunks,
      totalLines,
      lineCount: Math.max(0, Math.min(this.endLine, totalLines) - this.offset),
      startByte: this.startByte ?? 0,
      endByte: this.endByte ?? 0,
    }
  }
}

export async function readFileRange(
  filePath: string,
  encoding: string,
  offset: number,
  maxLines?: number,
): Promise<ReadRangeResult> {
  const normalized = normalizeEncoding(encoding)
  const info = await stat(filePath)
  const totalBytes = info.size

  if (info.isFile() && info.size < FAST_PATH_MAX_SIZE) {
    // Fast path: whole file in memory, scan for the selected byte span.
    const { open: openFile } = await import('node:fs/promises')
    const handle = await openFile(filePath, 'r')
    try {
      const buffer = Buffer.alloc(info.size)
      const { bytesRead } = await handle.read(buffer, 0, info.size, 0)
      const content = buffer.subarray(0, bytesRead)
      const start = bomOffset(content, normalized)
      const span = spanInBuffer(content, normalized, start, offset, maxLines)
      const raw = content.subarray(span.startByte, span.endByte)
      // Strip the trailing newline from the span for decoding.
      const rawNoNl = stripTrailingNewline(raw, normalized)
      const text = decodeText(rawNoNl, normalized).text
      return {
        text,
        lineCount: span.lineCount,
        totalLines: span.totalLines,
        totalBytes,
        readBytes: rawNoNl.length,
        encoding: normalized,
      }
    } finally {
      await handle.close()
    }
  }

  // Streaming path for large files.
  const handle = await open(filePath, 'r')
  try {
    const acc = new StreamingSpanAccumulator(normalized, offset, maxLines)
    const chunks: Buffer[] = []
    let remaining = info.size
    let pos = 0
    let first = true
    while (remaining > 0) {
      const toRead = Math.min(STREAM_CHUNK_SIZE, remaining)
      const buf = Buffer.alloc(toRead)
      const { bytesRead } = await handle.read(buf, 0, toRead, pos)
      if (bytesRead <= 0) break
      let chunk = buf.subarray(0, bytesRead)
      if (first) {
        const start = bomOffset(chunk, normalized)
        chunk = chunk.subarray(start)
        first = false
      }
      chunks.push(...acc.push(chunk))
      pos += bytesRead
      remaining -= bytesRead
    }
    const { bytes, totalLines, lineCount } = acc.finish()
    const all = Buffer.concat([...chunks, ...bytes])
    const text = decodeText(all, normalized).text
    return {
      text,
      lineCount,
      totalLines,
      totalBytes,
      readBytes: all.length,
      encoding: normalized,
    }
  } finally {
    await handle.close()
  }
}

function stripTrailingNewline(buffer: Buffer, encoding: string): Buffer {
  if (buffer.length === 0) return buffer
  const width = newlineWidth(encoding)
  if (width === 2) {
    const tail = buffer.subarray(buffer.length - 2)
    if ((tail[0] === 0x0a && tail[1] === 0x00) || (tail[0] === 0x00 && tail[1] === 0x0a)) {
      return buffer.subarray(0, buffer.length - 2)
    }
    return buffer
  }
  // Single/double-byte encodings: strip a trailing LF, plus a preceding CR for
  // CRLF files. 0x0D is never inside a multi-byte character either, so this is
  // safe. Stripping only LF would leave a dangling 0x0D that breaks decode.
  let end = buffer.length
  if (end > 0 && buffer[end - 1] === 0x0a) end -= 1
  if (end > 0 && buffer[end - 1] === 0x0d) end -= 1
  return buffer.subarray(0, end)
}
