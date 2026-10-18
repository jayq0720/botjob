import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { queueApply } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";
import { jobUrlAllowed } from "../lib/jd.js";

export const queueJobSchema = z
  .object({
    id: z.string(),
    board: z.enum(["zhilian", "liepin", "job51", "boss"]),
    title: z.string(),
    company: z.string(),
    city: z.string(),
    salary: z.string().optional(),
    experience: z.string().optional(),
    education: z.string().optional(),
    description: z.string().optional(),
    url: z.string(),
    matchReason: z.string(),
    matchScore: z.number(),
  })
  .refine((job) => jobUrlAllowed(job.url, job.board), {
    message:
      "url 必须是该 board 的 https 链接（zhaopin.com、liepin.com、51job.com、zhipin.com），且域名与 board 一致。",
    path: ["url"],
  });

export default defineTool({
  description:
    "Queue one or more job applications for user approval. Parks until the user approves. The same posting (canonical https URL, fragment ignored) does not create another row: the existing record and its status are returned, and an approved or applied row is not moved back to queued. Does NOT log into job boards or silently submit — after approval it records the intent and returns open-to-apply URLs for the user (or a local automation runner) to finish.",
  effect: "write",
  needsApproval: true,
  inputSchema: z.object({
    jobs: z.array(queueJobSchema).min(1).max(10),
    coverNote: z
      .string()
      .optional()
      .describe("Short note tailored to these roles"),
  }),
  dryRunResult: ({ jobs }) => ({
    approved: false,
    dryRun: true,
    count: jobs.length,
  }),
  async execute(input, ctx) {
    return queueApply(actionContextFromTool(ctx), input);
  },
});
