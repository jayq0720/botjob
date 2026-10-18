import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { saveResume } from "../lib/actions.js";
import { actionContextFromTool, withDurableSession } from "../lib/bdk-context.js";

export default defineTool({
  description:
    "Save the user's resume for this session. Accept plain text, a PDF (pdfBase64 or workspacePath), or a png/jpg image. Image PDFs and photos are OCR'd with chi_sim. workspacePath is relative to the session workspace, or to the project root when the file is not in the workspace. Exactly one of text / pdfBase64 / imageBase64 / workspacePath is required. A scratch bdk call does not return a reusable sessionId; reuse a Playground session with --session.",
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
          "Relative path to a .pdf, .png, .jpg, .jpeg, or .txt resume. Resolved under the session workspace first, then the project root.",
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
    const action = actionContextFromTool(ctx);
    return withDurableSession(action, await saveResume(action, input));
  },
});
