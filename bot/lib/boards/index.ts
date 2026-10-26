import { liepinSearch } from "./liepin.js";
import { zhilianSearch } from "./zhilian.js";
import type { BoardId, BoardSearchPack, SearchCriteria } from "./types.js";
import type { ResumeProfile } from "../store.js";

export type { BoardId, BoardSearchPack, SearchCriteria };

const ALL_BOARDS: BoardId[] = ["zhilian", "liepin"];

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
      default:
        throw new Error("仅支持智联和猎聘。");
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

