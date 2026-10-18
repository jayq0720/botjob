import {
  resumeMetaKey,
  resumePdfPath,
  resumeTextPath,
  type ResumeMeta,
} from "./store.js";
import type { StateStore } from "./state-store.js";

export async function persistResumeText(
  store: StateStore,
  sessionId: string,
  args: {
    text: string;
    filename: string;
    source: ResumeMeta["source"];
    pageCount?: number;
    pdfBytes?: Uint8Array;
    ocr?: boolean;
  },
): Promise<{ saved: true; filename: string; charCount: number; pageCount?: number; ocr?: boolean }> {
  const cleaned = args.text.replace(/\r\n/g, "\n").trim();
  await store.writeBytes(resumeTextPath(sessionId), cleaned);
  if (args.pdfBytes) {
    await store.writeBytes(resumePdfPath(sessionId), args.pdfBytes);
  }
  const meta: ResumeMeta = {
    filename: args.filename,
    savedAt: new Date().toISOString(),
    charCount: cleaned.length,
    source: args.source,
    pageCount: args.pageCount,
    hasPdf: Boolean(args.pdfBytes),
    ocr: args.ocr,
  };
  await store.put(resumeMetaKey(sessionId), meta);
  return {
    saved: true,
    filename: meta.filename,
    charCount: meta.charCount,
    pageCount: meta.pageCount,
    ocr: meta.ocr,
  };
}
