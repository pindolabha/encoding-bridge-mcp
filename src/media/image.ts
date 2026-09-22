import { readFile } from "node:fs/promises";
import sharp from "sharp";

import { MediaError } from "./errors.js";
import type { BinaryFileReader, McpImageBlock } from "./types.js";

export type SupportedImageMime = McpImageBlock["mimeType"];

export interface ImageTransformOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

const defaultFileReader: BinaryFileReader = { readFile };

function hasBytes(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function hasAscii(bytes: Uint8Array, offset: number, expected: string): boolean {
  return [...expected].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

export function detectImageMime(bytes: Uint8Array): SupportedImageMime | undefined {
  if (hasBytes(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (hasBytes(bytes, 0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (hasAscii(bytes, 0, "GIF87a") || hasAscii(bytes, 0, "GIF89a")) return "image/gif";
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) return "image/webp";
  return undefined;
}

function validateOptions(options: ImageTransformOptions): void {
  for (const [name, value] of [["maxWidth", options.maxWidth], ["maxHeight", options.maxHeight]] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new MediaError("IMAGE_PROCESSING_FAILED", `${name} must be a positive integer`, { [name]: value });
    }
  }
  if (options.quality !== undefined && (!Number.isInteger(options.quality) || options.quality < 1 || options.quality > 100)) {
    throw new MediaError("IMAGE_PROCESSING_FAILED", "quality must be an integer from 1 to 100", { quality: options.quality });
  }
}

export function imageBytesToBlock(bytes: Uint8Array, mimeType?: SupportedImageMime): McpImageBlock {
  const detectedMime = detectImageMime(bytes);
  if (detectedMime === undefined || (mimeType !== undefined && detectedMime !== mimeType)) {
    throw new MediaError("UNSUPPORTED_IMAGE", "Image content is not a supported PNG, JPEG, GIF, or WebP file");
  }
  return { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: detectedMime };
}

export async function transformImage(bytes: Uint8Array, options: ImageTransformOptions = {}): Promise<McpImageBlock> {
  validateOptions(options);
  const mimeType = detectImageMime(bytes);
  if (mimeType === undefined) {
    throw new MediaError("UNSUPPORTED_IMAGE", "Image content is not a supported PNG, JPEG, GIF, or WebP file");
  }

  try {
    let pipeline = sharp(bytes, { animated: mimeType === "image/gif" });
    if (options.maxWidth !== undefined || options.maxHeight !== undefined) {
      pipeline = pipeline.resize({
        width: options.maxWidth,
        height: options.maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      });
    }
    const quality = options.quality ?? 80;
    switch (mimeType) {
      case "image/jpeg": pipeline = pipeline.jpeg({ quality, mozjpeg: true }); break;
      case "image/png": pipeline = pipeline.png({ compressionLevel: 9, quality }); break;
      case "image/gif": pipeline = pipeline.gif({ effort: 7 }); break;
      case "image/webp": pipeline = pipeline.webp({ quality, effort: 5 }); break;
    }
    return imageBytesToBlock(await pipeline.toBuffer(), mimeType);
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError("IMAGE_PROCESSING_FAILED", "Unable to process image", { mimeType }, { cause: error });
  }
}

export async function readImage(
  path: string,
  options: ImageTransformOptions = {},
  files: BinaryFileReader = defaultFileReader,
): Promise<McpImageBlock> {
  return transformImage(await files.readFile(path), options);
}
