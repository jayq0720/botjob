import { excludedEmployer, employerReview } from "./employers.js";
import { freshness, SEARCH_MAX_AGE_MS } from "./freshness.js";
import { configureEnvironmentProxy, networkErrorMessage } from "../network.js";
import type { BoardId, SearchCriteria } from "./types.js";
import { liepinSearch } from "./liepin.js";
import { zhilianSearch, ZHILIAN_CITY_ID } from "./zhilian.js";
import { allowedJobUrl, type JobPosting } from "../jd.js";
import {
  parseDetailHtml,
  parseSearchHtml,
  parseZhilianApi,
} from "./parse.js";

export type FetchReason =
  | "network"
  | "http_error"
  | "login_required"
  | "captcha"
  | "blocked"
  | "empty"
  | "parse_error"
  | "skipped";

export type BoardFetchReport = {
  board: BoardId;
  ok: boolean;
  reason?: FetchReason;
  message: string;
  listings: JobPosting[];
  detailErrors: string[];
  pendingEmployerReview?: JobPosting[];
  excludedEmployers?: { insurance: number; labor_dispatch: number };
  userActions?: Array<{ board: BoardId; reason: FetchReason; url: string; message: string }>;
  limits?: { maxListings: number; maxCandidates: number; maxDetails: number; truncated: boolean };
  freshness?: { maxAgeDays: 3; checkedAt: string; since: string; excludedOld: number; excludedUnknown: number };
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MAX_LISTINGS = 5;
const MAX_DETAILS = 5;
const MAX_CANDIDATES = 20;
const MAX_REDIRECTS = 5;
/** Same cap the old buffered read used, in decimal bytes. */
const MAX_BODY_BYTES = 2_000_000;

export function classifyFetch(input: {
  status: number;
  finalUrl: string;
  body: string;
}): { blocked: false } | { blocked: true; reason: FetchReason; message: string } {
  const body = input.body.slice(0, 20_000);
  const url = input.finalUrl;
  const visibleText = input.body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, "");
  if (input.status === 401 || /(?:登录|登陆)后(?:即可|可以|可|才能)?(?:查看|浏览|解锁|获取)(?:更多|全部|完整)?(?:职位|岗位|招聘|内容|信息)/.test(visibleText)) {
    return { blocked: true, reason: "login_required", message: "需要登录才能查看更多岗位。请先登录自己的账号，完成后继续搜索。" };
  }
  if (input.status === 403) {
    return {
      blocked: true,
      reason: "blocked",
      message: `HTTP ${input.status}，站点拒绝公开读取。`,
    };
  }
  if (input.status >= 400) {
    return {
      blocked: true,
      reason: "http_error",
      message: `HTTP ${input.status}，没有拿到岗位页面。`,
    };
  }
  if (/security\.html|passport\/zp\/security/i.test(url) || /page-security/.test(body)) {
    return {
      blocked: true,
      reason: "blocked",
      message: "跳转到安全校验页。不会代为通过校验或登录。",
    };
  }
  if (
    /Security Verification|TencentEOCaptcha|TEOCaptcha|aliyun_waf|请勾选下方复选框/i.test(
      body,
    )
  ) {
    return {
      blocked: true,
      reason: "captcha",
      message: "页面要求人机验证或验证码。不会代为勾选或绕过。",
    };
  }
  if (/您的环境存在异常|访问行为异常|环境异常/.test(body)) {
    return {
      blocked: true,
      reason: "blocked",
      message: "站点返回环境异常，公开抓取被拦截。",
    };
  }
  if (/\/login|passport/i.test(url) && /登录/.test(body)) {
    return {
      blocked: true,
      reason: "login_required",
      message: "页面要求登录后才能看岗位。请登录自己的账号后继续搜索。",
    };
  }
  return { blocked: false };
}

export type Fetched = {
  status: number;
  finalUrl: string;
  body: string;
  contentType: string;
};

export type PageReader = (url: string) => Promise<Fetched | { error: string }>;

const FETCH_HEADERS = {
  "user-agent": UA,
  accept: "text/html,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
};

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function declaredLength(response: Response): number | undefined {
  const raw = response.headers.get("content-length")?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
}

async function cancelBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

async function readLimitedBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (total + value.byteLength > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("响应体超过 2MB，已中止读取。");
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

/** Fetch one allowlisted https URL. Redirects are checked one hop at a time. */
export async function fetchText(url: string): Promise<Fetched | { error: string }> {
  if (!allowedJobUrl(url)) {
    return { error: "只抓取智联、猎聘 的 https 页面。" };
  }
  let current = url;
  try {
    configureEnvironmentProxy();
    for (let redirects = 0; ; redirects++) {
      const response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(12_000),
        headers: FETCH_HEADERS,
      });
      if (isRedirect(response.status)) {
        await cancelBody(response);
        if (redirects >= MAX_REDIRECTS) return { error: "重定向超过 5 跳。" };
        const location = response.headers.get("location");
        if (!location) return { error: "重定向没有 Location。" };
        let next: string;
        try {
          next = new URL(location, current).href;
        } catch {
          return { error: "重定向 Location 不是合法 URL。" };
        }
        if (!allowedJobUrl(next)) return { error: `重定向离开了招聘站：${next}` };
        current = next;
        continue;
      }
      const length = declaredLength(response);
      if (length !== undefined && length > MAX_BODY_BYTES) {
        await cancelBody(response);
        return { error: `响应体超过 2MB（Content-Length: ${length}）。` };
      }
      const body = await readLimitedBody(response);
      return {
        status: response.status,
        finalUrl: current,
        body,
        contentType: response.headers.get("content-type") ?? "",
      };
    }
  } catch (err) {
    return { error: networkErrorMessage(err) };
  }
}

function searchPack(board: BoardId, criteria: SearchCriteria) {
  switch (board) {
    case "zhilian":
      return zhilianSearch(criteria);
    case "liepin":
      return liepinSearch(criteria);
    default:
      throw new Error("仅支持智联和猎聘。");
  }
}

export async function fetchBoard(
  board: BoardId,
  criteria: SearchCriteria,
  options: { read?: PageReader; limit?: number } = {},
): Promise<BoardFetchReport> {
  const read = options.read ?? fetchText;
  const limit = Math.max(1, Math.min(20, options.limit ?? MAX_LISTINGS));
  const now = Date.now();
  const pack = searchPack(board, criteria);
  const fetched = await read(pack.searchUrl);
  if ("error" in fetched) {
    return {
      board,
      ok: false,
      reason: "network",
      message: `抓取搜索页失败：${fetched.error}`,
      listings: [],
      detailErrors: [],
    };
  }
  const gate = classifyFetch(fetched);
  let listings: JobPosting[] = [];
  const userActions: NonNullable<BoardFetchReport["userActions"]> = gate.blocked && ["login_required", "captcha", "blocked"].includes(gate.reason)
    ? [{ board, reason: gate.reason, url: pack.searchUrl, message: gate.message }] : [];
  if (!gate.blocked || gate.reason === "login_required") {
    if (fetched.contentType.includes("json") || fetched.body.trim().startsWith("{")) {
      listings = jobsFromJson(board, fetched.body);
    }
    if (listings.length === 0) {
      listings = parseSearchHtml(board, fetched.body, fetched.finalUrl, now);
    }
  }
  let apiFailure: { reason: FetchReason; message: string } | undefined;
  if (listings.length === 0 && board === "zhilian" && !gate.blocked && !options.read) {
    const api = await fetchJsonApi(board, criteria);
    if (api.ok) listings = api.jobs;
    else apiFailure = { reason: api.reason, message: api.message };
  }
  if (listings.length === 0) {
    if (gate.blocked) {
      return { board, ok: false, reason: gate.reason, message: gate.message, listings: [], detailErrors: [], userActions };
    }
    if (
      apiFailure?.reason === "empty" &&
      /jobinfo__name|job-card-pc-container|job-card-wrapper/.test(fetched.body)
    ) {
      return {
        board,
        ok: false,
        reason: "parse_error",
        message: "搜索页里有职位标记，但没有解析出岗位。页面结构可能已变。",
        listings: [],
        detailErrors: [],
      };
    }
    if (apiFailure) {
      return { board, ok: false, reason: apiFailure.reason, message: apiFailure.message, listings: [], detailErrors: [] };
    }
    return {
      board,
      ok: false,
      reason: "parse_error",
      message: "搜索页 HTML 里没有职位卡片。页面可能是前端渲染空壳，或结构已变。",
      listings: [],
      detailErrors: [],
    };
  }
  const candidates = listings.slice(0, MAX_CANDIDATES);
  const knownOld = candidates.filter((job) => freshness(job, now) === "old").length;
  const excludedEmployers = { insurance: 0, labor_dispatch: 0 };
  const allowEmployer = (job: JobPosting) => {
    const reason = excludedEmployer(job);
    if (reason) excludedEmployers[reason]++;
    return !reason;
  };
  const eligible = candidates.filter((job) => freshness(job, now) !== "old").filter(allowEmployer);
  const detailBudget = gate.blocked ? 0 : Math.max(MAX_DETAILS, limit);
  const { jobs: enriched, detailErrors, userActions: detailActions } = await enrichDetails(board, eligible, now, read, detailBudget);
  const jobs = enriched.filter(allowEmployer);
  const timely = jobs.filter((job) => freshness(job, now) === "recent")
    .sort((a, b) => Date.parse(b.sourceUpdatedAt!) - Date.parse(a.sourceUpdatedAt!))
    .map(job => ({ ...job, employerReview: employerReview(job) }));
  const pendingEmployerReview = timely.filter(job => job.employerReview === "needs_review");
  const recent = timely.filter(job => job.employerReview !== "needs_review").slice(0, limit);
  const excludedOld = knownOld + jobs.filter((job) => freshness(job, now) === "old").length;
  const excludedUnknown = jobs.filter((job) => freshness(job, now) === "unknown").length;
  return {
    board,
    ok: recent.length > 0,
    reason: recent.length ? undefined : "empty",
    message: `最近72小时内可确认发布或更新的岗位 ${recent.length} 个；排除过期 ${excludedOld} 个、时间无法确认 ${excludedUnknown} 个；剔除保险公司 ${excludedEmployers.insurance} 个、劳务派遣公司 ${excludedEmployers.labor_dispatch} 个；公司性质待核实 ${pendingEmployerReview.length} 个，暂不推荐。`,
    listings: recent,
    detailErrors,
    excludedEmployers,
    pendingEmployerReview,
    userActions: [...userActions, ...detailActions],
    limits: { maxListings: limit, maxCandidates: MAX_CANDIDATES, maxDetails: detailBudget, truncated: listings.length > MAX_CANDIDATES || jobs.filter(job => freshness(job, now) === "recent").length > limit },
    freshness: { maxAgeDays: 3, checkedAt: new Date(now).toISOString(),
      since: new Date(now - SEARCH_MAX_AGE_MS).toISOString(), excludedOld, excludedUnknown },
  };
}

export async function fetchJobUrl(
  url: string,
  board: BoardId,
  now = Date.now(),
  read: PageReader = fetchText,
): Promise<{ ok: true; job: JobPosting } | { ok: false; reason: FetchReason; message: string }> {
  const fetched = await read(url);
  if ("error" in fetched) {
    return { ok: false, reason: "network", message: `抓取岗位页失败：${fetched.error}` };
  }
  const gate = classifyFetch(fetched);
  if (gate.blocked) return { ok: false, reason: gate.reason, message: gate.message };
  const job = parseDetailHtml(board, fetched.body, fetched.finalUrl, now);
  if (!job || job.description.length < 20) {
    return {
      ok: false,
      reason: "parse_error",
      message: "岗位页没有解析出职位名和 JD 正文。可能需要登录，或页面结构已变。",
    };
  }
  return { ok: true, job };
}

async function enrichDetails(
  board: BoardId,
  listings: JobPosting[],
  now: number,
  read: PageReader,
  maxDetails: number,
): Promise<{ jobs: JobPosting[]; detailErrors: string[]; userActions: NonNullable<BoardFetchReport["userActions"]> }> {
  const userActions: NonNullable<BoardFetchReport["userActions"]> = [];
  const detailErrors: string[] = [];
  const jobs: JobPosting[] = [];
  for (const [index, listing] of listings.entries()) {
    if (index >= maxDetails || listing.jdStatus === "detail" || !listing.url) {
      jobs.push(listing);
      continue;
    }
    const detail = await fetchJobUrl(listing.url, board, now, read);
    if (!detail.ok) {
      detailErrors.push(`${listing.url}：${detail.message}`);
      if (["login_required", "captcha", "blocked"].includes(detail.reason)) userActions.push({ board, reason: detail.reason, url: listing.url, message: detail.message });
      jobs.push(listing);
      if (["login_required", "captcha", "blocked"].includes(detail.reason)) {
        jobs.push(...listings.slice(index + 1));
        break;
      }
      continue;
    }
    jobs.push({
      ...listing,
      ...detail.job,
      title: detail.job.title || listing.title,
      company: detail.job.company && detail.job.company !== "（未提供）" ? detail.job.company : listing.company,
      companyIndustry: detail.job.companyIndustry || listing.companyIndustry,
      city: detail.job.city || listing.city,
      salary: detail.job.salary || listing.salary,
      experience: detail.job.experience || listing.experience,
      education: detail.job.education || listing.education,
      sourceUpdatedAt: detail.job.sourceTimeText ? detail.job.sourceUpdatedAt : listing.sourceUpdatedAt,
      sourceTimeText: detail.job.sourceTimeText || listing.sourceTimeText,
      sourceTimeKind: detail.job.sourceTimeKind || listing.sourceTimeKind,
      url: listing.url,
      jdStatus: "detail",
    });
  }
  return { jobs, detailErrors, userActions };
}

function jobsFromJson(board: BoardId, body: string): JobPosting[] {
  try {
    const payload = JSON.parse(body) as unknown;
    if (board === "zhilian") {
      const parsed = parseZhilianApi(payload);
      return parsed.ok ? parsed.jobs : [];
    }
  } catch {
    return [];
  }
  return [];
}

async function fetchJsonApi(
  board: BoardId,
  criteria: SearchCriteria,
): Promise<
  | { ok: true; jobs: JobPosting[] }
  | { ok: false; reason: FetchReason; message: string }
> {
  const query = criteria.titles[0] || criteria.keywords[0] || "";
  const city = criteria.cities[0] ?? "全国";
  const url = zhilianApiUrl(query, city);
  const fetched = await fetchText(url);
  if ("error" in fetched) {
    return { ok: false, reason: "network", message: fetched.error };
  }
  const gate = classifyFetch(fetched);
  if (gate.blocked) return { ok: false, reason: gate.reason, message: gate.message };
  try {
    const payload = JSON.parse(fetched.body) as unknown;
    return parseZhilianApi(payload);
  } catch {
    return { ok: false, reason: "parse_error", message: "公开接口返回的不是 JSON。" };
  }
}

function zhilianApiUrl(query: string, city: string): string {
  const params = new URLSearchParams();
  params.set("pageSize", "20");
  params.set("kw", query);
  params.set("kt", "3");
  const cityId = ZHILIAN_CITY_ID[city];
  if (cityId) params.set("cityId", cityId);
  return `https://fe-api.zhaopin.com/c/i/sou?${params.toString()}`;
}

