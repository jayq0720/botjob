import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { decodePdfBase64, extractTextFromPdf } from "../lib/pdf.js";
import { persistResumeText } from "../lib/resume.js";

export default defineTool({
  description:
    "Save the user's resume for this session. Prefer pdfBase64 or workspacePath for PDF uploads; otherwise pass plain text. Exactly one of text / pdfBase64 / workspacePath is required.",
  effect: "write",
  inputSchema: z
    .object({
      text: z.string().min(40).optional().describe("Full resume plain text"),
      pdfBase64: z
        .string()
        .min(80)
        .optional()
        .describe("PDF as raw base64 or data:application/pdf;base64,..."),
      workspacePath: z
        .string()
        .optional()
        .describe(
          "Relative path under the session workspace to a .pdf or .txt resume (e.g. uploads/resume.pdf)",
        ),
      filename: z.string().optional().describe("Original filename if known"),
      source: z.enum(["paste", "upload", "pdf"]).optional(),
    })
    .refine(
      (v) =>
        [v.text, v.pdfBase64, v.workspacePath].filter((x) => Boolean(x))
          .length === 1,
      {
        message: "Provide exactly one of text, pdfBase64, or workspacePath",
      },
    ),
  dryRunResult: ({ filename }) => ({
    saved: false,
    dryRun: true,
    filename: filename ?? "resume.pdf",
  }),
  async execute({ text, pdfBase64, workspacePath, filename, source }, ctx) {
    if (pdfBase64) {
      const bytes = decodePdfBase64(pdfBase64);
      const extracted = await extractTextFromPdf(bytes);
      const saved = await persistResumeText(ctx, {
        text: extracted.text,
        filename: filename?.trim() || "resume.pdf",
        source: source ?? "pdf",
        pageCount: extracted.pageCount,
        pdfBytes: bytes,
      });
      return {
        ...saved,
        extractedPreview: extracted.text.slice(0, 400),
        next: "Analyze the extracted resume text, then call save_resume_profile.",
      };
    }

    if (workspacePath) {
      const rel = workspacePath.replace(/^\/+/, "");
      if (rel.includes("..") || path.isAbsolute(rel)) {
        throw new Error("workspacePath must be a relative path without ..");
      }
      const abs = path.join(ctx.workspaceDir, rel);
      const bytes = new Uint8Array(await readFile(abs));
      const lower = rel.toLowerCase();
      if (lower.endsWith(".pdf")) {
        const extracted = await extractTextFromPdf(bytes);
        const saved = await persistResumeText(ctx, {
          text: extracted.text,
          filename: filename?.trim() || path.basename(rel),
          source: source ?? "pdf",
          pageCount: extracted.pageCount,
          pdfBytes: bytes,
        });
        return {
          ...saved,
          extractedPreview: extracted.text.slice(0, 400),
          next: "Analyze the extracted resume text, then call save_resume_profile.",
        };
      }
      const asText = Buffer.from(bytes).toString("utf8");
      const saved = await persistResumeText(ctx, {
        text: asText,
        filename: filename?.trim() || path.basename(rel),
        source: source ?? "upload",
      });
      return {
        ...saved,
        next: "Analyze the resume, then call save_resume_profile with a structured profile.",
      };
    }

    const saved = await persistResumeText(ctx, {
      text: text!,
      filename: filename?.trim() || "resume.txt",
      source: source ?? "paste",
    });
    return {
      ...saved,
      next: "Analyze the resume, then call save_resume_profile with a structured profile.",
    };
  },
});
