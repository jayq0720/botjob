import { PDFParse } from "pdf-parse";
import { assertOcrText, ocrImage, shutdownOcr } from "./ocr.js";

export type PdfExtractResult = {
  text: string;
  pageCount: number;
  ocr: boolean;
};

export const MAX_PDF_BYTES = 8 * 1024 * 1024;
export const MAX_OCR_PAGES = 5;
export const MIN_TEXT_CHARS = 20;

/** Decode raw base64 or a data:application/pdf;base64,... URL. */
export function decodePdfBase64(input: string): Uint8Array {
  const trimmed = input.trim();
  const base64 = trimmed.startsWith("data:")
    ? (trimmed.split(",", 2)[1] ?? "")
    : trimmed.replace(/\s+/g, "");
  if (!base64) {
    throw new Error("Empty PDF base64 payload");
  }
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) {
    throw new Error("Invalid PDF base64 payload");
  }
  assertPdfBytes(buf);
  return new Uint8Array(buf);
}

export function isPdfBytes(buf: Uint8Array): boolean {
  return (
    buf.byteLength >= 4 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46
  );
}

export function assertPdfBytes(buf: Uint8Array): void {
  if (buf.byteLength > MAX_PDF_BYTES) {
    throw new Error(`PDF exceeds ${MAX_PDF_BYTES} byte limit`);
  }
  if (!isPdfBytes(buf)) {
    throw new Error("Decoded bytes are not a PDF (missing %PDF header)");
  }
}

export async function extractTextFromPdf(
  data: Uint8Array,
): Promise<PdfExtractResult> {
  assertPdfBytes(data);
  const parser = new PDFParse({ data });
  try {
    let text = "";
    let pageCount = 0;
    try {
      const textResult = await parser.getText();
      text = normalizeExtractedText(textResult.text ?? "");
      pageCount = textResult.total ?? 0;
    } catch (err) {
      const info = await parser.getInfo().catch(() => undefined);
      pageCount = info?.total ?? 0;
      if (pageCount === 0) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`PDF 文本抽取失败：${message}`);
      }
    }
    if (!pageCount) {
      const info = await parser.getInfo().catch(() => undefined);
      pageCount = info?.total ?? 0;
    }
    if (text.length >= MIN_TEXT_CHARS) {
      return { text, pageCount, ocr: false };
    }
    if (pageCount > MAX_OCR_PAGES) {
      throw new Error(
        `扫描件 PDF 共 ${pageCount} 页，超过 OCR 上限 ${MAX_OCR_PAGES} 页。请拆分后再上传，或直接粘贴文本。`,
      );
    }
    if (pageCount < 1) {
      throw new Error("PDF 没有文本层，也读不出页数，无法 OCR。");
    }
    const shot = await parser.getScreenshot({
      imageBuffer: true,
      imageDataUrl: false,
      desiredWidth: 1600,
    });
    const parts: string[] = [];
    for (const page of shot.pages) {
      if (!page.data || page.data.byteLength < 32) {
        throw new Error(`第 ${page.pageNumber} 页渲染失败，OCR 中止。`);
      }
      parts.push(await ocrImage(page.data));
    }
    const ocrText = normalizeExtractedText(parts.filter(Boolean).join("\n\n"));
    return {
      text: assertOcrText(ocrText),
      pageCount,
      ocr: true,
    };
  } finally {
    await parser.destroy().catch(() => undefined);
    await shutdownOcr();
  }
}

function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/--\s*\d+\s+of\s+\d+\s*--/gi, "")
    .trim();
}
