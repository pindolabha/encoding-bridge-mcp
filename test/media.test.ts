import { describe, it, expect, beforeAll } from "vitest";
import {
  // Image
  detectImageMime,
  imageBytesToBlock,
  transformImage,
  readImage,
  // PDF
  parsePdfPages,
  parsePdfPageCount,
  readPdf,
  getPdfPageCount,
  MAX_PDF_PAGES,
  MAX_WHOLE_PDF_BYTES,
  MAX_EXTRACT_PDF_BYTES,
  // Notebook
  parseNotebook,
  parseCellReference,
  mapNotebookCell,
  mapNotebook,
  readNotebook,
  // Errors
  MediaError,
  toStructuredMediaError,
} from "../src/media/index.js";

// Image magic bytes
const PNG_MAGIC = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff]);
const GIF87_MAGIC = new TextEncoder().encode("GIF87a");
const GIF89_MAGIC = new TextEncoder().encode("GIF89a");
const WEBP_MAGIC = new Uint8Array(12);
WEBP_MAGIC.set(new TextEncoder().encode("RIFF"), 0);
WEBP_MAGIC.set(new TextEncoder().encode("WEBP"), 8);

describe("Image module", () => {
  describe("detectImageMime", () => {
    it("detects PNG", () => {
      expect(detectImageMime(PNG_MAGIC)).toBe("image/png");
    });
    it("detects JPEG", () => {
      expect(detectImageMime(JPEG_MAGIC)).toBe("image/jpeg");
    });
    it("detects GIF87a", () => {
      expect(detectImageMime(GIF87_MAGIC)).toBe("image/gif");
    });
    it("detects GIF89a", () => {
      expect(detectImageMime(GIF89_MAGIC)).toBe("image/gif");
    });
    it("detects WebP", () => {
      expect(detectImageMime(WEBP_MAGIC)).toBe("image/webp");
    });
    it("returns undefined for unknown", () => {
      expect(detectImageMime(new Uint8Array([1, 2, 3]))).toBeUndefined();
    });
  });

  describe("imageBytesToBlock", () => {
    it("creates image block with detected mime", () => {
      const block = imageBytesToBlock(PNG_MAGIC);
      expect(block.type).toBe("image");
      expect(block.mimeType).toBe("image/png");
      expect(block.data).toBeTruthy();
    });
    it("throws UNSUPPORTED_IMAGE for invalid", () => {
      expect(() => imageBytesToBlock(new Uint8Array([1, 2]))).toThrow(MediaError);
      try {
        imageBytesToBlock(new Uint8Array([1, 2]));
      } catch (e) {
        expect((e as MediaError).code).toBe("UNSUPPORTED_IMAGE");
      }
    });
  });

  describe("transformImage", () => {
    let testPng: Uint8Array;
    beforeAll(async () => {
      // Create a minimal valid PNG
      const sharp = (await import("sharp")).default;
      testPng = await sharp({
        create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
      }).png().toBuffer() as unknown as Uint8Array;
    });

    it("resizes image", async () => {
      const result = await transformImage(testPng, { maxWidth: 50, maxHeight: 50 });
      expect(result.type).toBe("image");
      expect(result.mimeType).toBe("image/png");
    });

    it("compresses with quality", async () => {
      const result = await transformImage(testPng, { quality: 50 });
      expect(result.type).toBe("image");
    });

    it("validates maxWidth > 0", async () => {
      await expect(transformImage(testPng, { maxWidth: 0 })).rejects.toThrow(MediaError);
    });

    it("validates quality range", async () => {
      await expect(transformImage(testPng, { quality: 150 })).rejects.toThrow(MediaError);
    });
  });
});

describe("PDF module", () => {
  describe("parsePdfPageCount", () => {
    it("parses pdfinfo output", () => {
      const output = "Title: test\nPages: 42\nAuthor: x";
      expect(parsePdfPageCount(output)).toBe(42);
    });
    it("parses Uint8Array", () => {
      const output = new TextEncoder().encode("Pages: 10");
      expect(parsePdfPageCount(output)).toBe(10);
    });
    it("throws INVALID_PDF for missing", () => {
      expect(() => parsePdfPageCount("no pages here")).toThrow(MediaError);
      try {
        parsePdfPageCount("no pages");
      } catch (e) {
        expect((e as MediaError).code).toBe("INVALID_PDF");
      }
    });
  });

  describe("parsePdfPages", () => {
    it("parses single page N", () => {
      expect(parsePdfPages("5", 10)).toEqual([5]);
    });
    it("parses range N-M", () => {
      expect(parsePdfPages("3-7", 10)).toEqual([3, 4, 5, 6, 7]);
    });
    it("parses open range N-", () => {
      expect(parsePdfPages("8-", 10)).toEqual([8, 9, 10]);
    });
    it("rejects invalid syntax", () => {
      expect(() => parsePdfPages("abc", 10)).toThrow(MediaError);
      try {
        parsePdfPages("abc", 10);
      } catch (e) {
        expect((e as MediaError).code).toBe("INVALID_PAGES");
      }
    });
    it("rejects out of range", () => {
      expect(() => parsePdfPages("15", 10)).toThrow(MediaError);
    });
    it("rejects > 20 pages", () => {
      expect(() => parsePdfPages("1-25", 30)).toThrow(MediaError);
      try {
        parsePdfPages("1-25", 30);
      } catch (e) {
        expect((e as MediaError).code).toBe("INVALID_PAGES");
      }
    });
    it("respects MAX_PDF_PAGES = 20", () => {
      expect(MAX_PDF_PAGES).toBe(20);
    });
  });

  describe("readPdf", () => {
    it("rejects > 20MB whole PDF", async () => {
      const deps = {
        stat: async () => ({ size: MAX_WHOLE_PDF_BYTES + 1 }),
        readFile: async () => new Uint8Array(),
        makeTempDirectory: async () => "/tmp",
        removeDirectory: async () => {},
        runCommand: async () => ({ stdout: new Uint8Array(), stderr: new Uint8Array() }),
      };
      await expect(readPdf("test.pdf", {}, deps)).rejects.toThrow(MediaError);
      try {
        await readPdf("test.pdf", {}, deps);
      } catch (e) {
        expect((e as MediaError).code).toBe("FILE_TOO_LARGE");
      }
    });

    it("rejects > 100MB with pages option", async () => {
      const deps = {
        stat: async () => ({ size: MAX_EXTRACT_PDF_BYTES + 1 }),
        readFile: async () => new Uint8Array(),
        makeTempDirectory: async () => "/tmp",
        removeDirectory: async () => {},
        runCommand: async () => ({ stdout: new Uint8Array(), stderr: new Uint8Array() }),
      };
      await expect(readPdf("test.pdf", { pages: "1-5" }, deps)).rejects.toThrow(MediaError);
    });

    it("requires pages for > 10 pages", async () => {
      const deps = {
        stat: async () => ({ size: 1000 }),
        readFile: async () => new Uint8Array(),
        makeTempDirectory: async () => "/tmp",
        removeDirectory: async () => {},
        runCommand: async () => ({ stdout: new TextEncoder().encode("Pages: 15"), stderr: new Uint8Array() }),
      };
      await expect(readPdf("test.pdf", {}, deps)).rejects.toThrow(MediaError);
      try {
        await readPdf("test.pdf", {}, deps);
      } catch (e) {
        expect((e as MediaError).code).toBe("PDF_PAGES_REQUIRED");
      }
    });
  });

  it("defines size constants", () => {
    expect(MAX_WHOLE_PDF_BYTES).toBe(20 * 1024 * 1024);
    expect(MAX_EXTRACT_PDF_BYTES).toBe(100 * 1024 * 1024);
  });
});

describe("Notebook module", () => {
  describe("parseCellReference", () => {
    it("parses zero-based cell-N", () => {
      expect(parseCellReference("cell-0")).toBe(0);
      expect(parseCellReference("cell-10")).toBe(10);
    });
    it("throws for invalid", () => {
      expect(() => parseCellReference("cell--1")).toThrow(MediaError);
      expect(() => parseCellReference("cell-abc")).toThrow(MediaError);
      try {
        parseCellReference("invalid");
      } catch (e) {
        expect((e as MediaError).code).toBe("INVALID_CELL_REFERENCE");
      }
    });
  });

  describe("parseNotebook", () => {
    it("parses valid notebook", () => {
      const json = JSON.stringify({
        cells: [
          { cell_type: "code", source: "print(1)", metadata: {}, execution_count: 1, outputs: [] }
        ],
        metadata: {},
        nbformat: 4
      });
      const nb = parseNotebook(json);
      expect(nb.cells).toHaveLength(1);
      expect(nb.cells[0]!.cell_type).toBe("code");
    });
    it("throws INVALID_NOTEBOOK for invalid", () => {
      expect(() => parseNotebook("not json")).toThrow(MediaError);
      try {
        parseNotebook("not json");
      } catch (e) {
        expect((e as MediaError).code).toBe("INVALID_NOTEBOOK");
      }
    });
    it("throws for missing cells array", () => {
      expect(() => parseNotebook("{}")).toThrow(MediaError);
    });
  });

  describe("mapNotebookCell", () => {
    it("maps code cell", () => {
      const cell = {
        cell_type: "code" as const,
        source: "print('hi')",
        outputs: [{ output_type: "stream", text: "hi\n" }]
      };
      const mapped = mapNotebookCell(cell, 0);
      expect(mapped.id).toBe("cell-0");
      expect(mapped.cellType).toBe("code");
      expect(mapped.content).toHaveLength(2);
      expect(mapped.content[0]).toEqual({ type: "text", text: "print('hi')" });
      expect(mapped.content[1]).toEqual({ type: "text", text: "hi\n" });
    });

    it("truncates large output", () => {
      const cell = {
        cell_type: "code" as const,
        source: "",
        outputs: [{ output_type: "stream", text: "x".repeat(15000) }]
      };
      const mapped = mapNotebookCell(cell, 0, 10000);
      expect((mapped.content[0] as any).text).toContain("Output omitted");
    });

    it("maps image output", () => {
      const cell = {
        cell_type: "code" as const,
        source: "",
        outputs: [{
          output_type: "display_data",
          data: { "image/png": Buffer.from(PNG_MAGIC).toString("base64") }
        }]
      };
      const mapped = mapNotebookCell(cell, 0);
      expect(mapped.content).toHaveLength(1);
      expect(mapped.content[0]!.type).toBe("image");
    });

    it("rejects invalid image output", () => {
      const cell = {
        cell_type: "code" as const,
        source: "",
        outputs: [{ output_type: "display_data", data: { "image/png": "not-base64!" } }]
      };
      expect(() => mapNotebookCell(cell, 0)).toThrow(/invalid image\/png base64/i);
    });
  });

  describe("mapNotebook", () => {
    const nb = {
      cells: [
        { cell_type: "code" as const, source: "a", outputs: [] },
        { cell_type: "markdown" as const, source: "# Title", outputs: [] },
        { cell_type: "code" as const, source: "b", outputs: [] }
      ]
    };

    it("maps all cells", () => {
      const cells = mapNotebook(nb);
      expect(cells).toHaveLength(3);
    });

    it("maps specific cell", () => {
      const cells = mapNotebook(nb, { cell: "cell-1" });
      expect(cells).toHaveLength(1);
      expect(cells[0]!.cellType).toBe("markdown");
    });

    it("throws CELL_NOT_FOUND for invalid cell", () => {
      expect(() => mapNotebook(nb, { cell: "cell-99" })).toThrow(MediaError);
      try {
        mapNotebook(nb, { cell: "cell-99" });
      } catch (e) {
        expect((e as MediaError).code).toBe("CELL_NOT_FOUND");
      }
    });

    it("validates outputLimit", () => {
      expect(() => mapNotebook(nb, { outputLimit: 0 })).toThrow(MediaError);
    });
  });
});

describe("Errors", () => {
  it("MediaError serializes to JSON", () => {
    const err = new MediaError("UNSUPPORTED_IMAGE", "bad image", { path: "x.png" });
    expect(err.name).toBe("MediaError");
    expect(err.code).toBe("UNSUPPORTED_IMAGE");
    expect(err.message).toBe("bad image");
    expect(err.details).toEqual({ path: "x.png" });
    const json = err.toJSON();
    expect(json.name).toBe("MediaError");
    expect(json.code).toBe("UNSUPPORTED_IMAGE");
  });

  it("toStructuredMediaError handles MediaError", () => {
    const err = new MediaError("PDF_TOOL_FAILED", "pdftoppm failed");
    const result = toStructuredMediaError(err);
    expect(result.name).toBe("MediaError");
    expect(result.code).toBe("PDF_TOOL_FAILED");
  });

  it("toStructuredMediaError wraps other errors", () => {
    const err = new Error("generic");
    const result = toStructuredMediaError(err);
    expect(result.name).toBe("MediaError");
    expect(result.code).toBe("IMAGE_PROCESSING_FAILED");
    expect(result.message).toBe("generic");
  });
});
