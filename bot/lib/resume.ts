import type { ToolContext } from "@cursor/bdk/tools";
import {
  resumeMetaKey,
  resumePdfPath,
  resumeTextPath,
  type ResumeMeta,
} from "./store.js";

export async function persistResumeText(
  ctx: ToolContext,
  args: {
    text: string;
    filename: string;
    source: ResumeMeta["source"];
    pageCount?: number;
    pdfBytes?: Uint8Array;
    ocr?: boolean;
  },
): Promise<{ saved: true; filename: string; charCount: number; pageCount?: number; ocr?: boolean }> {
  const sessionId = ctx.session.id;
  const cleaned = args.text.replace(/\r\n/g, "\n").trim();
  const files = ctx.host.files.forSession(sessionId);
  await files.write(resumeTextPath(sessionId), cleaned);
  if (args.pdfBytes) {
    await files.write(resumePdfPath(sessionId), args.pdfBytes);
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
  await ctx.host.kv.put(resumeMetaKey(sessionId), meta);
  return {
    saved: true,
    filename: meta.filename,
    charCount: meta.charCount,
    pageCount: meta.pageCount,
    ocr: meta.ocr,
  };
}
