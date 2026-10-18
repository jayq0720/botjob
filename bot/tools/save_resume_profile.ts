import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { saveResumeProfile } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

export default defineTool({
  description:
    "Persist the structured resume analysis for this session after you analyze the resume. Always call this before searching jobs.",
  effect: "write",
  inputSchema: z.object({
    name: z.string().optional(),
    summary: z.string().min(20),
    yearsExperience: z.number().optional(),
    education: z.string().optional().describe("最高学历，如本科、硕士"),
    currentTitle: z.string().optional(),
    targetTitles: z.array(z.string()).min(1),
    skills: z.array(z.string()).min(1),
    cities: z.array(z.string()).default([]),
    industries: z.array(z.string()).default([]),
    salaryExpectation: z.string().optional(),
    strengths: z.array(z.string()).default([]),
    gaps: z.array(z.string()).default([]),
    keywords: z
      .array(z.string())
      .min(1)
      .describe("Search keywords for job boards"),
  }),
  dryRunResult: ({ targetTitles }) => ({
    saved: false,
    dryRun: true,
    targetTitles,
  }),
  async execute(input, ctx) {
    return saveResumeProfile(actionContextFromTool(ctx), input);
  },
});
