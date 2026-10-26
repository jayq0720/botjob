import type { BoardSearchPack, SearchCriteria } from "./types.js";

/** 前程无忧 jobArea codes. */
export const JOB51_AREA: Record<string, string> = {
  北京: "010000",
  上海: "020000",
  广州: "030200",
  深圳: "040000",
  天津: "050000",
  重庆: "060000",
  南京: "070200",
  苏州: "070300",
  杭州: "080200",
  宁波: "080300",
  成都: "090200",
  武汉: "180200",
  西安: "200200",
  厦门: "110300",
  郑州: "170200",
  长沙: "190200",
};

/** Build a 前程无忧 search deep link. The result list renders in the browser, so it needs accessMode=browser. */
export function job51Search(criteria: SearchCriteria): BoardSearchPack {
  const query = criteria.titles[0] || criteria.keywords.slice(0, 3).join(" ") || "人力资源";
  const city = criteria.cities[0] ?? "全国";
  const area = JOB51_AREA[city.replace(/市$/, "")];
  const params = new URLSearchParams({ keyword: query, searchType: "2", sortType: "0" });
  if (area) params.set("jobArea", area);
  return {
    board: "job51",
    boardName: "前程无忧",
    searchUrl: `https://we.51job.com/pc/search?${params.toString()}`,
    query,
    cityHint: city,
    notes: (city !== "全国" && !area ? "城市编码未配置，请在网站上选择城市。" : "") +
      "搜索结果由页面脚本加载，需用 accessMode=browser 读取；遇到滑块验证请在窗口里手动完成。",
  };
}
