import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeText, detectEncodingFromBytes, encodeText, readFileRange } from "../src/encoding/index.js";
import { formatFileChangeMessage, createStructuredPatch } from "../src/diff.js";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";

describe("strict codec", () => {
  it("defaults to strict UTF-8", () => {
    expect(() => decodeText(Buffer.from([0xc3, 0x28]))).toThrow(/Invalid byte sequence/);
  });

  it("preserves BOM and detects dominant newline", () => {
    const decoded = decodeText(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("a\r\nb\r\nc\n")]));
    expect(decoded).toMatchObject({ text: "a\r\nb\r\nc\n", bom: "utf-8", newline: "\r\n" });
    expect(encodeText("x\ny\n", decoded.encoding, decoded)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("x\r\ny\r\n")]),
    );
  });

  it("writes legacy encodings and rejects lossy conversion", () => {
    expect(decodeText(encodeText("café", "windows-1252"), "windows-1252").text).toBe("café");
    expect(() => encodeText("price € and 漢", "windows-1252")).toThrow(/not representable/);
  });
});

describe("encoding detection", () => {
  it("classifies UTF-8, GBK, and BOM files", () => {
    expect(detectEncodingFromBytes(Buffer.from("hello 错误", "utf8")).encoding).toBe("utf-8");
    expect(detectEncodingFromBytes(iconv.encode("错误：连接失败", "gbk")).encoding).toBe("gb18030");
    expect(detectEncodingFromBytes(Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("a")])).bom).toBe("utf-8");
  });
});

describe("colored edit diff", () => {
  it("marks removed lines red and added lines green", () => {
    const hunks = createStructuredPatch("core.ts", "import { stat } from 'node:fs/promises'\n", "")
    const rendered = formatFileChangeMessage("core.ts", "import { stat } from 'node:fs/promises'\n", "", "updated", hunks)
    expect(rendered).toContain("```diff")
    expect(rendered).toContain("-import { stat } from 'node:fs/promises'")
  })
})

describe("range reads", () => {
  it("streams a range from a huge multi-line file without overflowing the stack", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "encoding-range-"));
    // Larger than FAST_PATH_MAX_SIZE forces the streaming path, and the first
    // 256 KiB chunk holds 200k lines. Appending those spans with a spread
    // passes each one as a call argument and overflows the stack at that size.
    const file = path.join(root, "many-lines.txt");
    await writeFile(file, "\n".repeat(200_000) + "x".repeat(10 * 1024 * 1024));
    const result = await readFileRange(file, "utf-8", 0, 200_000);
    expect(result.text.split("\n").length).toBeGreaterThan(100_000);
    expect(result.lineCount).toBe(200_000);
  });
});
