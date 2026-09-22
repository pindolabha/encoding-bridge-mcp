import { lstat, readlink, realpath } from "node:fs/promises";
import path from "node:path";

export interface SafePath {
  root: string;
  path: string;
  target: string;
  symbolicLink: boolean;
}

function containsNul(value: string): boolean {
  return value.includes("\0");
}

function isUnc(value: string): boolean {
  return /^[/\\]{2}/.test(value) || /^\\\\[?.]\\/.test(value);
}

export function isPathWithin(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export function resolveProjectPath(root: string, input: string): string {
  if (containsNul(root) || containsNul(input)) throw new Error("Paths must not contain NUL bytes");
  if (isUnc(root) || isUnc(input)) throw new Error("UNC and device paths are not allowed");
  const absoluteRoot = path.resolve(root);
  if (path.isAbsolute(input)) return path.resolve(input);
  const candidate = path.resolve(absoluteRoot, input);
  if (!isPathWithin(candidate, absoluteRoot)) throw new Error(`Path is outside project root: ${input}`);
  return candidate;
}

const realpathCache = new Map<string, string>();

async function cachedRealpath(value: string): Promise<string> {
  const resolved = path.resolve(value);
  const cached = realpathCache.get(resolved);
  if (cached !== undefined) return cached;
  const actual = await realpath(resolved);
  realpathCache.set(resolved, actual);
  realpathCache.set(actual, actual);
  return actual;
}

export async function inspectProjectPath(root: string, input: string, allowMissing = false): Promise<SafePath> {
  const absoluteRoot = await cachedRealpath(root);
  const candidate = path.isAbsolute(input)
    ? path.resolve(input)
    : resolveProjectPath(absoluteRoot, input);
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) {
      const link = await readlink(candidate);
      const target = await realpath(path.resolve(path.dirname(candidate), link));
      if (!isPathWithin(target, absoluteRoot)) throw new Error(`Symbolic link escapes project root: ${input}`);
      return { root: absoluteRoot, path: candidate, target, symbolicLink: true };
    }
    const target = await cachedRealpath(candidate);
    if (!isPathWithin(target, absoluteRoot)) throw new Error(`Path escapes project root: ${input}`);
    return { root: absoluteRoot, path: candidate, target, symbolicLink: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!allowMissing || code !== "ENOENT") throw error;
    const parent = await cachedRealpath(path.dirname(candidate));
    if (!isPathWithin(parent, absoluteRoot)) throw new Error(`Parent escapes project root: ${input}`);
    return { root: absoluteRoot, path: candidate, target: candidate, symbolicLink: false };
  }
}
