import { decodeText, detectEncodingFromBytes, encodeText } from "../src/encoding/index.js";
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
