import type { BoardSearchPack, SearchCriteria } from "./types.js";

/** City slugs that 猎聘 serves as server-rendered search pages. */
const CITY_SLUG: Record<string, string> = {
  北京: "bj",
  上海: "sh",
  广州: "gz",
  深圳: "sz",
  杭州: "hz",
  南京: "nj",
  成都: "cd",
  武汉: "wuhan",
  西安: "xian",
  苏州: "suzhou",
  天津: "tj",
  重庆: "cq",
  厦门: "xiamen",
  郑州: "zhengzhou",
  大连: "dl",
  济南: "jinan",
  宁波: "ningbo",
  无锡: "wuxi",
  青岛: "qingdao",
  沈阳: "shenyang",
};

/** Build a 猎聘 public search deep link. City pages include job cards in HTML. */
export function liepinSearch(criteria: SearchCriteria): BoardSearchPack {
  const query = pickQuery(criteria);
  const city = criteria.cities[0] ?? "全国";
  const params = new URLSearchParams();
  params.set("key", query);
  params.set("pubTime", "3");
  const slug = CITY_SLUG[city];
  const searchUrl = slug
    ? `https://www.liepin.com/city-${slug}/zhaopin/?${params.toString()}`
    : `https://www.liepin.com/zhaopin/?${params.toString()}`;
  return {
    board: "liepin",
    boardName: "猎聘",
    searchUrl,
    query,
    cityHint: city,
    notes: slug
      ? "城市搜索页通常直接带职位卡片。登录后再沟通；不要绕过验证码。"
      : "未映射到城市页时只能给关键词链接，列表可能要前端渲染后才看得到。",
  };
}

function pickQuery(criteria: SearchCriteria): string {
  return (
    criteria.titles[0] ||
    criteria.keywords.slice(0, 3).join(" ") ||
    "产品经理"
  );
}
