import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { exportApplyPack } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

export default defineTool({
  description:
    "Export approved applications as a local apply pack JSON. User then runs `npm run apply:local -- --pack <path>` on their machine for semi-automatic browser apply (login once, confirm each job).",
  effect: "write",
  inputSchema: z.object({
    onlyApproved: z
      .boolean()
      .optional()
      .describe("Default true — only export status=approved items"),
  }),
  dryRunResult: () => ({
    exported: false,
    dryRun: true,
    count: 0,
  }),
  async execute(input, ctx) {
    return exportApplyPack(actionContextFromTool(ctx), input);
  },
});
