import type { BoardSearchPack, SearchCriteria } from "./types.js";

/** Build a 前程无忧 / 51job public search deep link from criteria. */
export function job51Search(criteria: SearchCriteria): BoardSearchPack {
  const query = pickQuery(criteria);
  const city = criteria.cities[0] ?? "全国";
  const params = new URLSearchParams();
  params.set("keyword", query);
  if (city !== "全国") params.set("jobArea", city);
  const searchUrl = `https://we.51job.com/pc/search?${params.toString()}`;
  return {
    board: "job51",
    boardName: "前程无忧(51job)",
    searchUrl,
    query,
    cityHint: city,
    notes: "打开链接后请登录 51job。搜索页经常被 WAF 拦住；抓不到时请改贴 JD，不要绕过校验。",
  };
}

function pickQuery(criteria: SearchCriteria): string {
  return (
    criteria.titles[0] ||
    criteria.keywords.slice(0, 3).join(" ") ||
    "Java"
  );
}
