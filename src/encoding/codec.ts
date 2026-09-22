import { TextDecoder } from "node:util";
import iconv from "iconv-lite";
import type { BomKind, DecodedText, EncodeTextOptions, NewlineKind } from "./types.js";

const BOMS: ReadonlyArray<readonly [BomKind, Buffer]> = [
  ["utf-8", Buffer.from([0xef, 0xbb, 0xbf])],
  ["utf-16le", Buffer.from([0xff, 0xfe])],
  ["utf-16be", Buffer.from([0xfe, 0xff])],
];

export function normalizeEncoding(label: string): string {
  try {
    return new TextDecoder(label).encoding;
  } catch {
    throw new Error(`Unsupported encoding: ${label}`);
  }
}

export function detectBom(buffer: Buffer): readonly [BomKind, number] {
  for (const [kind, bytes] of BOMS) {
    if (buffer.subarray(0, bytes.length).equals(bytes)) return [kind, bytes.length];
  }
  return [null, 0];
}

export function detectDominantNewline(text: string): NewlineKind {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\r" && text[index + 1] === "\n") {
      crlf += 1;
      index += 1;
    } else if (text[index] === "\n") lf += 1;
    else if (text[index] === "\r") cr += 1;
  }
  const maximum = Math.max(crlf, lf, cr);
  if (maximum === 0) return null;
  if (crlf === maximum) return "\r\n";
  if (lf === maximum) return "\n";
  return "\r";
}

export function decodeText(buffer: Buffer, requestedEncoding = "utf-8"): DecodedText {
  const encoding = normalizeEncoding(requestedEncoding);
  const [bom, bomLength] = detectBom(buffer);
  const bytes = buffer.subarray(bomLength);
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error(`Invalid byte sequence for ${encoding}`, { cause: error });
  }
  return { text, encoding, bom, newline: detectDominantNewline(text) };
}

function applyNewline(text: string, newline: NewlineKind): string {
  return newline === null ? text : text.replace(/\r\n|\r|\n/g, newline);
}

export function encodeText(text: string, requestedEncoding = "utf-8", options: EncodeTextOptions = {}): Buffer {
  const encoding = normalizeEncoding(requestedEncoding);
  const normalizedText = applyNewline(text, options.newline ?? null);
  if (!iconv.encodingExists(encoding)) throw new Error(`Encoding cannot be written: ${encoding}`);
  const encoded = iconv.encode(normalizedText, encoding);
  const roundTrip = new TextDecoder(encoding, { fatal: true }).decode(encoded);
  if (roundTrip !== normalizedText) {
    throw new Error(`Text contains characters not representable in ${encoding}`);
  }
  const prefix = BOMS.find(([kind]) => kind === (options.bom ?? null))?.[1];
  return prefix ? Buffer.concat([prefix, encoded]) : encoded;
}
