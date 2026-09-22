import { open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileStateCache, type FileVersion } from "./cache.js";
import { pathMutex } from "./mutex.js";
import { inspectProjectPath } from "./path.js";

export interface AtomicWriteOptions {
  mode?: number;
  expected?: Pick<FileVersion, "mtimeMs" | "hash">;
}

function temporaryName(target: string, suffix: string): string {
  return path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${Math.random().toString(16).slice(2)}.${suffix}`);
}

async function replaceFile(temp: string, target: string): Promise<void> {
  const attempts = process.platform === "win32" ? 4 : 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await rename(temp, target);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code;
      if (process.platform !== "win32" || (code !== "EPERM" && code !== "EACCES" && code !== "EEXIST")) {
        throw error;
      }
      if (attempt + 1 < attempts) {
        await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }
  throw lastError;
}

export async function atomicWriteBuffer(
  root: string,
  input: string,
  buffer: Buffer,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const initial = await inspectProjectPath(root, input, true);
  const key = process.platform === "win32" ? initial.target.toLowerCase() : initial.target;
  await pathMutex.runExclusive(key, async () => {
    if (options.expected) {
      try {
        const info = await stat(initial.target);
        if (info.mtimeMs !== options.expected.mtimeMs) {
          const current = await fileStateCache.read(root, input);
          if (current.hash !== options.expected.hash) throw new Error(`File changed since it was read: ${input}`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    let mode = options.mode ?? 0o666;
    const temp = temporaryName(initial.target, "tmp");
    let handle;
    try {
      handle = await open(temp, "wx", mode);
      await handle.writeFile(buffer);
      await handle.close();
      handle = undefined;
      await replaceFile(temp, initial.target);
      fileStateCache.clear(initial.target);
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  });
}
