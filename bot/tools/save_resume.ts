import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { saveResume } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

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
  async execute(input, ctx) {
    return saveResume(actionContextFromTool(ctx), input);
  },
});
