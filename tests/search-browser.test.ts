import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { chromium } from "playwright";
import { createBrowserAccess } from "../bot/lib/boards/browser.js";
import { readRenderedJobs } from "../bot/lib/boards/rendered.js";
import { fetchBoard, fetchJobUrl } from "../bot/lib/boards/fetch.js";

const executablePath = existsSync(chromium.executablePath()) ? chromium.executablePath() : "/usr/bin/chromium";
const criteria = { titles: ["薪酬经理"], keywords: [], cities: ["上海"] };
const jd = "负责薪酬核算、绩效方案设计、人力成本预算及员工关系管理。";
const intro = "示例科技成立于2010年，专注企业人力资源软件，服务超过三千家中大型客户，总部位于上海浦东。";
const company = `<nav><a>公司介绍</a><a>在招职位</a></nav><h3>公司介绍</h3><p>${intro}</p><h3>工作地点</h3><p>上海浦东新区</p>`;
const date = new Date(Date.now() - 3600_000).toISOString();

// All HTTP requests are intercepted; no real accounts, recruiters or applications are used.
test("browser search waits for delayed DOM and reads nested/reordered fields on both boards", { skip: !existsSync(executablePath), timeout: 45_000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    for (const board of ["liepin", "zhilian"] as const) {
      const jobUrl = board === "liepin" ? "https://www.liepin.com/job/123.shtml" : "https://www.zhaopin.com/jobdetail/CC123.htm";
      const card = board === "liepin"
        ? `<div class="extra job-card-wrapper"><div class="extra job-card-pc-container"><a href="${jobUrl}?from=search"><div class="job-title-box"><div class="ellipsis-1 extra" title="薪酬经理"><b>薪酬经理</b></div></div></a><span class="company-name"><b>示例科技</b></span><div class="company-tags-box"><span>软件服务</span><span>100-499人</span><span>B轮</span></div></div></div>`
        : `<div class="extra joblist-box__item"><a href="${jobUrl}" class="extra jobinfo__name"><b>薪酬经理</b></a><a class="extra companyinfo__name"><b>示例科技</b></a><div class="companyinfo__tag"><div>100-499人</div><div>软件服务</div><div>B轮</div></div></div>`;
      const detail = board === "liepin"
        ? `<section class="job-apply-container"><span class="extra name"><b>薪酬经理</b></span><span class="update-time">${date}</span></section><div class="company-info"><span class="name">示例科技</span></div><div data-extra="yes" data-selector="job-intro-content"><p>${jd}</p></div>${company}`
        : `<section class="summary-planes"><h1 class="extra summary-planes__title"><b>薪酬经理</b></h1></section><a class="company-info__name">示例科技</a><div class="describtion-card__detail-content"><div>${jd}</div></div>${company}`;
      const context = await browser.newContext();
      await context.route("**/*", route => {
        const isDetail = /\/(?:job|jobdetail)\//.test(route.request().url());
        const state = board === "zhilian" && isDetail ? `window.__INITIAL_STATE__={jobDetail:{detailedPosition:{number:'CC123',positionUpdateTime:${JSON.stringify(date)}}}};` : "";
        // Delayed JS after DOMContentLoaded/network idle.
        const body = `<div id="app"></div><script>setTimeout(()=>{${state}document.getElementById('app').innerHTML=${JSON.stringify(isDetail ? detail : card)}},${isDetail ? 350 : 3400});</script>`;
        return route.fulfill({ contentType: "text/html; charset=utf-8", body });
      });
      const access = createBrowserAccess(async () => context, (page, board) => readRenderedJobs(page, board, { timeoutMs: 7000, settleMs: 200 }));
      await access.open(board);
      try {
        const report = await fetchBoard(board, criteria, { read: access.reader(board) });
        assert.equal(report.ok, true, JSON.stringify(report));
        assert.equal(report.listings.length, 1);
        assert.equal(report.listings[0].title, "薪酬经理");
        assert.equal(report.listings[0].company, "示例科技");
        assert.equal(report.listings[0].description, jd);
        assert.equal(report.listings[0].sourceUpdatedAt, date);
        assert.equal(report.listings[0].companySize, "100-499人");
        assert.equal(report.listings[0].companyStage, "B轮");
        assert.equal(report.listings[0].companyIntro, intro);
        assert.equal(report.diagnostics?.state, "ready");
        assert.equal(report.diagnostics?.parsedCount, 1);
      } finally { await access.close(); }
    }
  } finally { await browser.close(); }
});

test("browser diagnostics distinguish empty, timeout, login and unknown job timestamps", { skip: !existsSync(executablePath), timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext();
    let markup = "";
    await context.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: markup }));
    const access = createBrowserAccess(async () => context, (page, board) => readRenderedJobs(page, board, { timeoutMs: 500, settleMs: 50 }));
    await access.open("liepin");
    try {
      for (const [html, expected] of [
        ['<div class="search-empty">暂无符合条件的职位</div>', "empty"],
        ['<div id="app"></div>', "render_timeout"],
        ['<div class="job-card-pc-container">结构未知</div>', "parse_error"],
        ['<form>扫码登录，登录后查看更多职位</form>', "login_required"],
      ]) {
        markup = html;
        const report = await fetchBoard("liepin", criteria, { read: access.reader("liepin") });
        assert.equal(report.reason, expected, JSON.stringify(report));
        assert.equal(report.listings.length, 0);
        assert.equal(report.userActions?.length ?? 0, expected === "login_required" ? 1 : 0);
      }
      // A recruiter/recommendation date cannot become the current job's freshness evidence.
      markup = `<section class="job-apply-container"><span class="name">薪酬经理</span></section><div data-selector="job-intro-content">${jd}</div><aside class="recommendation"><span class="update-time">${date}</span></aside>`;
      const result = await fetchJobUrl("https://www.liepin.com/job/123.shtml", "liepin", Date.now(), access.reader("liepin"));
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.job.sourceUpdatedAt, undefined);
    } finally { await access.close(); }
  } finally { await browser.close(); }
});

test("rendered company intro ignores a nav-only page and a footer link list", { skip: !existsSync(executablePath), timeout: 30_000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext();
    let markup = "";
    await context.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: markup }));
    const page = await context.newPage();
    const shell = `<section class="job-apply-container"><span class="name">薪酬经理</span><span class="update-time">${date}</span></section><div data-selector="job-intro-content">${jd}</div>`;
    const links = ["联系我们", "加入我们", "隐私政策", "用户协议", "网站地图", "帮助中心", "客服热线", "意见反馈", "合作洽谈", "媒体中心", "法律声明", "网站导航"];
    const cases = [
      `${shell}<nav><a>公司介绍</a><a>在招职位</a><a>热门职位</a><a>城市频道</a><a>校园招聘</a><a>海外职位</a><a>名企招聘</a><a>高薪职位</a></nav>`,
      `${shell}<footer><a>关于我们</a>${links.map(label => `<a>${label}</a>`).join("")}</footer>`,
    ];
    try {
      for (const html of cases) {
        markup = html;
        await page.goto("https://www.liepin.com/job/123.shtml");
        const result = await readRenderedJobs(page, "liepin", { timeoutMs: 2000, settleMs: 50 });
        assert.equal(result.jobs.length, 1);
        assert.equal(result.jobs[0].companyIntro, undefined);
      }
    } finally { await page.close(); }
  } finally { await browser.close(); }
});

test("failed details keep the failure reason instead of reporting an empty search", async () => {
  let reads = 0;
  const report = await fetchBoard("liepin", criteria, { read: async url => {
    reads++;
    return { status: 200, finalUrl: url, contentType: "text/html", body: reads === 1
      ? '<div class="job-card-pc-container"><a href="https://www.liepin.com/job/123.shtml"><div title="薪酬经理" class="ellipsis-1">薪酬经理</div></a><span class="company-name">示例科技</span><div class="company-tags-box"><span>软件服务</span><span>100-499人</span><span>B轮</span></div></div>'
      : '<main id="app"></main>' };
  } });
  assert.equal(report.reason, "parse_error");
  assert.equal(report.detailFailures?.[0].reason, "parse_error");
  assert.equal(report.freshness?.excludedUnknown, 1);
});
