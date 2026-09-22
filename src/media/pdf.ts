import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { MediaError } from "./errors.js";
import { imageBytesToBlock } from "./image.js";
import type { McpImageBlock } from "./types.js";

const execFileAsync = promisify(execFile);
export const MAX_PDF_PAGES = 20;
export const MAX_WHOLE_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_EXTRACT_PDF_BYTES = 100 * 1024 * 1024;

export interface CommandResult { stdout: Uint8Array; stderr: Uint8Array; }
export interface PdfDependencies {
  stat(path: string): Promise<{ size: number }>;
  readFile(path: string): Promise<Uint8Array>;
  makeTempDirectory(prefix: string): Promise<string>;
  removeDirectory(path: string): Promise<void>;
  runCommand(command: string, args: readonly string[]): Promise<CommandResult>;
}
export interface ReadPdfOptions { pages?: string; quality?: number; }

const defaultDependencies: PdfDependencies = {
  stat,
  readFile,
  makeTempDirectory: (prefix) => mkdtemp(join(tmpdir(), prefix)),
  removeDirectory: (path) => rm(path, { recursive: true, force: true }),
  async runCommand(command, args) {
    const result = await execFileAsync(command, [...args], { encoding: "buffer", maxBuffer: 10 * 1024 * 1024 });
    return { stdout: result.stdout, stderr: result.stderr };
  },
};

function ascii(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte <= 0x7f ? String.fromCharCode(byte) : "?";
  return result;
}

export function parsePdfPageCount(output: Uint8Array | string): number {
  const text = typeof output === "string" ? output : ascii(output);
  const match = /^Pages:\s*(\d+)\s*$/im.exec(text);
  const count = match?.[1] === undefined ? Number.NaN : Number(match[1]);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new MediaError("INVALID_PDF", "pdfinfo did not report a valid page count");
  }
  return count;
}

export function parsePdfPages(expression: string, pageCount: number, maximum = MAX_PDF_PAGES): number[] {
  const value = expression.trim();
  const match = /^(\d+)(?:-(\d*))?$/.exec(value);
  if (match?.[1] === undefined) {
    throw new MediaError("INVALID_PAGES", "pages must use N, N-M, or N- syntax", { pages: expression });
  }
  const first = Number(match[1]);
  const hasRange = value.includes("-");
  const last = hasRange ? (match[2] === "" ? pageCount : Number(match[2])) : first;
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last < first || last > pageCount) {
    throw new MediaError("INVALID_PAGES", `pages must be within 1-${pageCount}`, { pages: expression, pageCount });
  }
  const count = last - first + 1;
  if (count > maximum) {
    throw new MediaError("INVALID_PAGES", `At most ${maximum} pages may be extracted`, { pages: expression, count, maximum });
  }
  return Array.from({ length: count }, (_, index) => first + index);
}

async function runPdfTool(dependencies: PdfDependencies, command: string, args: readonly string[]): Promise<CommandResult> {
  try {
    return await dependencies.runCommand(command, args);
  } catch (error) {
    throw new MediaError("PDF_TOOL_FAILED", `${command} failed`, { command, args: [...args] }, { cause: error });
  }
}

export async function getPdfPageCount(path: string, dependencies: PdfDependencies = defaultDependencies): Promise<number> {
  return parsePdfPageCount((await runPdfTool(dependencies, "pdfinfo", [path])).stdout);
}

export async function readPdf(
  path: string,
  options: ReadPdfOptions = {},
  dependencies: PdfDependencies = defaultDependencies,
): Promise<McpImageBlock[]> {
  const file = await dependencies.stat(path);
  const limit = options.pages === undefined ? MAX_WHOLE_PDF_BYTES : MAX_EXTRACT_PDF_BYTES;
  if (file.size > limit) {
    throw new MediaError("FILE_TOO_LARGE", `PDF exceeds the ${limit / 1024 / 1024} MB limit`, {
      size: file.size, limit, mode: options.pages === undefined ? "whole" : "extract",
    });
  }
  const pageCount = await getPdfPageCount(path, dependencies);
  if (options.pages === undefined && pageCount > 10) {
    throw new MediaError("PDF_PAGES_REQUIRED", "PDFs over 10 pages require the pages option", { pageCount });
  }
  const pages = options.pages === undefined
    ? Array.from({ length: pageCount }, (_, index) => index + 1)
    : parsePdfPages(options.pages, pageCount);
  const quality = options.quality ?? 85;
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new MediaError("INVALID_PAGES", "quality must be an integer from 1 to 100", { quality });
  }

  let temporaryDirectory: string | undefined;
  try {
    temporaryDirectory = await dependencies.makeTempDirectory("mcp-pdf-");
    const blocks: McpImageBlock[] = [];
    for (const page of pages) {
      const prefix = join(temporaryDirectory, `page-${String(page).padStart(5, "0")}`);
      await runPdfTool(dependencies, "pdftoppm", [
        "-f", String(page), "-l", String(page), "-singlefile", "-jpeg",
        "-jpegopt", `quality=${quality}`, path, prefix,
      ]);
      blocks.push(imageBytesToBlock(await dependencies.readFile(`${prefix}.jpg`), "image/jpeg"));
    }
    return blocks;
  } finally {
    if (temporaryDirectory !== undefined) await dependencies.removeDirectory(temporaryDirectory);
  }
}
