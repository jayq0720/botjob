import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { jobUrlAllowed } from "../lib/jd.js";
import { letterFor } from "../lib/job-state.js";
import { scoreJob } from "../lib/score.js";
import {
  applicationsKey,
  coverLettersKey,
  resumeProfileKey,
  scoredJobsKey,
  type ApplicationRecord,
  type CoverLetterRecord,
  type JobListing,
  type ResumeProfile,
} from "../lib/store.js";

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
    "Queue one or more job applications for user approval. Parks until the user approves. Does NOT log into job boards or silently submit — after approval it records the intent and returns open-to-apply URLs for the user (or a local automation runner) to finish.",
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
  async execute({ jobs, coverNote }, ctx) {
    const sessionId = ctx.session.id;
    const now = new Date().toISOString();
    const existing =
      ((await ctx.host.kv.get(applicationsKey(sessionId))) as
        | ApplicationRecord[]
        | undefined) ?? [];
    const scored =
      ((await ctx.host.kv.get(scoredJobsKey(sessionId))) as
        | JobListing[]
        | undefined) ?? [];
    const letters =
      ((await ctx.host.kv.get(coverLettersKey(sessionId))) as
        | CoverLetterRecord[]
        | undefined) ?? [];
    const profile = (await ctx.host.kv.get(resumeProfileKey(sessionId))) as
      | ResumeProfile
      | undefined;

    const records: ApplicationRecord[] = jobs.map((job, index) => {
      const prev = scored.find((item) => item.id === job.id || item.url === job.url);
      const merged: JobListing = {
        ...prev,
        ...job,
        description: job.description ?? prev?.description,
        experience: job.experience ?? prev?.experience,
        education: job.education ?? prev?.education,
        salary: job.salary ?? prev?.salary,
        score: prev?.score,
      };
      if (profile) {
        const breakdown = scoreJob(profile, merged);
        merged.score = breakdown;
        merged.matchScore = breakdown.total;
        merged.matchReason = breakdown.summary;
      }
      const letter = letterFor(letters, merged.id);
      return {
        id: `app-${job.board}-${job.id}-${Date.now()}-${index}`,
        job: merged,
        status: "approved",
        coverNote: letter?.greeting ?? coverNote,
        greeting: letter?.greeting ?? coverNote,
        coverLetter: letter?.coverLetter,
        createdAt: now,
        updatedAt: now,
      };
    });

    const merged = [...existing, ...records];
    await ctx.host.kv.put(applicationsKey(sessionId), merged);

    return {
      approved: true,
      count: records.length,
      applications: records.map((r) => ({
        id: r.id,
        board: r.job.board,
        title: r.job.title,
        company: r.job.company,
        applyUrl: r.job.url,
        status: r.status,
        matchScore: r.job.matchScore,
        score: r.job.score,
        greeting: r.greeting,
        coverLetter: r.coverLetter,
      })),
      nextSteps: [
        "调用 export_apply_pack 导出投递包",
        "本机执行 npm run apply:local -- --pack <workspacePath>（持久化浏览器配置 ~/.botjob/browser-profile）",
        "每个岗位由用户确认后投递；跑完用 mark_applied 回写状态",
      ],
      note: "半自动投递：本机 Playwright 打开页面，登录态保留在用户本机配置目录；每次点击/标记需用户确认。",
    };
  },
});
