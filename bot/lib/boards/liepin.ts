import type { BoardSearchPack, SearchCriteria } from "./types.js";

/** Build a 猎聘 public search deep link from criteria. */
export function liepinSearch(criteria: SearchCriteria): BoardSearchPack {
  const query = pickQuery(criteria);
  const city = criteria.cities[0] ?? "全国";
  const params = new URLSearchParams();
  params.set("key", query);
  if (city !== "全国") params.set("city", city);
  const searchUrl = `https://www.liepin.com/zhaopin/?${params.toString()}`;
  return {
    board: "liepin",
    boardName: "猎聘",
    searchUrl,
    query,
    cityHint: city,
    notes: "打开链接后请登录猎聘账号；中高端岗位建议先看 JD 匹配度再投。",
  };
}

function pickQuery(criteria: SearchCriteria): string {
  return (
    criteria.titles[0] ||
    criteria.keywords.slice(0, 3).join(" ") ||
    "产品经理"
  );
}
