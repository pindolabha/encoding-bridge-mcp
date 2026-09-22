export interface McpTextBlock {
  type: "text";
  text: string;
}

export interface McpImageBlock {
  type: "image";
  data: string;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

export type McpContentBlock = McpTextBlock | McpImageBlock;
export type DecodeBytes = (bytes: Uint8Array) => string;

export interface BinaryFileReader {
  readFile(path: string): Promise<Uint8Array>;
}
