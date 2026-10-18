import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { listApplications } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

export default defineTool({
  description: "List queued / approved job applications for this session.",
  effect: "read",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    return listApplications(actionContextFromTool(ctx));
  },
});
