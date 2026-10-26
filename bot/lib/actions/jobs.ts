import { browserAccess } from "../boards/browser.js";
import { SEARCH_MAX_AGE_DAYS } from "../boards/freshness.js";
import { SUPPORTED_BOARDS } from "../boards/types.js";
import { fetchBoard, fetchJobUrl, fetchText, type BoardFetchReport } from "../boards/fetch.js";
import { activeCooldowns, COOLDOWN_MS, detailCache, paced, recordCooldowns, type SiteCooldown } from "../boards/pace.js";
import { buildSearchPacks, criteriaFromProfile, type BoardId } from "../boards/index.js";
import { parseDetailHtml } from "../boards/parse.js";
import { allowedJobUrl, boardFromUrl, jobUrlAllowed, listingFromPosting, parsePastedJd } from "../jd.js";
import { upsertJobs } from "../job-state.js";
import { scoreJob as scoreAgainstProfile } from "../score.js";
import type { ActionContext } from "../state-store.js";
import { resumeProfileKey, scoredJobsKey, type JobListing, type ResumeProfile } from "../store.js";

const BOARD_NAMES: Record<BoardId, string> = { zhilian: "智联", liepin: "猎聘", job51: "前程无忧" };

/** A site that recently showed a captcha or block is left alone until the user handles it and asks to retry. */
function cooldownReport(board: BoardId, cooling: SiteCooldown): BoardFetchReport {
  const minutes = Math.max(1, Math.ceil((cooling.until - Date.now()) / 60_000));
  const message = `${BOARD_NAMES[board]}刚才出现${cooling.reason === "captcha" ? "验证码或滑块验证" : "访问拦截"}，${minutes} 分钟内不再自动访问该站。请用户在 botjob 浏览器窗口里自己完成验证；用户明确要求重试时再带 retryBlocked=true 搜索。`;
  return { board, ok: false, reason: cooling.reason, message, listings: [], detailErrors: [],
    userActions: [{ board, reason: cooling.reason, url: cooling.url, message }] };
}

const LIEPIN_PUBLIC_NOTE = "猎聘在 botjob 浏览器窗口里会被站点脚本清空页面，本次改用未登录的公开页面读取猎聘。";

export type SearchJobsInput = {
  boards?: BoardId[];
  extraKeywords?: string[];
  cities?: string[];
  titles?: string[];
  attemptFetch?: boolean;
  accessMode?: "public" | "browser";
  limitPerBoard?: number;
  /** The user handled a captcha or block in the window and asked to search that site again before the 30-minute cool-down ends. */
  retryBlocked?: boolean;
};

export async function searchJobs(ctx: ActionContext, input: SearchJobsInput) {
  const { boards, extraKeywords, cities, titles, attemptFetch } = input;
  const stored = (await ctx.store.get(resumeProfileKey(ctx.sessionId))) as
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

  const selected = [...new Set(boards?.length ? boards : SUPPORTED_BOARDS)];
  if (selected.some((board) => !SUPPORTED_BOARDS.includes(board))) {
    throw new Error("仅支持智联和猎聘。");
  }
  const criteria = criteriaFromProfile(profile);
  if (extraKeywords?.length) {
    criteria.keywords = [...new Set([...extraKeywords, ...criteria.keywords])];
  }
  if (cities?.length) criteria.cities = cities;
  if (titles?.length) criteria.titles = titles;

  const searchPacks = buildSearchPacks(criteria, selected);
  const skipFetch = attemptFetch === false || (attemptFetch !== true && ctx.offline);

  if (skipFetch) {
    return {
      ok: true,
      criteria,
      searchPacks,
      maxAgeDays: SEARCH_MAX_AGE_DAYS,
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

  // Boards one after another, each paced to one page at a time; detail pages come from a 24 h cache when possible.
  const cooldowns = await activeCooldowns(ctx.store, ctx.sessionId);
  const cache = detailCache(ctx.store);
  const reports: BoardFetchReport[] = [];
  const cooldownChanges: Partial<Record<BoardId, SiteCooldown | null>> = {};
  for (const board of selected) {
    const cooling = cooldowns[board];
    if (cooling && !input.retryBlocked) {
      reports.push(cooldownReport(board, cooling));
      continue;
    }
    // 猎聘's page script blanks itself in an automated browser window, so 猎聘 always uses public pages.
    const browser = input.accessMode === "browser" && board !== "liepin";
    const read = paced(board, browser ? browserAccess.reader(board) : fetchText);
    const report = await fetchBoard(board, criteria, { read, browser, limit: input.limitPerBoard, cache });
    const stop = [{ reason: report.reason, url: "" }, ...(report.userActions ?? [])].find(item => item.reason === "captcha" || item.reason === "blocked");
    cooldownChanges[board] = stop ? { until: Date.now() + COOLDOWN_MS, reason: stop.reason as SiteCooldown["reason"], url: stop.url || searchPacks.find(pack => pack.board === board)?.searchUrl || "" } : null;
    reports.push(input.accessMode === "browser" && board === "liepin" ? { ...report, message: `${LIEPIN_PUBLIC_NOTE}${report.message}` } : report);
  }
  await recordCooldowns(ctx.store, ctx.sessionId, cooldownChanges);
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
    await remember(ctx, listings);
  }

  return {
    ok: true,
    criteria,
    searchPacks,
    maxAgeDays: SEARCH_MAX_AGE_DAYS,
    listings,
    pendingEmployerReview: reports.flatMap(report => report.pendingEmployerReview ?? []),
    userActions: reports.flatMap(report => report.userActions ?? []),
    employerPolicy: { excluded: ["insurance", "labor_dispatch"], reviewRequired: "needs_review 的公司性质须核实后再向用户推荐；证据不足则暂不推荐。" },
    fetches: reports.map((report) => ({
      board: report.board,
      ok: report.ok,
      reason: report.reason,
      message: report.message,
      listingCount: report.listings.length,
      detailErrors: report.detailErrors,
      detailFailures: report.detailFailures,
      diagnostics: report.diagnostics,
      freshness: report.freshness,
      excludedEmployers: report.excludedEmployers,
      pendingEmployerReviewCount: report.pendingEmployerReview?.length ?? 0,
      userActions: report.userActions,
      limits: report.limits,
    })),
    applyHint:
      "只使用 listings 里的真实岗位。抓取失败看 fetches[].message，不要编造 JD。选定后写打招呼语并 queue_apply。",
  };
}

export type ScoreJobInput = {
  text?: string;
  html?: string;
  url?: string;
  board?: BoardId;
  title?: string;
  company?: string;
  city?: string;
  salary?: string;
  experience?: string;
  education?: string;
};

export async function scoreJob(ctx: ActionContext, input: ScoreJobInput) {
  if (input.board && !SUPPORTED_BOARDS.includes(input.board)) throw new Error("仅支持智联和猎聘。");
  const profile = (await ctx.store.get(resumeProfileKey(ctx.sessionId))) as
    | ResumeProfile
    | undefined;
  if (!profile) {
    return {
      ok: false as const,
      message: "No resume profile yet. Call save_resume_profile before scoring.",
    };
  }

  const url = input.url?.trim();
  const html = input.html?.trim();
  const fromHost = url ? boardFromUrl(url) : undefined;
  const board = (fromHost ?? input.board) as BoardId | undefined;
  if ((url || html) && url && !allowedJobUrl(url)) {
    return {
      ok: false as const,
      reason: "skipped" as const,
      message: "只抓取智联、猎聘 的 https 岗位页。其它链接请把 JD 正文贴到 text。",
    };
  }
  if (html && !url) {
    return {
      ok: false as const,
      message: "解析 HTML 时请同时提供该岗位的 https 链接，且域名要和 board 一致。",
    };
  }
  if (!board) {
    return {
      ok: false as const,
      message: "贴 JD 文本时请指定 board：zhilian、liepin 或 job51。",
    };
  }

  if (html && url) {
    if (!jobUrlAllowed(url, board)) {
      return {
        ok: false as const,
        message: "岗位链接必须是该 board 对应站点的 https 地址。",
      };
    }
    const posting = parseDetailHtml(board, html, url);
    if (!posting) {
      return {
        ok: false as const,
        message: "这份 HTML 里没有解析出完整岗位（标题、正文或合规链接缺失）。",
      };
    }
    return scorePosting(ctx, profile, posting, input);
  }

  let fetchError: string | undefined;
  const cooling = url && !ctx.offline ? (await activeCooldowns(ctx.store, ctx.sessionId))[board] : undefined;
  if (cooling) {
    fetchError = cooldownReport(board, cooling).message;
    if (!input.text?.trim()) return { ok: false as const, reason: cooling.reason, message: `${fetchError}也可以直接把 JD 正文贴给我打分。` };
  } else if (url && !ctx.offline) {
    const fetched = await fetchJobUrl(url, board, Date.now(), paced(board, fetchText));
    if (fetched.ok) {
      return scorePosting(ctx, profile, fetched.job, input);
    }
    fetchError = fetched.message;
    if (!input.text?.trim()) {
      return { ok: false as const, reason: fetched.reason, message: fetched.message };
    }
  } else if (url && ctx.offline && !input.text?.trim()) {
    return {
      ok: false as const,
      reason: "skipped" as const,
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
  if (!parsed.ok) return { ok: false as const, message: parsed.message };
  if (!parsed.job.url) {
    return {
      ok: true as const,
      stored: false as const,
      job: undefined,
      score: scoreAgainstProfile(profile, parsed.job),
      message: "已打分。没有岗位链接，未写入可投递记录。",
    };
  }
  if (!jobUrlAllowed(parsed.job.url, parsed.job.board)) {
    return {
      ok: false as const,
      message: "岗位链接必须是该 board 对应站点的 https 地址。",
    };
  }
  return scorePosting(ctx, profile, parsed.job, {}, fetchError);
}

/** All parsed sources share scoring and one atomic persistence path. */
async function scorePosting(
  ctx: ActionContext,
  profile: ResumeProfile,
  posting: Parameters<typeof listingFromPosting>[0],
  overrides: ScoreJobInput,
  fetchError?: string,
) {
  const job = listingFromPosting({
    ...posting,
    title: overrides.title?.trim() || posting.title,
    company: overrides.company?.trim() || posting.company,
    city: overrides.city?.trim() || posting.city,
    salary: overrides.salary?.trim() || posting.salary,
    experience: overrides.experience?.trim() || posting.experience,
    education: overrides.education?.trim() || posting.education,
  }, profile);
  await remember(ctx, [job]);
  return {
    ok: true as const,
    job,
    score: job.score,
    fetchError,
    next: "按 job-hunt skill 写 150 字内打招呼语和求职信，调用 save_cover_letter，再 queue_apply。",
  };
}

async function remember(ctx: ActionContext, jobs: JobListing[]): Promise<void> {
  await ctx.store.update(scoredJobsKey(ctx.sessionId), (current) => {
    const existing = (current as JobListing[] | undefined) ?? [];
    return { value: upsertJobs(existing, jobs), result: undefined };
  });
}
