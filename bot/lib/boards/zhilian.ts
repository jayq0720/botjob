import type { BoardSearchPack, SearchCriteria } from "./types.js";

/** 智联公开搜索的城市 id。`jl=上海` 会落到全国混排。 */
export const ZHILIAN_CITY_ID: Record<string, string> = {
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

/** Build a 智联招聘 public search deep link from criteria. */
export function zhilianSearch(criteria: SearchCriteria): BoardSearchPack {
  const query = pickQuery(criteria);
  const city = criteria.cities[0] ?? "全国";
  const params = new URLSearchParams();
  params.set("kw", query);
  if (city !== "全国") params.set("jl", ZHILIAN_CITY_ID[city] ?? city);
  const searchUrl = `https://sou.zhaopin.com/?${params.toString()}`;
  return {
    board: "zhilian",
    boardName: "智联招聘",
    searchUrl,
    query,
    cityHint: city,
    notes: "搜索页有时能直接看到职位。遇到验证码请改贴 JD，不要绕过校验。未登录时详情页薪资可能被打码。",
  };
}

export type ZhilianListingFields = {
  title: string;
  city: string;
  description?: string;
};

/**
 * Drop listings outside the requested city or with no keyword overlap.
 * "高级前端工程师" keeps 前端; seniority and 工程师/开发 are not required tokens.
 */
export function filterZhilianListings<T extends ZhilianListingFields>(
  listings: T[],
  criteria: SearchCriteria,
): T[] {
  const city = (criteria.cities[0] ?? "").trim();
  const query = criteria.titles[0] || criteria.keywords[0] || "";
  const tokens = keywordTokens(query);
  return listings.filter((job) => cityMatches(job.city, city) && keywordMatches(job, tokens));
}

export function keywordTokens(query: string): string[] {
  const stripped = query
    .replace(/高级|资深|中级|初级|实习|专家/g, " ")
    .replace(/工程师|开发/g, " ")
    .trim();
  const parts = stripped
    .split(/[\s,，/]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
  if (parts.length > 0) return parts;
  const whole = query.trim();
  return whole.length >= 2 ? [whole] : [];
}

function cityMatches(jobCity: string, city: string): boolean {
  if (!city || city === "全国") return true;
  const needle = city.replace(/市$/, "");
  const value = jobCity.trim();
  if (!value) return false;
  return value.includes(needle);
}

function keywordMatches(job: ZhilianListingFields, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = `${job.title} ${job.description ?? ""}`;
  return tokens.some((token) =>
    /[a-z]/i.test(token) ? hay.toLowerCase().includes(token.toLowerCase()) : hay.includes(token),
  );
}

function pickQuery(criteria: SearchCriteria): string {
  return (
    criteria.titles[0] ||
    criteria.keywords.slice(0, 3).join(" ") ||
    "软件工程师"
  );
}
