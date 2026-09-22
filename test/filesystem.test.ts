import { chmod, lstat, mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PathMutex,
  atomicWriteBuffer,
  fileStateCache,
  inspectProjectPath,
  resolveProjectPath,
} from "../src/filesystem/index.js";

async function fixture(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "filesystem-"));
}

// Symlinks need developer mode / admin rights on Windows. Return false when the
// platform cannot create them so the caller can skip symlink-dependent tests.
async function canCreateSymlink(): Promise<boolean> {
  const root = await fixture();
  const target = path.join(root, "t");
  const link = path.join(root, "l");
  await writeFile(target, "x");
  try {
    await symlink(target, link, "file");
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") return false;
    throw err;
  }
}

describe("safe project paths", () => {
  it("rejects traversal, NUL and UNC paths", async () => {
    const root = await fixture();
    expect(() => resolveProjectPath(root, "../outside")).toThrow(/outside project root/);
    expect(() => resolveProjectPath(root, "bad\0name")).toThrow(/NUL/);
    expect(() => resolveProjectPath(root, "\\\\server\\share\\file")).toThrow(/UNC/);
  });

  it("accepts absolute paths inside the root after normalization", async () => {
    const root = await fixture();
    const target = path.join(root, 'nested', 'file.txt');
    expect(resolveProjectPath(root, target)).toBe(target);
  });

  it("rejects symlinks escaping the project root", async (ctx) => {
    if (!(await canCreateSymlink())) return ctx.skip();
    const root = await fixture();
    const outside = await fixture();
    await writeFile(path.join(outside, "secret.txt"), "secret");
    const link = path.join(root, "link.txt");
    await symlink(path.join(outside, "secret.txt"), link, "file");
    await expect(inspectProjectPath(root, link)).rejects.toThrow(/escapes project root/);
  });
});

describe("file state and atomic writes", () => {
  it("caches a complete read while returning partial slices and version state", async () => {
    const root = await fixture();
    const file = path.join(root, "data.bin");
    await writeFile(file, Buffer.from("abcdef"));
    const partial = await fileStateCache.read(root, file, { offset: 2, length: 2 });
    const whole = await fileStateCache.read(root, file);
    expect(partial.buffer.toString()).toBe("cd");
    expect(partial).toMatchObject({ partial: true, offset: 2, totalSize: 6 });
    expect(partial.hash).toBe(whole.hash);
    expect(whole.partial).toBe(false);
  });

  it("serializes operations by path", async () => {
    const mutex = new PathMutex();
    const order: number[] = [];
    const first = mutex.runExclusive("same", async () => {
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(2);
    });
    const second = mutex.runExclusive("same", async () => {
      order.push(3);
    });
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("atomically replaces a buffer, preserves mode, and detects stale state", async () => {
    const root = await fixture();
    const file = path.join(root, "data.bin");
    await writeFile(file, "old");
    if (process.platform !== "win32") await chmod(file, 0o640);
    const before = await fileStateCache.read(root, file);
    await atomicWriteBuffer(root, file, Buffer.from("new"), { expected: before });
    expect(await readFile(file, "utf8")).toBe("new");
    if (process.platform !== "win32") expect((await stat(file)).mode & 0o777).toBe(0o640);
    await expect(atomicWriteBuffer(root, file, Buffer.from("bad"), { expected: before })).rejects.toThrow(/changed/);
  });

  it("preserves a symlink while replacing its target", async (ctx) => {
    if (!(await canCreateSymlink())) return ctx.skip();
    const root = await fixture();
    const directory = path.join(root, "real");
    await mkdir(directory);
    const target = path.join(directory, "target.txt");
    const link = path.join(root, "link.txt");
    await writeFile(target, "old");
    await symlink(target, link, "file");
    await atomicWriteBuffer(root, link, Buffer.from("new"));
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(target, "utf8")).toBe("new");
  });
});
