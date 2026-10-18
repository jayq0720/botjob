import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  buildSearchPacks,
  criteriaFromProfile,
  type BoardId,
} from "../lib/boards/index.js";
import { fetchBoard } from "../lib/boards/fetch.js";
import { listingFromPosting } from "../lib/jd.js";
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
  async execute(
    { boards, extraKeywords, cities, titles, attemptFetch },
    ctx,
  ) {
    const sessionId = ctx.session.id;
    const stored = (await ctx.host.kv.get(resumeProfileKey(sessionId))) as
      | ResumeProfile
      | undefined;

    const profile: ResumeProfile | undefined = stored
      ? stored
      : titles?.length || extraKeywords?.length
        ? {
            summary: "inline search criteria",
            targetTitles: titles ?? [],
            skills: extraKeywords ?? [],
            cities: cities ?? ["全国"],
            industries: [],
            strengths: [],
            gaps: [],
            keywords: extraKeywords ?? titles ?? [],
            updatedAt: new Date().toISOString(),
          }
        : undefined;

    if (!profile) {
      return {
        ok: false,
        message:
          "No resume profile yet. Save a resume, analyze it, then call save_resume_profile.",
      };
    }

    const selected = (boards ?? [
      "zhilian",
      "liepin",
      "job51",
      "boss",
    ]) as BoardId[];
    const criteria = criteriaFromProfile(profile);
    if (extraKeywords?.length) {
      criteria.keywords = [...new Set([...extraKeywords, ...criteria.keywords])];
    }
    if (cities?.length) criteria.cities = cities;
    if (titles?.length) criteria.titles = titles;

    const searchPacks = buildSearchPacks(criteria, selected);
    const skipFetch =
      attemptFetch === false ||
      (attemptFetch !== true &&
        (ctx.session.purpose === "eval" || ctx.session.dryRun === true));

    if (skipFetch) {
      return {
        ok: true,
        criteria,
        searchPacks,
        listings: [] as JobListing[],
        fetches: selected.map((board) => ({
          board,
          ok: false,
          reason: "skipped" as const,
          message:
            "这次没有访问招聘网站。把 JD 文本或岗位 URL 交给 score_job；要现场抓取请把 attemptFetch 设为 true。",
          listingCount: 0,
          detailErrors: [] as string[],
        })),
        applyHint:
          "搜索链接可以直接打开。抓到的岗位或用户贴的 JD 用 score_job 打分，再 queue_apply。",
      };
    }

    const reports = await Promise.all(
      selected.map((board) => fetchBoard(board, criteria)),
    );
    const listings = reports.flatMap((report) =>
      report.listings.flatMap((posting) => {
        try {
          return [listingFromPosting(posting, profile)];
        } catch {
          return [];
        }
      }),
    );
    if (listings.length > 0) {
      const existing =
        ((await ctx.host.kv.get(scoredJobsKey(sessionId))) as
          | JobListing[]
          | undefined) ?? [];
      await ctx.host.kv.put(
        scoredJobsKey(sessionId),
        upsertJobs(existing, listings),
      );
    }

    return {
      ok: true,
      criteria,
      searchPacks,
      listings,
      fetches: reports.map((report) => ({
        board: report.board,
        ok: report.ok,
        reason: report.reason,
        message: report.message,
        listingCount: report.listings.length,
        detailErrors: report.detailErrors,
      })),
      applyHint:
        "只使用 listings 里的真实岗位。抓取失败看 fetches[].message，不要编造 JD。选定后写打招呼语并 queue_apply。",
    };
  },
});
