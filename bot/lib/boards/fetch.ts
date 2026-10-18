import type { BoardId, SearchCriteria } from "./types.js";
import { bossCityCode, bossSearch } from "./boss.js";
import { job51Search } from "./job51.js";
import { liepinSearch } from "./liepin.js";
import { zhilianSearch } from "./zhilian.js";
import { allowedJobUrl, type JobPosting } from "../jd.js";
import {
  parseBossApi,
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
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const MAX_LISTINGS = 5;
const MAX_DETAILS = 3;

const ZHILIAN_CITY_ID: Record<string, string> = {
  北京: "530",
  上海: "538",
  广州: "763",
  深圳: "765",
  杭州: "653",
  成都: "801",
  南京: "635",
  武汉: "736",
  西安: "854",
};

export function classifyFetch(input: {
  status: number;
  finalUrl: string;
  body: string;
}): { blocked: false } | { blocked: true; reason: FetchReason; message: string } {
  const body = input.body.slice(0, 20_000);
  const url = input.finalUrl;
  if (input.status === 401 || input.status === 403) {
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
      message: "页面要求登录后才能看岗位。不会代登录。",
    };
  }
  return { blocked: false };
}

type Fetched = {
  status: number;
  finalUrl: string;
  body: string;
  contentType: string;
};

async function fetchText(url: string): Promise<Fetched | { error: string }> {
  if (!allowedJobUrl(url)) {
    return { error: "只抓取智联、猎聘、51job、BOSS 的 https 页面。" };
  }
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
      headers: {
        "user-agent": UA,
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
      },
    });
    if (!allowedJobUrl(response.url)) {
      return { error: `重定向离开了招聘站：${response.url}` };
    }
    const bytes = await response.arrayBuffer();
    const body = new TextDecoder("utf-8").decode(bytes.slice(0, 2_000_000));
    return {
      status: response.status,
      finalUrl: response.url,
      body,
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

function searchPack(board: BoardId, criteria: SearchCriteria) {
  switch (board) {
    case "zhilian":
      return zhilianSearch(criteria);
    case "liepin":
      return liepinSearch(criteria);
    case "job51":
      return job51Search(criteria);
    case "boss":
      return bossSearch(criteria);
  }
}

export async function fetchBoard(
  board: BoardId,
  criteria: SearchCriteria,
): Promise<BoardFetchReport> {
  const pack = searchPack(board, criteria);
  const fetched = await fetchText(pack.searchUrl);
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
  if (!gate.blocked) {
    if (fetched.contentType.includes("json") || fetched.body.trim().startsWith("{")) {
      listings = jobsFromJson(board, fetched.body);
    }
    if (listings.length === 0) {
      listings = parseSearchHtml(board, fetched.body, fetched.finalUrl);
    }
  }
  let apiFailure: { reason: FetchReason; message: string } | undefined;
  if (listings.length === 0 && (board === "boss" || board === "zhilian")) {
    const api = await fetchJsonApi(board, criteria);
    if (api.ok) listings = api.jobs;
    else apiFailure = { reason: api.reason, message: api.message };
  }
  if (listings.length === 0) {
    if (gate.blocked) {
      return { board, ok: false, reason: gate.reason, message: gate.message, listings: [], detailErrors: [] };
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
  const sliced = listings.slice(0, MAX_LISTINGS);
  const { jobs, detailErrors } = await enrichDetails(board, sliced);
  return {
    board,
    ok: true,
    message: `解析到 ${jobs.length} 个岗位。`,
    listings: jobs,
    detailErrors,
  };
}

export async function fetchJobUrl(
  url: string,
  board: BoardId,
): Promise<{ ok: true; job: JobPosting } | { ok: false; reason: FetchReason; message: string }> {
  const fetched = await fetchText(url);
  if ("error" in fetched) {
    return { ok: false, reason: "network", message: `抓取岗位页失败：${fetched.error}` };
  }
  const gate = classifyFetch(fetched);
  if (gate.blocked) return { ok: false, reason: gate.reason, message: gate.message };
  const job = parseDetailHtml(board, fetched.body, fetched.finalUrl);
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
): Promise<{ jobs: JobPosting[]; detailErrors: string[] }> {
  const detailErrors: string[] = [];
  const jobs: JobPosting[] = [];
  for (const [index, listing] of listings.entries()) {
    if (index >= MAX_DETAILS || listing.jdStatus === "detail" || !listing.url) {
      jobs.push(listing);
      continue;
    }
    const detail = await fetchJobUrl(listing.url, board);
    if (!detail.ok) {
      detailErrors.push(`${listing.url}：${detail.message}`);
      jobs.push(listing);
      continue;
    }
    jobs.push({
      ...listing,
      ...detail.job,
      title: detail.job.title || listing.title,
      company: detail.job.company || listing.company,
      city: detail.job.city || listing.city,
      salary: detail.job.salary || listing.salary,
      experience: detail.job.experience || listing.experience,
      education: detail.job.education || listing.education,
      url: listing.url,
      jdStatus: "detail",
    });
  }
  return { jobs, detailErrors };
}

function jobsFromJson(board: BoardId, body: string): JobPosting[] {
  try {
    const payload = JSON.parse(body) as unknown;
    if (board === "boss") {
      const parsed = parseBossApi(payload);
      return parsed.ok ? parsed.jobs : [];
    }
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
  const url =
    board === "boss"
      ? bossApiUrl(query, city)
      : zhilianApiUrl(query, city);
  const fetched = await fetchText(url);
  if ("error" in fetched) {
    return { ok: false, reason: "network", message: fetched.error };
  }
  const gate = classifyFetch(fetched);
  if (gate.blocked) return { ok: false, reason: gate.reason, message: gate.message };
  try {
    const payload = JSON.parse(fetched.body) as unknown;
    return board === "boss" ? parseBossApi(payload) : parseZhilianApi(payload);
  } catch {
    return { ok: false, reason: "parse_error", message: "公开接口返回的不是 JSON。" };
  }
}

function bossApiUrl(query: string, city: string): string {
  const params = new URLSearchParams();
  params.set("scene", "1");
  params.set("query", query);
  params.set("page", "1");
  params.set("pageSize", "15");
  const code = bossCityCode(city);
  if (code) params.set("city", code);
  return `https://www.zhipin.com/wapi/zpgeek/search/joblist.json?${params.toString()}`;
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

