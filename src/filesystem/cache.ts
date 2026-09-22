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
}

function digest(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export class FileStateCache {
  clear(_filePath?: string): void {}

  async read(root: string, input: string, options: ReadBufferOptions = {}): Promise<BufferReadState> {
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
      hash: digest(buffer),
    };
  }
}

export const fileStateCache = new FileStateCache();
