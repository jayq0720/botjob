import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { fetchJobUrl } from "../lib/boards/fetch.js";
import type { BoardId } from "../lib/boards/types.js";
import {
  allowedJobUrl,
  boardFromUrl,
  listingFromPosting,
  parsePastedJd,
} from "../lib/jd.js";
import { upsertJobs } from "../lib/job-state.js";
import {
  resumeProfileKey,
  scoredJobsKey,
  type JobListing,
  type ResumeProfile,
} from "../lib/store.js";

const boardSchema = z.enum(["zhilian", "liepin", "job51", "boss"]);

export default defineTool({
  description:
    "Score one job against the saved resume profile. Pass JD text and/or an https URL on 智联/猎聘/51job/BOSS. Stores the score in session state. Does not invent fields the page did not contain, and does not bypass captcha or login.",
  effect: "read",
  inputSchema: z
    .object({
      text: z.string().optional().describe("Pasted JD text"),
      url: z.string().optional().describe("Public job detail URL"),
      board: boardSchema.optional(),
      title: z.string().optional(),
      company: z.string().optional(),
      city: z.string().optional(),
      salary: z.string().optional(),
      experience: z.string().optional(),
      education: z.string().optional(),
    })
    .refine((v) => Boolean(v.text?.trim() || v.url?.trim()), {
      message: "Provide JD text or a job URL",
    }),
  async execute(input, ctx) {
    const sessionId = ctx.session.id;
    const profile = (await ctx.host.kv.get(resumeProfileKey(sessionId))) as
      | ResumeProfile
      | undefined;
    if (!profile) {
      return {
        ok: false,
        message: "No resume profile yet. Call save_resume_profile before scoring.",
      };
    }

    const url = input.url?.trim();
    const fromHost = url ? boardFromUrl(url) : undefined;
    const board = (fromHost ?? input.board) as BoardId | undefined;
    if (url && !allowedJobUrl(url)) {
      return {
        ok: false,
        reason: "skipped",
        message:
          "只抓取智联、猎聘、51job、BOSS 的 https 岗位页。其它链接请把 JD 正文贴到 text。",
      };
    }
    if (!board) {
      return {
        ok: false,
        message: "贴 JD 文本时请指定 board：zhilian、liepin、job51 或 boss。",
      };
    }

    const offline =
      ctx.session.purpose === "eval" || ctx.session.dryRun === true;
    let fetchError: string | undefined;
    if (url && !offline) {
      const fetched = await fetchJobUrl(url, board);
      if (fetched.ok) {
        const job = listingFromPosting(
          {
            ...fetched.job,
            title: input.title?.trim() || fetched.job.title,
            company: input.company?.trim() || fetched.job.company,
            city: input.city?.trim() || fetched.job.city,
            salary: input.salary?.trim() || fetched.job.salary,
            experience: input.experience?.trim() || fetched.job.experience,
            education: input.education?.trim() || fetched.job.education,
          },
          profile,
        );
        await remember(ctx.host.kv, sessionId, job);
        return {
          ok: true,
          job,
          score: job.score,
          next: "按 job-hunt skill 写 150 字内打招呼语和求职信，调用 save_cover_letter，再 queue_apply。",
        };
      }
      fetchError = fetched.message;
      if (!input.text?.trim()) {
        return { ok: false, reason: fetched.reason, message: fetched.message };
      }
    } else if (url && offline && !input.text?.trim()) {
      return {
        ok: false,
        reason: "skipped",
        message: "当前会话不访问招聘网站。请改贴 JD 文本。",
      };
    }

    const parsed = parsePastedJd({
      text: input.text ?? "",
      board,
      url,
      title: input.title,
      company: input.company,
      city: input.city,
      salary: input.salary,
      experience: input.experience,
      education: input.education,
    });
    if (!parsed.ok) return { ok: false, message: parsed.message };
    const job = listingFromPosting(parsed.job, profile);
    await remember(ctx.host.kv, sessionId, job);
    return {
      ok: true,
      job,
      score: job.score,
      fetchError,
      next: "按 job-hunt skill 写 150 字内打招呼语和求职信，调用 save_cover_letter，再 queue_apply。",
    };
  },
});

async function remember(
  kv: { get(key: string): Promise<unknown>; put(key: string, value: JobListing[]): Promise<void> },
  sessionId: string,
  job: JobListing,
): Promise<void> {
  const existing =
    ((await kv.get(scoredJobsKey(sessionId))) as JobListing[] | undefined) ?? [];
  await kv.put(scoredJobsKey(sessionId), upsertJobs(existing, [job]));
}
