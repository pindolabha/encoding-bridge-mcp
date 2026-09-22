import { readFile } from "node:fs/promises";

import { imageBytesToBlock } from "./image.js";
import { MediaError } from "./errors.js";
import type { DecodeBytes, McpContentBlock, McpImageBlock, McpTextBlock } from "./types.js";

export type NotebookCellType = "code" | "markdown" | "raw";
export interface NotebookOutput {
  output_type?: string;
  name?: string;
  text?: string | string[];
  data?: Record<string, unknown>;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  [key: string]: unknown;
}
export interface NotebookCell {
  id?: string;
  cell_type: NotebookCellType;
  source: string | string[];
  metadata?: Record<string, unknown>;
  outputs?: NotebookOutput[];
  execution_count?: number | null;
  [key: string]: unknown;
}
export interface NotebookDocument {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat?: number;
  nbformat_minor?: number;
  [key: string]: unknown;
}
export interface ParsedNotebookCell { id: string; cellType: NotebookCellType; content: McpContentBlock[]; }
export interface ReadNotebookOptions { cell?: string; outputLimit?: number; }
export interface NotebookReadDependencies {
  readFile(path: string): Promise<Uint8Array>;
  decode: DecodeBytes;
}

function joinText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value.join("");
  return undefined;
}
function textBlock(text: string): McpTextBlock { return { type: "text", text }; }
function imageBlock(value: unknown, mimeType: "image/png" | "image/jpeg"): McpImageBlock | undefined {
  const data = joinText(value)?.replace(/\s/g, "");
  if (data === undefined) return undefined;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new MediaError("INVALID_NOTEBOOK", `Notebook contains invalid ${mimeType} base64 data`);
  }
  let bytes: Buffer;
  try {
    bytes = Buffer.from(data, "base64");
  } catch (error) {
    throw new MediaError("INVALID_NOTEBOOK", `Notebook contains invalid ${mimeType} base64 data`, undefined, { cause: error });
  }
  if (bytes.length === 0 || bytes.toString("base64").replace(/=+$/, "") !== data.replace(/=+$/, "")) {
    throw new MediaError("INVALID_NOTEBOOK", `Notebook contains invalid ${mimeType} base64 data`);
  }
  try {
    return imageBytesToBlock(bytes, mimeType);
  } catch (error) {
    throw new MediaError("INVALID_NOTEBOOK", `Notebook ${mimeType} data does not match its MIME type`, undefined, { cause: error });
  }
}
function limitedOutput(text: string, cellId: string, limit: number): McpTextBlock {
  if (text.length <= limit) return textBlock(text);
  return textBlock(`Output omitted (${text.length} characters). Read ${cellId} directly to inspect this large output.`);
}
function mapOutput(output: NotebookOutput, cellId: string, limit: number): McpContentBlock[] {
  const blocks: McpContentBlock[] = [];
  const directText = joinText(output.text);
  if (directText !== undefined) blocks.push(limitedOutput(directText, cellId, limit));
  const plainText = joinText(output.data?.["text/plain"]);
  if (plainText !== undefined) blocks.push(limitedOutput(plainText, cellId, limit));
  const png = imageBlock(output.data?.["image/png"], "image/png");
  if (png !== undefined) blocks.push(png);
  const jpeg = imageBlock(output.data?.["image/jpeg"] ?? output.data?.["image/jpg"], "image/jpeg");
  if (jpeg !== undefined) blocks.push(jpeg);
  if (output.output_type === "error") {
    const errorText = output.traceback?.join("\n") ?? [output.ename, output.evalue].filter(Boolean).join(": ");
    if (errorText.length > 0) blocks.push(limitedOutput(errorText, cellId, limit));
  }
  return blocks;
}
function isNotebookCell(value: unknown): value is NotebookCell {
  if (typeof value !== "object" || value === null) return false;
  const cell = value as Partial<NotebookCell>;
  return (cell.cell_type === "code" || cell.cell_type === "markdown" || cell.cell_type === "raw")
    && (typeof cell.source === "string" || (Array.isArray(cell.source) && cell.source.every((part) => typeof part === "string")));
}

export function parseNotebook(text: string): NotebookDocument {
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null || !Array.isArray((value as Partial<NotebookDocument>).cells)
      || !(value as NotebookDocument).cells.every(isNotebookCell)) {
      throw new Error("cells must be an array of valid notebook cells");
    }
    return value as NotebookDocument;
  } catch (error) {
    throw new MediaError("INVALID_NOTEBOOK", "Unable to parse notebook JSON", undefined, { cause: error });
  }
}

export function parseCellReference(reference: string): number {
  const match = /^cell-(0|[1-9]\d*)$/i.exec(reference.trim());
  if (match?.[1] === undefined) {
    throw new MediaError("INVALID_CELL_REFERENCE", "Cell references must use zero-based cell-N", { cell: reference });
  }
  return Number(match[1]);
}

export function mapNotebookCell(cell: NotebookCell, index: number, outputLimit = 10_000): ParsedNotebookCell {
  const id = `cell-${index}`;
  const source = joinText(cell.source) ?? "";
  const content: McpContentBlock[] = source.length === 0 ? [] : [textBlock(source)];
  for (const output of cell.outputs ?? []) content.push(...mapOutput(output, id, outputLimit));
  return { id, cellType: cell.cell_type, content };
}

export function mapNotebook(notebook: NotebookDocument, options: ReadNotebookOptions = {}): ParsedNotebookCell[] {
  const outputLimit = options.outputLimit ?? 10_000;
  if (!Number.isInteger(outputLimit) || outputLimit < 1) {
    throw new MediaError("INVALID_NOTEBOOK", "outputLimit must be a positive integer", { outputLimit });
  }
  if (options.cell === undefined) {
    return notebook.cells.map((cell, index) => mapNotebookCell(cell, index, outputLimit));
  }
  const index = parseCellReference(options.cell);
  const cell = notebook.cells[index];
  if (cell === undefined) {
    throw new MediaError("CELL_NOT_FOUND", `Notebook does not contain ${options.cell}`, {
      cell: options.cell, cellCount: notebook.cells.length,
    });
  }
  const selectedCellLimit = options.outputLimit ?? Number.MAX_SAFE_INTEGER;
  return [mapNotebookCell(cell, index, selectedCellLimit)];
}

export async function readNotebook(
  path: string,
  options: ReadNotebookOptions,
  dependencies: NotebookReadDependencies,
): Promise<ParsedNotebookCell[]> {
  const bytes = await dependencies.readFile(path);
  return mapNotebook(parseNotebook(dependencies.decode(bytes)), options);
}

export function createNotebookReader(decode: DecodeBytes): (
  path: string,
  options?: ReadNotebookOptions,
) => Promise<ParsedNotebookCell[]> {
  return (path, options = {}) => readNotebook(path, options, { readFile, decode });
}
