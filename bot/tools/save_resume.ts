import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  resumeMetaKey,
  resumeTextPath,
  type ResumeMeta,
} from "../lib/store.js";

export default defineTool({
  description:
    "Save the user's resume text for this session. Call when the user pastes a resume or uploads resume content. Prefer the full plain-text body; strip HTML if needed.",
  effect: "write",
  inputSchema: z.object({
    text: z.string().min(40).describe("Full resume plain text"),
    filename: z
      .string()
      .optional()
      .describe("Original filename if known, e.g. resume.pdf.txt"),
    source: z.enum(["paste", "upload"]).optional(),
  }),
  dryRunResult: ({ filename }) => ({
    saved: false,
    dryRun: true,
    filename: filename ?? "resume.txt",
  }),
  async execute({ text, filename, source }, ctx) {
    const sessionId = ctx.session.id;
    const cleaned = text.replace(/\r\n/g, "\n").trim();
    const files = ctx.host.files.forSession(sessionId);
    await files.write(resumeTextPath(sessionId), cleaned);
    const meta: ResumeMeta = {
      filename: filename?.trim() || "resume.txt",
      savedAt: new Date().toISOString(),
      charCount: cleaned.length,
      source: source ?? "paste",
    };
    await ctx.host.kv.put(resumeMetaKey(sessionId), meta);
    return {
      saved: true,
      filename: meta.filename,
      charCount: meta.charCount,
      next: "Analyze the resume, then call save_resume_profile with a structured profile.",
    };
  },
});
