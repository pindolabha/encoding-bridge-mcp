import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { inspectProjectPath } from "./path.js";

export interface FileVersion {
  mtimeMs: number;
  size: number;
  hash: string;
}

export interface BufferReadState extends FileVersion {
  buffer: Buffer;
  partial: boolean;
  offset: number;
  totalSize: number;
}

export interface ReadBufferOptions {
  offset?: number;
  length?: number;
  /** Skip the full-file sha256. Safe for read-only paths that only need a change
   * signature for "unchanged" checks; mtime+size are compared instead. Write
   * paths that must guard against external mutation keep the hash. */
  skipHash?: boolean;
}

function digest(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/**
 * Read a file and describe what was read: the selected byte range, the file's
 * total size, and mtime/size/hash for change checks.
 *
 * Despite the historical name, nothing is cached here — every call hits the
 * disk. That is deliberate: the freshness guarantees elsewhere (the read
 * registry, the atomic-write expected check, the encoding index) all compare
 * against values captured at their own read time, so a cached answer would
 * defeat them. Change detection that only needs metadata uses `stat` directly.
 */
export async function readFileState(root: string, input: string, options: ReadBufferOptions = {}): Promise<BufferReadState> {
  const safe = await inspectProjectPath(root, input);
  const info = await stat(safe.target);
  const buffer = await readFile(safe.target);
  const offset = options.offset ?? 0;
  const length = options.length ?? buffer.length - offset;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 0) {
    throw new Error("offset and length must be non-negative safe integers");
  }
  const end = Math.min(buffer.length, offset + length);
  const selectedBuffer = Buffer.from(buffer.subarray(Math.min(offset, buffer.length), end));
  return {
    buffer: selectedBuffer,
    partial: offset !== 0 || end !== buffer.length,
    offset,
    totalSize: buffer.length,
    mtimeMs: info.mtimeMs,
    size: buffer.length,
    hash: options.skipHash ? "" : digest(buffer),
  };
}
