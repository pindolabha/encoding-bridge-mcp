import iconv from 'iconv-lite'

import { decodeText, detectBom, normalizeEncoding } from './codec.js'

export const INDEX_DIRECTORY = '.encoding-bridge'
export const INDEX_FILE = 'encoding-index.json'

export const SOURCE_EXTENSIONS = new Set([
  '.bat', '.c', '.cc', '.cfg', '.cmd', '.cpp', '.cs', '.css', '.cxx', '.go',
  '.h', '.hh', '.hpp', '.htm', '.html', '.inc', '.ini', '.inl', '.java', '.js',
  '.json', '.jsx', '.lua', '.m', '.md', '.mjs', '.php', '.pl', '.py', '.rc',
  '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
])

export const IGNORED_DIRECTORY_NAMES = new Set([
  '.encoding-bridge', '.git', '.svn', '.hg', 'dist', 'node_modules',
  'FileLog', 'Log', 'SqlLog', 'Obj', 'obj',
])

const DEFAULT_LEGACY_CANDIDATES = [
  'gb18030',
  'gbk',
  'big5',
  'shift_jis',
  'euc-kr',
  'windows-1252',
  'windows-1251',
  'windows-1250',
] as const

const RIPGREP_ENCODINGS = new Set([
  'utf-8', 'utf-16le', 'utf-16be',
  'gbk', 'gb18030', 'big5', 'euc-jp', 'euc-kr', 'shift_jis', 'iso-2022-jp',
  'koi8-r', 'koi8-u',
  'windows-1250', 'windows-1251', 'windows-1252', 'windows-1253', 'windows-1254',
  'windows-1255', 'windows-1256', 'windows-1257', 'windows-1258',
  'iso-8859-1', 'iso-8859-2', 'iso-8859-3', 'iso-8859-4', 'iso-8859-5',
  'iso-8859-6', 'iso-8859-7', 'iso-8859-8', 'iso-8859-10', 'iso-8859-13',
  'iso-8859-14', 'iso-8859-15', 'iso-8859-16',
])

export type DetectedKind = 'text' | 'binary' | 'empty'

export interface DetectedEncoding {
  kind: DetectedKind
  encoding?: string
  bom?: 'utf-8' | 'utf-16le' | 'utf-16be'
}

function isStrictUtf8(buffer: Buffer): boolean {
  try {
    decodeText(buffer, 'utf-8')
    return true
  } catch {
    return false
  }
}

function tryDecode(buffer: Buffer, encoding: string): string | undefined {
  try {
    return decodeText(buffer, encoding).text
  } catch {
    if (!iconv.encodingExists(encoding)) return undefined
    try {
      const text = iconv.decode(buffer, encoding)
      const roundTrip = iconv.encode(text, encoding)
      if (roundTrip.length !== buffer.length && !buffer.equals(roundTrip.subarray(0, buffer.length))) {
        return undefined
      }
      return text
    } catch {
      return undefined
    }
  }
}

function scoreText(text: string): number {
  let nonAscii = 0
  let cjk = 0
  let replacement = 0
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0
    if (code === 0xfffd) replacement += 1
    if (code > 127) nonAscii += 1
    if (
      (code >= 0x4e00 && code <= 0x9fff)
      || (code >= 0x3040 && code <= 0x30ff)
      || (code >= 0xac00 && code <= 0xd7af)
    ) {
      cjk += 1
    }
  }
  return cjk * 8 + nonAscii - replacement * 50
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192))
  return sample.includes(0)
}

function uniqueEncodings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    let encoding: string
    try {
      encoding = normalizeEncoding(value)
    } catch {
      continue
    }
    if (encoding === 'utf-8' || seen.has(encoding)) continue
    seen.add(encoding)
    result.push(encoding)
  }
  return result
}

export function detectEncodingFromBytes(buffer: Buffer, preferred: readonly string[] = []): DetectedEncoding {
  if (buffer.length === 0) return { kind: 'empty', encoding: 'utf-8' }

  const [bom] = detectBom(buffer)
  if (bom === 'utf-16le' || bom === 'utf-16be') {
    return { kind: 'text', encoding: bom, bom }
  }
  if (bom === 'utf-8' || isStrictUtf8(buffer)) {
    return { kind: 'text', encoding: 'utf-8', ...(bom === 'utf-8' ? { bom: 'utf-8' as const } : {}) }
  }
  if (looksBinary(buffer)) return { kind: 'binary' }

  const candidates = uniqueEncodings([...preferred, ...DEFAULT_LEGACY_CANDIDATES])
  let best: { encoding: string; score: number } | undefined
  for (const encoding of candidates) {
    const text = tryDecode(buffer, encoding)
    if (text === undefined) continue
    const scored = scoreText(text)
    if (best === undefined || scored > best.score) best = { encoding, score: scored }
  }
  if (best === undefined) return { kind: 'binary' }
  return { kind: 'text', encoding: best.encoding }
}

export function ripgrepEncodingLabel(encoding: string): string | undefined {
  const normalized = normalizeEncoding(encoding)
  if (RIPGREP_ENCODINGS.has(normalized)) return normalized
  if (normalized === 'utf-16le') return 'utf-16le'
  if (normalized === 'utf-16be') return 'utf-16be'
  return undefined
}

export function isSourceFileName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return false
  return SOURCE_EXTENSIONS.has(name.slice(dot).toLowerCase())
}

export function shouldIgnoreDirectoryName(name: string): boolean {
  return IGNORED_DIRECTORY_NAMES.has(name)
}
