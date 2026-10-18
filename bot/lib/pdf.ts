import { PDFParse } from "pdf-parse";

export type PdfExtractResult = {
  text: string;
  pageCount: number;
  infoTitle?: string;
};

const MAX_PDF_BYTES = 8 * 1024 * 1024;

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
  if (buf.length > MAX_PDF_BYTES) {
    throw new Error(`PDF exceeds ${MAX_PDF_BYTES} byte limit`);
  }
  if (buf.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("Decoded bytes are not a PDF (missing %PDF header)");
  }
  return new Uint8Array(buf);
}

export async function extractTextFromPdf(
  data: Uint8Array,
): Promise<PdfExtractResult> {
  if (data.byteLength > MAX_PDF_BYTES) {
    throw new Error(`PDF exceeds ${MAX_PDF_BYTES} byte limit`);
  }
  const parser = new PDFParse({ data });
  try {
    const textResult = await parser.getText();
    const text = normalizeExtractedText(textResult.text ?? "");
    if (text.length < 20) {
      throw new Error(
        "Extracted fewer than 20 characters — PDF may be scanned/image-only. Ask user to paste text or OCR first.",
      );
    }
    return {
      text,
      pageCount: textResult.total ?? 0,
    };
  } finally {
    await parser.destroy().catch(() => undefined);
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
