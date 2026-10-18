import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { saveCoverLetter } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

export default defineTool({
  description:
    "Store a greeting (about 150 Chinese characters) and a cover letter you wrote for one job. Does not compose the text. The apply pack and local runner will show it. Sending on BOSS still needs a human confirm.",
  effect: "write",
  inputSchema: z.object({
    jobId: z.string().describe("Job id from score_job / search_jobs, or an application id"),
    greeting: z.string().min(1),
    coverLetter: z.string().min(20),
  }),
  dryRunResult: ({ jobId }) => ({
    saved: false,
    dryRun: true,
    jobId,
  }),
  async execute(input, ctx) {
    return saveCoverLetter(actionContextFromTool(ctx), input);
  },
});
