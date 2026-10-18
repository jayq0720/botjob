import { job51Search } from "./job51.js";
import { liepinSearch } from "./liepin.js";
import { zhilianSearch } from "./zhilian.js";
import type { BoardId, BoardSearchPack, SearchCriteria } from "./types.js";
import type { JobListing, ResumeProfile } from "../store.js";

export type { BoardId, BoardSearchPack, SearchCriteria };

const ALL_BOARDS: BoardId[] = ["zhilian", "liepin", "job51"];

export function buildSearchPacks(
  criteria: SearchCriteria,
  boards: BoardId[] = ALL_BOARDS,
): BoardSearchPack[] {
  const selected = boards.length > 0 ? boards : ALL_BOARDS;
  return selected.map((board) => {
    switch (board) {
      case "zhilian":
        return zhilianSearch(criteria);
      case "liepin":
        return liepinSearch(criteria);
      case "job51":
        return job51Search(criteria);
    }
  });
}

export function criteriaFromProfile(profile: ResumeProfile): SearchCriteria {
  return {
    titles: profile.targetTitles.length
      ? profile.targetTitles
      : profile.currentTitle
        ? [profile.currentTitle]
        : [],
    keywords: profile.keywords.length ? profile.keywords : profile.skills,
    cities: profile.cities.length ? profile.cities : ["全国"],
  };
}

/**
 * Demo listings for offline / playground smoke tests.
 * Real site scraping is intentionally not performed here (login walls / ToS).
 */
export function demoListings(
  profile: ResumeProfile,
  boards: BoardId[] = ALL_BOARDS,
): JobListing[] {
  const title = profile.targetTitles[0] || profile.currentTitle || "相关岗位";
  const city = profile.cities[0] || "上海";
  const skill = profile.skills[0] || profile.keywords[0] || "相关技能";
  const packs = buildSearchPacks(criteriaFromProfile(profile), boards);

  return packs.map((pack, index) => ({
    id: `demo-${pack.board}-${index + 1}`,
    board: pack.board,
    title: `${title}（示例匹配）`,
    company: `${pack.boardName}示例公司 ${index + 1}`,
    city,
    salary: "面议",
    url: pack.searchUrl,
    matchReason: `与目标方向「${title}」及技能「${skill}」相关；请在站点结果中挑选真实 JD。`,
    matchScore: Math.max(60, 90 - index * 8),
  }));
}
