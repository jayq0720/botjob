import type { BoardSearchPack, SearchCriteria } from "./types.js";

const BOSS_CITY_CODE: Record<string, string> = {
  全国: "100010000",
  北京: "101010100",
  上海: "101020100",
  广州: "101280100",
  深圳: "101280600",
  杭州: "101210100",
  成都: "101270100",
  南京: "101190100",
  武汉: "101200100",
  西安: "101110100",
  苏州: "101190400",
  天津: "101030100",
  重庆: "101040100",
  长沙: "101250100",
  郑州: "101180100",
  青岛: "101120200",
  厦门: "101230200",
  合肥: "101220100",
};

export function bossCityCode(city: string): string | undefined {
  return BOSS_CITY_CODE[city];
}

/** Build a BOSS直聘 public search deep link. Applying stays semi-automatic. */
export function bossSearch(criteria: SearchCriteria): BoardSearchPack {
  const query = pickQuery(criteria);
  const city = criteria.cities[0] ?? "全国";
  const params = new URLSearchParams();
  params.set("query", query);
  const code = bossCityCode(city);
  if (code) params.set("city", code);
  return {
    board: "boss",
    boardName: "BOSS直聘",
    searchUrl: `https://www.zhipin.com/web/geek/job?${params.toString()}`,
    query,
    cityHint: city,
    notes:
      "BOSS 以「立即沟通」为主。公开列表经常被安全校验拦住；打开链接后用你自己的账号，发送打招呼语前必须人工确认。",
  };
}

function pickQuery(criteria: SearchCriteria): string {
  return (
    criteria.titles[0] ||
    criteria.keywords.slice(0, 3).join(" ") ||
    "前端工程师"
  );
}
