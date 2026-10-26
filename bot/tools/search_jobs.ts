import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { searchJobs } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

const boardSchema = z.enum(["zhilian", "liepin", "job51"]);

export default defineTool({
  description:
    "Search 智联招聘、猎聘 from the saved resume profile. Returns public search links and, when the page is readable, real listings scored against the profile, restricted to the last 72 hours. Prefer the job update time, fall back to publication time, and exclude unknown or future dates. Return source timestamps and exclusion counts. This reads public pages on those boards (open-world HTTPS). Failures name the reason (login, captcha, blocked, empty, parse). Excludes insurance and labor-dispatch employers. Verify employerReview=needs_review before recommending. userActions identify login/verification requirements; call open_job_login and wait for the user, then retry with accessMode=browser. limitPerBoard increases the local cap up to 20 without implying a login requirement. Never invents jobs. Eval/dry-run sessions skip the network unless attemptFetch is true. attemptFetch=false only builds links.",
  // @cursor/bdk@0.2.27 ToolEffect is only "read" | "write". A public GET does
  // not mutate the board; "write" would be stubbed in dry-run and drop the links.
  effect: "read",
  inputSchema: z.object({
    boards: z.array(boardSchema).optional(),
    extraKeywords: z.array(z.string()).optional(),
    cities: z.array(z.string()).optional(),
    titles: z
      .array(z.string())
      .optional()
      .describe("Override target titles when profile is missing"),
    accessMode: z.enum(["public", "browser"]).optional(),
    limitPerBoard: z.number().int().min(1).max(20).optional(),
    attemptFetch: z
      .boolean()
      .optional()
      .describe("Set false to only build search URLs. Default true outside eval/dry-run."),
  }),
  async execute(input, ctx) {
    return searchJobs(actionContextFromTool(ctx), input);
  },
});
