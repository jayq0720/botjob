import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { getResume } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

export default defineTool({
  description:
    "Load the saved resume text, metadata (incl. PDF pageCount/hasPdf), and structured profile for this session.",
  effect: "read",
  inputSchema: z.object({
    includeText: z
      .boolean()
      .optional()
      .describe("When true, include full resume text (default true)"),
  }),
  async execute(input, ctx) {
    return getResume(actionContextFromTool(ctx), input);
  },
});
