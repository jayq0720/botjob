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
  return page.evaluate(({ board, detail }) => {
    // Object methods survive tsx/esbuild serialization without external __name helpers.
    const dom = {
      visible(element: Element) { return !!element.getClientRects().length && getComputedStyle(element).visibility !== "hidden"; },
      text(root: ParentNode, selector: string) {
        const node = Array.from(root.querySelectorAll(selector)).find(dom.visible);
        return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      },
    };
    const cards = Array.from(document.querySelectorAll(board === "liepin"
      ? ".job-card-pc-container, .job-card-wrapper" : ".joblist-box__item")).filter(dom.visible);
    // A wrapper and its nested card describe one job, not two.
    const roots = detail ? [document] : cards.filter(card => !cards.some(other => other !== card && card.contains(other)));
    const jobs = roots.slice(0, 100).map(root => {
      const anchor = root.querySelector<HTMLAnchorElement>(board === "liepin" ? 'a[href*="/job/"]' : 'a.jobinfo__name');
      const title = dom.text(root, detail
        ? (board === "liepin" ? ".job-title .name, .job-name .name, .job-apply-container .name, h1.name" : ".summary-planes__title, .summary-plane__title")
        : (board === "liepin" ? ".job-title-box [title], .job-title-box .ellipsis-1, .job-name, .ellipsis-1[title]" : ".jobinfo__name"));
      const company = dom.text(root, board === "liepin" ? (detail ? ".company-info .name, .company-info .company-name, .company-info .company-title" : ".company-name") : (detail ? ".company-info__name, .company__title" : ".companyinfo__name"));
      const industry = dom.text(root, board === "liepin" ? (detail ? ".company-info .company-tags-box" : ".company-tags-box") : (detail ? ".company-info__industry" : ".companyinfo__tag"));
      const labels = Array.from(root.querySelectorAll(board === "liepin" ? ".labels-tag, .job-properties span:not(.split)" : ".jobinfo__other-info-item, .summary-planes__info li, .summary-plane__info li"))
        .filter(dom.visible).map(node => node.textContent?.trim() ?? "");
      // Only explicit job-time fields; recruiter activity and arbitrary dates never count.
      const timeRoot = detail ? root.querySelector(board === "liepin" ? ".job-apply-container" : ".summary-planes, .summary-plane") : root;
      let updated = timeRoot ? dom.text(timeRoot, ".update-time, .job-update-time, .jobinfo__update-time") : "";
      let published = timeRoot ? dom.text(timeRoot, ".publish-time, .job-publish-time, .jobinfo__publish-time") : "";
      const url = detail ? location.href : anchor?.href ?? "";
      if (board === "zhilian") {
        // SPA may keep source times only in runtime state, without a serialized script.
        const state = (window as unknown as { __INITIAL_STATE__?: { positionList?: Record<string, unknown>[]; jobDetail?: { detailedPosition?: Record<string, unknown> } } }).__INITIAL_STATE__;
        const number = url.match(/\/jobdetail\/([^/.]+)\.htm(?:[?#]|$)/)?.[1];
        const position = detail ? state?.jobDetail?.detailedPosition : Array.isArray(state?.positionList) ? state.positionList.find(item => item?.number === number) : undefined;
        if (number && position?.number === number) {
          if (!updated) updated = [position.positionUpdateTime, position.updateTime].find(value => typeof value === "string") as string ?? "";
          if (!published) published = [position.positionPublishTime, position.publishTime].find(value => typeof value === "string") as string ?? "";
        }
      }
      const description = detail ? dom.text(root, board === "liepin" ? '[data-selector="job-intro-content"], .job-intro-content' : ".describtion__detail-content, .describtion-card__detail-content") : "";
      return { title, company, industry, labels, updated, published, description,
        url,
        salary: dom.text(root, ".job-salary, .jobinfo__salary, .salary, .summary-planes__salary, .summary-plane__salary"),
        city: dom.text(root, ".job-dq-box, .job-area") };
    });
    const empty = Array.from(document.querySelectorAll('.search-empty, .job-list-empty, .no-result, .no-data, .empty-result'))
      .some(node => dom.visible(node) && /暂无|没有|未找到|无符合/.test(node.textContent ?? ""));
    const restricted = Array.from(document.querySelectorAll('form, [role="dialog"], .login-container, .captcha, .geetest_panel'))
      .some(node => dom.visible(node) && /扫码登录|验证码|安全验证|人机验证|登录后.*(?:职位|岗位)/.test(node.textContent ?? ""));
    return { jobs, cardCount: roots.length, empty, restricted };
  }, { board, detail });
}

function postings(raw: Awaited<ReturnType<typeof capture>>, board: BoardId, now: number): JobPosting[] {
  const unique = new Map<string, JobPosting>();
  for (const item of raw.jobs) {
    if (!item.title || !jobUrlAllowed(item.url, board)) continue;
    const url = new URL(item.url);
    if (!(board === "liepin" ? /^\/job\/[^/]+\.shtml$/ : /^\/jobdetail\/[^/]+\.htm$/).test(url.pathname)) continue;
    const key = canonicalJobUrl(item.url);
    unique.set(key, {
      board, title: item.title, company: item.company || "（未提供）", companyIndustry: item.industry || undefined,
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
    jobs = postings(snapshot, board, Date.now());
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
