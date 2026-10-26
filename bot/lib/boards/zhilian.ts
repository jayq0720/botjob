import type { BoardSearchPack, SearchCriteria } from "./types.js";

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
  const cityId = ZHILIAN_CITY_ID[city.replace(/市$/, "")];
  if (cityId) params.set("jl", cityId);
  const searchUrl = `https://sou.zhaopin.com/?${params.toString()}`;
  return {
    board: "zhilian",
    boardName: "智联招聘",
    searchUrl,
    query,
    cityHint: city,
    notes:
      (city !== "全国" && !cityId ? "城市编码未配置，请在网站上选择城市。" : "") +
      "搜索页有时能直接看到职位。遇到验证码请改贴 JD，不要绕过校验。未登录时详情页薪资可能被打码。",
  };
}

function pickQuery(criteria: SearchCriteria): string {
  return (
    criteria.titles[0] ||
    criteria.keywords.slice(0, 3).join(" ") ||
    "软件工程师"
  );
}
