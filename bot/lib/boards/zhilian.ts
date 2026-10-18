import type { BoardSearchPack, SearchCriteria } from "./types.js";

/** Build a 智联招聘 public search deep link from criteria. */
export function zhilianSearch(criteria: SearchCriteria): BoardSearchPack {
  const query = pickQuery(criteria);
  const city = criteria.cities[0] ?? "全国";
  const params = new URLSearchParams();
  params.set("kw", query);
  if (city !== "全国") params.set("jl", city);
  const searchUrl = `https://sou.zhaopin.com/?${params.toString()}`;
  return {
    board: "zhilian",
    boardName: "智联招聘",
    searchUrl,
    query,
    cityHint: city,
    notes: "打开链接后请登录智联账号，按筛选条件核对岗位再投递。",
  };
}

function pickQuery(criteria: SearchCriteria): string {
  return (
    criteria.titles[0] ||
    criteria.keywords.slice(0, 3).join(" ") ||
    "软件工程师"
  );
}
