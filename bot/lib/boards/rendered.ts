import type { Page } from "playwright";
import { canonicalJobUrl, jobUrlAllowed, type JobPosting } from "../jd.js";
import { companyTagLine, companyTags, introAfterHeading, trimIntro } from "./company.js";
import { JOB51_CITY_SLUG } from "./job51.js";
import { jobTime } from "./freshness.js";
import type { BoardId } from "./types.js";

export type RenderDiagnostics = {
  mode: "browser";
  state: "ready" | "empty" | "timeout" | "restricted";
  pageKind: "search" | "detail";
  elapsedMs: number;
  cardCount: number;
  parsedCount: number;
  /** Set with state "restricted": a login prompt, or a captcha/slider the user must complete. */
  restriction?: "login" | "verification";
};

type Selectors = { cards: string; anchor: string; title: [detail: string, card: string]; company: [string, string]; industry: [string, string];
  labels: string; timeRoot: string; description: string; detailPath: RegExp };

/** Per-board DOM selectors. 51job entries come from its public page structure and are not yet verified with a live account. */
const SELECTORS: Record<BoardId, Selectors> = {
  liepin: {
    cards: ".job-card-pc-container, .job-card-wrapper", anchor: 'a[href*="/job/"]',
    title: [".job-title .name, .job-name .name, .job-apply-container .name, h1.name", ".job-title-box [title], .job-title-box .ellipsis-1, .job-name, .ellipsis-1[title]"],
    company: [".company-info .name, .company-info .company-name, .company-info .company-title", ".company-name"],
    industry: [".company-info .company-tags-box", ".company-tags-box"],
    labels: ".labels-tag, .job-properties span:not(.split)", timeRoot: ".job-apply-container",
    description: '[data-selector="job-intro-content"], .job-intro-content', detailPath: /^\/job\/[^/]+\.shtml$/,
  },
  zhilian: {
    // .job-card is the www.zhaopin.com/jobs/ layout (2026); its cards have no job link, see positionList below.
    cards: ".joblist-box__item, .job-card", anchor: "a.jobinfo__name",
    title: [".summary-planes__title, .summary-plane__title", ".jobinfo__name, .job-card__title-main"],
    company: [".company-info__name, .company__title", ".companyinfo__name, .job-card__company-name"],
    industry: [".company-info__industry, .company-info__desc", ".companyinfo__tag"],
    labels: ".jobinfo__other-info-item, .job-card__skill-tag, .summary-planes__info li, .summary-plane__info li", timeRoot: ".summary-planes, .summary-plane",
    description: ".describtion__detail-content, .describtion-card__detail-content", detailPath: /^\/jobdetail\/[^/]+\.htm$/,
  },
  job51: {
    cards: ".joblist-item", anchor: 'a[href*="jobs.51job.com/"]',
    title: [".tHeader h1, .cn h1", ".jname, .joblist-item-job .jname"],
    company: [".tCompany .catn, .com_msg .com_name, .cname a", ".cname"],
    industry: [".com_tag, .tCompany .at", ".dc, .joblist-item-bot .dc"],
    labels: ".msg.ltype, .tags .tag, .joblist-item-mid .tag, .exp, .edu", timeRoot: ".tHeader",
    description: ".bmsg.job_msg, .job_msg", detailPath: /^\/[a-z0-9-]+\/\d+\.html$/,
  },
};

/** Read only known job regions. Never collect account data, cookies or unrelated page text. */
async function capture(page: Page, board: BoardId, detail: boolean) {
  const sel = { ...SELECTORS[board], detailPath: undefined, job51Slugs: JOB51_CITY_SLUG };
  return page.evaluate(({ board, detail, sel }) => {
    // Object methods survive tsx/esbuild serialization without external __name helpers.
    const dom = {
      visible(element: Element) { return !!element.getClientRects().length && getComputedStyle(element).visibility !== "hidden"; },
      text(root: ParentNode, selector: string) {
        const node = Array.from(root.querySelectorAll(selector)).find(dom.visible);
        return node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      },
      pick(pair: [string, string]) { return detail ? pair[0] : pair[1]; },
      str(data: Record<string, unknown>, key: string) { return typeof data[key] === "string" ? data[key] as string : ""; },
      named(item: Record<string, unknown> | undefined, title: string) { return !!item && dom.str(item, "name").trim() === title; },
    };
    const cards = Array.from(document.querySelectorAll(sel.cards)).filter(dom.visible);
    // A wrapper and its nested card describe one job, not two.
    const roots = detail ? [document] : cards.filter(card => !cards.some(other => other !== card && card.contains(other)));
    const jobs = roots.slice(0, 100).map((root, index) => {
      const anchor = root.querySelector<HTMLAnchorElement>(sel.anchor);
      let title = dom.text(root, dom.pick(sel.title));
      let company = dom.text(root, dom.pick(sel.company));
      let industry = dom.text(root, dom.pick(sel.industry));
      const labels = Array.from(root.querySelectorAll(sel.labels))
        .filter(dom.visible).flatMap(node => (node.getAttribute("title") || node.textContent || "").split(/\s*[|｜]\s*/)).map(text => text.trim()).filter(text => text);
      // Only explicit job-time fields; recruiter activity and arbitrary dates never count.
      const timeRoot = detail ? root.querySelector(sel.timeRoot) : root;
      let updated = timeRoot ? dom.text(timeRoot, ".update-time, .job-update-time, .jobinfo__update-time") : "";
      let published = timeRoot ? dom.text(timeRoot, ".publish-time, .job-publish-time, .jobinfo__publish-time, .time") : "";
      let url = detail ? location.href : anchor?.href ?? "";
      let salary = dom.text(root, ".job-salary, .jobinfo__salary, .job-card__salary, .salary, .sal, .summary-planes__salary, .summary-plane__salary, .tHeader strong");
      let city = dom.text(root, ".job-dq-box, .job-area, .job-card__location, .area");
      if (board === "zhilian") {
        // SPA may keep source times only in runtime state, without a serialized script.
        const state = (window as unknown as { __INITIAL_STATE__?: { positionList?: Record<string, unknown>[]; jobDetail?: { detailedPosition?: Record<string, unknown> } } }).__INITIAL_STATE__;
        const list = Array.isArray(state?.positionList) ? state.positionList : [];
        if (!detail && !url && title) {
          // Cards without a link: same title and company in positionList, else the same slot when its title matches.
          const match = list.find(item => dom.named(item, title) && (!company || dom.str(item, "companyName").trim() === company)) ?? (dom.named(list[index], title) ? list[index] : undefined);
          if (match) {
            url = dom.str(match, "positionURL") || dom.str(match, "positionUrl");
            industry ||= [dom.str(match, "financingStage"), dom.str(match, "companySize"), dom.str(match, "industryName"), dom.str(match, "propertyName") || dom.str(match, "property")].filter(Boolean).join(" · ");
          }
        }
        const number = url.match(/\/jobdetail\/([^/.]+)\.htm(?:[?#]|$)/)?.[1];
        const position = detail ? state?.jobDetail?.detailedPosition : Array.isArray(state?.positionList) ? state.positionList.find(item => item?.number === number) : undefined;
        if (number && position?.number === number) {
          if (!updated) updated = [position.positionUpdateTime, position.updateTime].find(value => typeof value === "string") as string ?? "";
          if (!published) published = [position.positionPublishTime, position.publishTime].find(value => typeof value === "string") as string ?? "";
        }
      }
      if (board === "job51") {
        // 51job cards carry the job record as JSON in a sensorsdata attribute.
        const raw = (root as Element).querySelector?.("[sensorsdata]")?.getAttribute("sensorsdata") ?? (root as Element).getAttribute?.("sensorsdata");
        let data: Record<string, unknown> = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { /* Malformed attribute: fall back to DOM text. */ }
        title ||= dom.str(data, "jobTitle"); salary ||= dom.str(data, "jobSalary"); city = dom.str(data, "jobArea") || city; company ||= dom.str(data, "companyName");
        // Cards link only the company; the job page is jobs.51job.com/<city>/<jobId>.html.
        const id = String(data.jobId ?? "");
        const slug = sel.job51Slugs[(dom.str(data, "jobArea").split(/[-·\s]/)[0] || "").replace(/市$/, "")];
        if (!detail && !new RegExp(`/${id}\\.html`).test(url) && /^\d+$/.test(id) && slug) url = `https://jobs.51job.com/${slug}/${id}.html`;
        if (!published) published = dom.str(data, "jobTime");
        if (detail && !published) published = labels.find(label => /发布$/.test(label)) ?? "";
        for (const key of ["jobYear", "jobDegree"]) if (dom.str(data, key)) labels.push(dom.str(data, key));
      }
      // Not .company-info__desc: on 智联 that is the "A轮 · 1000-9999人 · 行业" tag line.
      const companyIntro = detail ? dom.text(root, ".company-info__intro, .company-intro-container .inner, .company-intro, .company__desc, .intro-content, .tmsg.inbox") : "";
      const description = detail ? dom.text(root, sel.description) : "";
      return { title, company, industry, labels, updated, published, description, companyIntro, url, salary, city };
    });
    const empty = Array.from(document.querySelectorAll('.search-empty, .job-list-empty, .no-result, .no-data, .empty-result, .j_nolist'))
      .some(node => dom.visible(node) && /暂无|没有|未找到|无符合/.test(node.textContent ?? ""));
    const prompts = Array.from(document.querySelectorAll('form, [role="dialog"], .login-container, .captcha, .geetest_panel, #nc_1_wrapper'))
      .filter(node => dom.visible(node)).map(node => node.textContent ?? "");
    // A full-page slider (51job "滑动验证页面") has no form or dialog around it.
    const verification = prompts.some(text => /验证码|安全验证|人机验证|滑动验证|拖动滑块/.test(text))
      || /滑动验证|安全验证|访问验证/.test(document.title) || /请按住滑块|拖动到最右边/.test(document.body?.innerText ?? "");
    const login = prompts.some(text => /扫码登录|登录后.*(?:职位|岗位)/.test(text));
    const restricted: "verification" | "login" | "" = verification ? "verification" : login ? "login" : "";
    // Visible page text lets the host find a "公司介绍" section when no known selector matches.
    const pageText = detail ? (document.body?.innerText ?? "").slice(0, 30_000) : "";
    return { jobs, cardCount: roots.length, empty, restricted, pageText };
  }, { board, detail, sel });
}

function postings(raw: Awaited<ReturnType<typeof capture>>, board: BoardId, now: number): JobPosting[] {
  const unique = new Map<string, JobPosting>();
  for (const item of raw.jobs) {
    if (!item.title || !jobUrlAllowed(item.url, board)) continue;
    const url = new URL(item.url);
    if (!SELECTORS[board].detailPath.test(url.pathname)) continue;
    const key = canonicalJobUrl(item.url);
    unique.set(key, {
      // A "A轮 · 1000-9999人 · 行业" tag line keeps only the industry part; other layouts keep the text as printed.
      board, title: item.title, company: item.company || "（未提供）", companyIndustry: (/[·•]/.test(item.industry) ? companyTagLine(item.industry).companyIndustry : item.industry) || undefined,
      ...companyTags(item.industry), companyIntro: trimIntro(item.companyIntro) ?? (raw.pageText ? introAfterHeading(raw.pageText) : undefined),
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
  const detail = (() => { try { return SELECTORS[board].detailPath.test(new URL(page.url()).pathname); } catch { return false; } })();
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
    elapsedMs: Date.now() - started, cardCount: detail ? 0 : snapshot.cardCount, parsedCount: jobs.length,
    ...(state === "restricted" && snapshot.restricted ? { restriction: snapshot.restricted } : {}) } satisfies RenderDiagnostics };
}
