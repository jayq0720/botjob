import { readFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  assertOcrText,
  decodeImageBase64,
  MAX_IMAGE_BYTES,
  ocrImage,
  sniffImage,
} from "../lib/ocr.js";
import { decodePdfBase64, extractTextFromPdf, isPdfBytes } from "../lib/pdf.js";
import { persistResumeText } from "../lib/resume.js";

export default defineTool({
  description:
    "Save the user's resume for this session. Accept plain text, a PDF (pdfBase64 or workspacePath), or a png/jpg image. Image PDFs and photos are OCR'd (chi_sim+eng). Exactly one of text / pdfBase64 / imageBase64 / workspacePath is required.",
  effect: "write",
  inputSchema: z
    .object({
      text: z.string().min(40).optional().describe("Full resume plain text"),
      pdfBase64: z
        .string()
        .min(80)
        .optional()
        .describe("PDF as raw base64 or data:application/pdf;base64,..."),
      imageBase64: z
        .string()
        .min(80)
        .optional()
        .describe("png or jpg resume image as raw base64 or a data URL"),
      workspacePath: z
        .string()
        .optional()
        .describe(
          "Relative path under the session workspace to a .pdf, .png, .jpg, or .txt resume",
        ),
      filename: z.string().optional().describe("Original filename if known"),
      source: z.enum(["paste", "upload", "pdf", "image"]).optional(),
    })
    .refine(
      (v) =>
        [v.text, v.pdfBase64, v.imageBase64, v.workspacePath].filter((x) =>
          Boolean(x),
        ).length === 1,
      {
        message:
          "Provide exactly one of text, pdfBase64, imageBase64, or workspacePath",
      },
    ),
  dryRunResult: ({ filename }) => ({
    saved: false,
    dryRun: true,
    filename: filename ?? "resume.pdf",
  }),
  async execute(
    { text, pdfBase64, imageBase64, workspacePath, filename, source },
    ctx,
  ) {
    if (pdfBase64) {
      const bytes = decodePdfBase64(pdfBase64);
      const extracted = await extractTextFromPdf(bytes);
      const saved = await persistResumeText(ctx, {
        text: extracted.text,
        filename: filename?.trim() || "resume.pdf",
        source: source ?? "pdf",
        pageCount: extracted.pageCount,
        pdfBytes: bytes,
        ocr: extracted.ocr,
      });
      return preview(saved, extracted.text, extracted.ocr);
    }

    if (imageBase64) {
      const bytes = decodeImageBase64(imageBase64);
      const extracted = assertOcrText(await ocrImage(bytes));
      const saved = await persistResumeText(ctx, {
        text: extracted,
        filename: filename?.trim() || "resume.png",
        source: source ?? "image",
        pageCount: 1,
        ocr: true,
      });
      return preview(saved, extracted, true);
    }

    if (workspacePath) {
      const rel = workspacePath.replace(/^\/+/, "");
      if (rel.includes("..") || path.isAbsolute(rel)) {
        throw new Error("workspacePath must be a relative path without ..");
      }
      const abs = path.join(ctx.workspaceDir, rel);
      const bytes = new Uint8Array(await readFile(abs));
      if (isPdfBytes(bytes) || rel.toLowerCase().endsWith(".pdf")) {
        const extracted = await extractTextFromPdf(bytes);
        const saved = await persistResumeText(ctx, {
          text: extracted.text,
          filename: filename?.trim() || path.basename(rel),
          source: source ?? "pdf",
          pageCount: extracted.pageCount,
          pdfBytes: bytes,
          ocr: extracted.ocr,
        });
        return preview(saved, extracted.text, extracted.ocr);
      }
      if (sniffImage(bytes) || /\.(png|jpe?g)$/i.test(rel)) {
        if (bytes.byteLength > MAX_IMAGE_BYTES) {
          throw new Error(`图片超过 ${MAX_IMAGE_BYTES} 字节上限`);
        }
        if (!sniffImage(bytes)) {
          throw new Error("只支持 png / jpg 简历图片");
        }
        const extracted = assertOcrText(await ocrImage(bytes));
        const saved = await persistResumeText(ctx, {
          text: extracted,
          filename: filename?.trim() || path.basename(rel),
          source: source ?? "image",
          pageCount: 1,
          ocr: true,
        });
        return preview(saved, extracted, true);
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

function preview(
  saved: { saved: true; filename: string; charCount: number; pageCount?: number; ocr?: boolean },
  text: string,
  ocr: boolean,
) {
  return {
    ...saved,
    ocr,
    extractedPreview: text.slice(0, 400),
    next: "Analyze the extracted resume text, then call save_resume_profile.",
  };
}
