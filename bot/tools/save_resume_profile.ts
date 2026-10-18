import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { resumeProfileKey, type ResumeProfile } from "../lib/store.js";

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
    const sessionId = ctx.session.id;
    const profile: ResumeProfile = {
      name: input.name,
      summary: input.summary,
      yearsExperience: input.yearsExperience,
      education: input.education,
      currentTitle: input.currentTitle,
      targetTitles: input.targetTitles,
      skills: input.skills,
      cities: input.cities ?? [],
      industries: input.industries ?? [],
      salaryExpectation: input.salaryExpectation,
      strengths: input.strengths ?? [],
      gaps: input.gaps ?? [],
      keywords: input.keywords,
      updatedAt: new Date().toISOString(),
    };
    await ctx.host.kv.put(resumeProfileKey(sessionId), profile);
    return {
      saved: true,
      profile,
      next: "Call search_jobs for 智联/猎聘/51job/BOSS，或把 JD 文本 / 岗位 URL 交给 score_job。",
    };
  },
});
