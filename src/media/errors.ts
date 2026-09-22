export type MediaErrorCode =
  | "UNSUPPORTED_IMAGE"
  | "IMAGE_PROCESSING_FAILED"
  | "INVALID_PDF"
  | "INVALID_PAGES"
  | "PDF_PAGES_REQUIRED"
  | "FILE_TOO_LARGE"
  | "PDF_TOOL_FAILED"
  | "INVALID_NOTEBOOK"
  | "INVALID_CELL_REFERENCE"
  | "CELL_NOT_FOUND";

export interface StructuredMediaError {
  name: "MediaError";
  code: MediaErrorCode;
  message: string;
  details?: Readonly<Record<string, unknown>>;
}

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(code: MediaErrorCode, message: string, details?: Readonly<Record<string, unknown>>, options?: ErrorOptions) {
    super(message, options);
    this.name = "MediaError";
    this.code = code;
    if (details !== undefined) this.details = details;
  }

  toJSON(): StructuredMediaError {
    return {
      name: "MediaError",
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

export function toStructuredMediaError(error: unknown): StructuredMediaError {
  if (error instanceof MediaError) return error.toJSON();
  return {
    name: "MediaError",
    code: "IMAGE_PROCESSING_FAILED",
    message: error instanceof Error ? error.message : String(error),
  };
}
