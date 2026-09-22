const BYTES_PER_MEBIBYTE = 1024 * 1024
const DEFAULT_MAX_READ_OUTPUT_TOKENS = 25_000

const DEFAULT_GREP_MAX_SCAN_BYTES = 256 * BYTES_PER_MEBIBYTE
const DEFAULT_GREP_MAX_FILES = 10_000
const DEFAULT_GREP_MAX_DURATION_MS = 30_000
const DEFAULT_GREP_MAX_LINE_CHARS = 16 * BYTES_PER_MEBIBYTE
const DEFAULT_GREP_MAX_CONTEXT_LINES = 10_000
const DEFAULT_GREP_MAX_ONLY_MATCHES = 100_000

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function configuredPositiveInteger(name: string, fallback: number): number {
  const value = process.env[name]
  if (value === undefined) return fallback
  const parsed = parsePositiveInteger(value)
  if (parsed === undefined) {
    throw new Error(`${name} must be a positive safe integer when set`)
  }
  return parsed
}

export interface GrepLimits {
  maxScanBytes: number
  maxFiles: number
  maxDurationMs: number
  maxLineChars: number
  maxContextLines: number
  maxOnlyMatches: number
}

export function grepLimits(): GrepLimits {
  return {
    maxScanBytes: configuredPositiveInteger('ENCODING_BRIDGE_MAX_GREP_SCAN_BYTES', DEFAULT_GREP_MAX_SCAN_BYTES),
    maxFiles: configuredPositiveInteger('ENCODING_BRIDGE_MAX_GREP_FILES', DEFAULT_GREP_MAX_FILES),
    maxDurationMs: configuredPositiveInteger('ENCODING_BRIDGE_MAX_GREP_DURATION_MS', DEFAULT_GREP_MAX_DURATION_MS),
    maxLineChars: configuredPositiveInteger('ENCODING_BRIDGE_MAX_GREP_LINE_CHARS', DEFAULT_GREP_MAX_LINE_CHARS),
    maxContextLines: configuredPositiveInteger('ENCODING_BRIDGE_MAX_GREP_CONTEXT_LINES', DEFAULT_GREP_MAX_CONTEXT_LINES),
    maxOnlyMatches: configuredPositiveInteger('ENCODING_BRIDGE_MAX_GREP_ONLY_MATCHES', DEFAULT_GREP_MAX_ONLY_MATCHES),
  }
}

/**
 * Rough token estimate for decoded text, mirroring Claude's Read tool: JSON
 * ~2 chars/token, everything else ~4 chars/token. Guards against sending more
 * output than fits comfortably in context. Read is chunked (readDecodedRange),
 * so no byte-size cap is needed to protect memory.
 */
export function maxReadOutputTokens(): number {
  return configuredPositiveInteger(
    'ENCODING_BRIDGE_MAX_READ_OUTPUT_TOKENS',
    DEFAULT_MAX_READ_OUTPUT_TOKENS,
  )
}

export function estimateTextTokens(text: string, fileExtension: string): number {
  const bytesPerToken = fileExtension === 'json' || fileExtension === 'jsonl' || fileExtension === 'jsonc'
    ? 2
    : 4
  return Math.round(text.length / bytesPerToken)
}

export function formatMebibytes(bytes: number): string {
  return `${bytes / BYTES_PER_MEBIBYTE} MiB`
}
