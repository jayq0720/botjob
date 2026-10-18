import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  buildSearchPacks,
  criteriaFromProfile,
  demoListings,
  type BoardId,
} from "../lib/boards/index.js";
import {
  resumeProfileKey,
  type JobListing,
  type ResumeProfile,
} from "../lib/store.js";

const boardSchema = z.enum(["zhilian", "liepin", "job51"]);

export default defineTool({
  description:
    "Search suitable jobs on 智联招聘、猎聘、前程无忧(51job) using the saved resume profile. Returns deep-link search packs plus demo-matched listings (real board HTML is not scraped). Pass includeDemoListings=false to only get search URLs.",
  effect: "read",
  inputSchema: z.object({
    boards: z.array(boardSchema).optional(),
    extraKeywords: z.array(z.string()).optional(),
    cities: z.array(z.string()).optional(),
    titles: z
      .array(z.string())
      .optional()
      .describe("Override target titles when profile is missing"),
    includeDemoListings: z.boolean().optional(),
  }),
  async execute(
    { boards, extraKeywords, cities, titles, includeDemoListings },
    ctx,
  ) {
    const sessionId = ctx.session.id;
    const stored = (await ctx.host.kv.get(resumeProfileKey(sessionId))) as
      | ResumeProfile
      | undefined;

    const profile: ResumeProfile | undefined = stored
      ? stored
      : titles?.length || extraKeywords?.length
        ? {
            summary: "inline search criteria",
            targetTitles: titles ?? [],
            skills: extraKeywords ?? [],
            cities: cities ?? ["全国"],
            industries: [],
            strengths: [],
            gaps: [],
            keywords: extraKeywords ?? titles ?? [],
            updatedAt: new Date().toISOString(),
          }
        : undefined;

    if (!profile) {
      return {
        ok: false,
        message:
          "No resume profile yet. Save a resume, analyze it, then call save_resume_profile.",
      };
    }

    const selected = (boards ?? [
      "zhilian",
      "liepin",
      "job51",
    ]) as BoardId[];
    const criteria = criteriaFromProfile(profile);
    if (extraKeywords?.length) {
      criteria.keywords = [
        ...new Set([...extraKeywords, ...criteria.keywords]),
      ];
    }
    if (cities?.length) {
      criteria.cities = cities;
    }
    if (titles?.length) {
      criteria.titles = titles;
    }

    const searchPacks = buildSearchPacks(criteria, selected);
    const listings: JobListing[] =
      includeDemoListings === false
        ? []
        : demoListings(profile, selected);

    return {
      ok: true,
      criteria,
      searchPacks,
      listings,
      applyHint:
        "Pick listings (or URLs from search packs), then call queue_apply. Actual site submission requires user login and approval.",
    };
  },
});
