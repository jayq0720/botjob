import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  applicationsKey,
  type ApplicationRecord,
  type JobListing,
} from "../lib/store.js";

const jobSchema = z.object({
  id: z.string(),
  board: z.enum(["zhilian", "liepin", "job51"]),
  title: z.string(),
  company: z.string(),
  city: z.string(),
  salary: z.string().optional(),
  url: z.string().url(),
  matchReason: z.string(),
  matchScore: z.number(),
});

export default defineTool({
  description:
    "Queue one or more job applications for user approval. Parks until the user approves. Does NOT log into job boards or silently submit — after approval it records the intent and returns open-to-apply URLs for the user (or a local automation runner) to finish.",
  effect: "write",
  needsApproval: true,
  inputSchema: z.object({
    jobs: z.array(jobSchema).min(1).max(10),
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

    const records: ApplicationRecord[] = jobs.map((job: JobListing) => ({
      id: `app-${job.board}-${job.id}-${Date.now()}`,
      job,
      status: "approved",
      coverNote,
      createdAt: now,
      updatedAt: now,
    }));

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
      })),
      nextSteps: [
        "请用户登录对应招聘网站账号",
        "打开 applyUrl，确认 JD 后完成投递",
        "投递完成后可再次对话，把状态更新为已投递（后续可扩展 mark_applied 工具）",
      ],
      note: "未自动登录三方站点，避免绕过验证码/违反平台条款。投递动作需用户确认后在浏览器完成。",
    };
  },
});
