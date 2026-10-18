import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { markApplied } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

const outcomeSchema = z.enum(["applied", "skipped", "failed"]);

export default defineTool({
  description:
    "Update application statuses after the local semi-auto runner finishes (or after the user applied manually). Only rows already approved are updated. Map applied→submitted_manual, skipped→skipped, failed→failed. Queued and other statuses are ignored.",
  effect: "write",
  inputSchema: z.object({
    results: z
      .array(
        z.object({
          id: z.string(),
          outcome: outcomeSchema,
          note: z.string().optional(),
        }),
      )
      .min(1),
  }),
  dryRunResult: ({ results }) => ({
    updated: false,
    dryRun: true,
    count: results.length,
  }),
  async execute(input, ctx) {
    return markApplied(actionContextFromTool(ctx), input);
  },
});
