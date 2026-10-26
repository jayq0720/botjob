import { captureJobDom } from "./page-dom.js";
import type { Page } from "playwright";
import { canonicalJobUrl, jobUrlAllowed, type JobPosting } from "../jd.js";
import { jobTime } from "./freshness.js";
import type { BoardId } from "./types.js";

export type RenderDiagnostics = {
  mode: "browser";
  state: "ready" | "empty" | "timeout" | "restricted";
  pageKind: "search" | "detail";
  elapsedMs: number;
  cardCount: number;
  parsedCount: number;
};

/** Read only known job regions. Never collect account data, cookies or unrelated page text. */
async function capture(page: Page, board: BoardId, detail: boolean) {
  return page.evaluate(captureJobDom, { board, detail });
}

export function postingsFromDom(raw: Awaited<ReturnType<typeof capture>>, board: BoardId, now: number): JobPosting[] {
  const unique = new Map<string, JobPosting>();
  for (const item of raw.jobs) {
    if (!item.title || !jobUrlAllowed(item.url, board)) continue;
    const url = new URL(item.url);
    if (!(board === "liepin" ? /^\/job\/[^/]+\.shtml$/ : /^\/jobdetail\/[^/]+\.htm$/).test(url.pathname)) continue;
    const key = canonicalJobUrl(item.url);
    unique.set(key, {
      board, title: item.title, company: item.company || "（未提供）", companyIndustry: item.industry || undefined,
      companyDescription: item.companyDescription || undefined,
      companyDescriptionSourceUrl: item.companyDescription ? item.url : undefined,
      companySize: item.companySize || undefined,
      companyUrl: jobUrlAllowed(item.companyUrl, board) ? item.companyUrl : undefined,
      city: item.city || item.labels.find(label => !/经验|学历|本科|专科|硕士|博士|年|招.*人/.test(label)) || "",
      salary: item.salary && !item.salary.includes("*") ? item.salary : undefined,
      experience: item.labels.find(label => /经验|\d+.*年/.test(label)),
      education: item.labels.find(label => /学历|本科|专科|硕士|博士/.test(label)),
      description: item.description, url: item.url, jdStatus: item.description.length >= 20 ? "detail" : "list_only",
      ...jobTime(item.updated || item.published, item.updated ? "updated" : "published", now),
    });
  }
  return [...unique.values()];
}

/** Wait for useful DOM content, not networkidle (analytics and delayed SPA requests make it unreliable). */
export async function readRenderedJobs(page: Page, board: BoardId, options: { timeoutMs?: number; settleMs?: number } = {}) {
  const started = Date.now();
  const timeout = options.timeoutMs ?? 10_000;
  const settle = options.settleMs ?? 750;
  const detail = /\/(?:job|jobdetail)\/[^/]+\.(?:shtml|htm)(?:[?#]|$)/.test(page.url());
  let signature = "";
  let stableSince = started;
  let snapshot: Awaited<ReturnType<typeof capture>>;
  let jobs: JobPosting[];
  let state: RenderDiagnostics["state"] = "timeout";
  do {
    snapshot = await capture(page, board, detail);
    jobs = postingsFromDom(snapshot, board, Date.now());
    const next = JSON.stringify(snapshot);
    if (signature !== next) { signature = next; stableSince = Date.now(); }
    const ready = detail ? jobs.some(job => job.jdStatus === "detail") : jobs.length > 0;
    if (Date.now() - stableSince >= settle) {
      if (ready) { state = "ready"; break; }
      if (snapshot.restricted) { state = "restricted"; break; }
      if (!detail && snapshot.empty) { state = "empty"; break; }
    }
    if (Date.now() - started >= timeout) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(200, timeout - (Date.now() - started))));
  } while (true);
  return { jobs, diagnostics: { mode: "browser", state, pageKind: detail ? "detail" : "search",
    elapsedMs: Date.now() - started, cardCount: detail ? 0 : snapshot.cardCount, parsedCount: jobs.length } satisfies RenderDiagnostics };
}
