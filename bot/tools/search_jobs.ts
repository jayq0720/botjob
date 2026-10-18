import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { searchJobs } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

const boardSchema = z.enum(["zhilian", "liepin", "job51", "boss"]);

export default defineTool({
  description:
    "Search 智联招聘、猎聘、前程无忧(51job)、BOSS直聘 from the saved resume profile. Returns public search links and, when the page is readable, real listings scored against the profile. Failures name the reason (login, captcha, blocked, empty, parse). Never invents jobs. Eval/dry-run sessions skip the network unless attemptFetch is true.",
  effect: "read",
  inputSchema: z.object({
    boards: z.array(boardSchema).optional(),
    extraKeywords: z.array(z.string()).optional(),
    cities: z.array(z.string()).optional(),
    titles: z
      .array(z.string())
      .optional()
      .describe("Override target titles when profile is missing"),
    attemptFetch: z
      .boolean()
      .optional()
      .describe("Set false to only build search URLs. Default true outside eval/dry-run."),
  }),
  async execute(input, ctx) {
    return searchJobs(actionContextFromTool(ctx), input);
  },
});
