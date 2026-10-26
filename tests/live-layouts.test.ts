import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "playwright";
import { searchJobs } from "../bot/lib/actions/jobs.js";
import { browserAccess, profileLockOwner } from "../bot/lib/boards/browser.js";
import { companyTagLine, introAfterHeading } from "../bot/lib/boards/company.js";
import { classifyFetch, fetchBoard, fetchJobUrl } from "../bot/lib/boards/fetch.js";
import { job51DetailUrl } from "../bot/lib/boards/job51.js";
import { parseDetailHtml, parseSearchHtml } from "../bot/lib/boards/parse.js";
import { readRenderedJobs } from "../bot/lib/boards/rendered.js";
import { mcpActionContext } from "../bot/lib/state-store.js";

// Fixtures are trimmed copies of pages read while logged in (Oct 2026), with account data removed.
const html = (name: string) => readFileSync(new URL(`../fixtures/html/${name}`, import.meta.url), "utf8");
const slider = readFileSync(new URL("../fixtures/blocked/job51-slider.html", import.meta.url), "utf8");
const criteria = { titles: ["薪酬绩效经理"], keywords: [], cities: ["上海"] };
// Playwright's Chromium, else a system Chrome/Edge so the rendered checks also run on a desktop.
const executablePath = [chromium.executablePath(), "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"].find(file => existsSync(file));

test("智联 www.zhaopin.com/jobs/ cards take their job URL from positionList", () => {
  const jobs = parseSearchHtml("zhilian", html("zhilian-jobs-2026.html"), "https://www.zhaopin.com/jobs/?jl=538", Date.now());
  assert.equal(jobs.length, 20);
  const [first] = jobs;
  assert.equal(first.title, "绩效管理岗");
  assert.equal(first.company, "兴业消费金融股份公司");
  assert.equal(first.url, "https://www.zhaopin.com/jobdetail/CC219109530J40837344505.htm");
  assert.equal(first.salary, "2-2.5万");
  assert.equal(first.city, "上海 静安 天目西路");
  assert.equal(first.companySize, "1000-9999人");
  assert.equal(first.companyIndustry, "消费金融");
  assert.equal(first.sourceTimeText, "2026-08-14 11:03:44");
  assert.equal(new Set(jobs.map(job => job.url)).size, 20);
  // A card whose title is missing from positionList gets no borrowed URL.
  const stray = html("zhilian-jobs-2026.html").replace("__INITIAL_STATE__=", "__INITIAL_STATE__X=");
  assert.equal(parseSearchHtml("zhilian", stray, "https://www.zhaopin.com/jobs/", Date.now()).length, 0);
});

test("智联 detail splits the company tag line and keeps the real 公司介绍", () => {
  const job = parseDetailHtml("zhilian", html("zhilian-detail-2026.html"), "https://www.zhaopin.com/jobdetail/CC219109530J40837344505.htm", Date.now());
  assert.ok(job);
  assert.equal(job.companyStage, "A轮");
  assert.equal(job.companySize, "1000-9999人");
  assert.equal(job.companyIndustry, "消费金融、产业互联网平台");
  assert.match(job.companyIntro ?? "", /^兴业消费金融股份公司是正规持牌金融机构/);
  assert.doesNotMatch(job.companyIntro ?? "", /A轮|1000-9999人/);
  assert.ok(job.description.length > 100);
});

test("company tag lines yield stage, size and industry", () => {
  assert.deepEqual(companyTagLine("A轮 · 1000-9999人 · 消费金融、产业互联网平台 已审核"),
    { companySize: "1000-9999人", companyStage: "A轮", companyIndustry: "消费金融、产业互联网平台" });
  assert.deepEqual(companyTagLine("100-299人 · 互联网"), { companySize: "100-299人", companyStage: undefined, companyIndustry: "互联网" });
  assert.deepEqual(companyTagLine(undefined), {});
});

test("intro fallback skips a footer link list and the 公司信息 tag line", () => {
  const intro = "杰瑞集团成立于1999年，经过20多年的发展，成长为具备全球服务能力的能源系统解决方案提供商。";
  assert.equal(introAfterHeading(`公司信息\n杰瑞集团 已上市 · 1000-9999人 · 石油/石化、环保 已审核 公司评价554条\n公司介绍\n${intro}\n工作地点 上海`), intro);
  assert.equal(introAfterHeading("关于我们 公司介绍 联系我们 诚聘英才 产品与服务 人才招聘 企业招聘 职悟空·AI求职搭子，帮你找工作。"), undefined);
  assert.equal(companyTagLine("未融资 · 1000-9999人 · 软件/IT服务、软件/IT服务").companyIndustry, "软件/IT服务");
});

test("51job cards without a job link get jobs.51job.com/<city>/<jobId>.html", () => {
  assert.equal(job51DetailUrl("174029263", "上海"), "https://jobs.51job.com/shanghai/174029263.html");
  assert.equal(job51DetailUrl(174029263, "上海·浦东新区"), "https://jobs.51job.com/shanghai/174029263.html");
  assert.equal(job51DetailUrl("174029263", "拉萨"), undefined);
  assert.equal(job51DetailUrl("abc", "上海"), undefined);
  const jobs = parseSearchHtml("job51", html("job51-search-2026.html"), "https://we.51job.com/pc/search", Date.now());
  assert.equal(jobs.length, 20);
  assert.equal(jobs[0].url, "https://jobs.51job.com/shanghai/174029263.html");
  assert.equal(jobs[0].title, "人力资源岗（绩效薪酬方向）");
  assert.equal(jobs[0].city, "上海");
  assert.equal(jobs[0].companyStage, "国企");
  // Recommendation links further down the page never become a card's URL.
  assert.ok(jobs.every(job => /\/(?:shanghai)\/\d+\.html$/.test(job.url)), jobs.map(job => job.url).join(" "));
});

test("the 51job slider page is a captcha that needs the user, not a timeout", async () => {
  const gate = classifyFetch({ status: 200, finalUrl: "https://jobs.51job.com/shanghai/1.html", body: slider });
  assert.equal(gate.blocked, true);
  if (gate.blocked) assert.equal(gate.reason, "captcha");
  const detail = await fetchJobUrl("https://jobs.51job.com/shanghai/1.html", "job51", Date.now(),
    async url => ({ status: 200, finalUrl: url, body: slider, contentType: "text/html" }));
  assert.equal(detail.ok, false);
  if (!detail.ok) assert.equal(detail.reason, "captcha");
});

test("each target title is searched once, capped at three, and merged by job URL", async () => {
  const searched: string[] = [];
  const card = (id: string) => `<div class="job-card-pc-container"><a href="https://www.liepin.com/job/${id}.shtml"><div title="薪酬经理" class="ellipsis-1">薪酬经理</div></a><span class="company-name">示例科技</span></div>`;
  const report = await fetchBoard("liepin", { ...criteria, titles: ["甲", "乙", "丙", "丁", "甲"] }, { read: async url => {
    const key = new URL(url).searchParams.get("key");
    if (key) searched.push(key);
    const body = key ? card(key === "丙" ? "2" : "1") : "<main></main>";
    return { status: 200, finalUrl: url, body, contentType: "text/html" };
  } });
  assert.deepEqual(searched, ["甲", "乙", "丙"]);
  assert.equal(report.freshness?.excludedUnknown, 2);
});

test("a captcha on one title search stops the other searches on that site", async () => {
  const searched: string[] = [];
  const report = await fetchBoard("job51", { ...criteria, titles: ["甲", "乙"] }, { read: async url => {
    searched.push(url);
    return { status: 200, finalUrl: url, body: slider, contentType: "text/html" };
  } });
  assert.equal(searched.length, 1);
  assert.equal(report.reason, "captcha");
  assert.equal(report.userActions?.length, 1);
});

test("browser-mode search reads 猎聘 from public pages and says so", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-liepin-public-"));
  const original = { fetch: globalThis.fetch, reader: browserAccess.reader };
  const opened: string[] = [];
  browserAccess.reader = board => { opened.push(board); return async () => ({ error: "should not open a browser" }); };
  globalThis.fetch = (async () => new Response(html("liepin-search.html"), { status: 200, headers: { "content-type": "text/html" } })) as typeof fetch;
  try {
    const result = await searchJobs(mcpActionContext(home), { accessMode: "browser", attemptFetch: true, boards: ["liepin"], titles: ["薪酬经理"], cities: ["上海"] });
    assert.deepEqual(opened, []);
    assert.ok("fetches" in result && result.fetches);
    assert.match(result.fetches[0].message, /^猎聘在 botjob 浏览器窗口里会被站点脚本清空页面/);
  } finally {
    globalThis.fetch = original.fetch;
    browserAccess.reader = original.reader;
    await rm(home, { recursive: true, force: true });
  }
});

test("a login profile held by another live browser is reported with its PID", { skip: process.platform === "win32" }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "botjob-lock-"));
  try {
    assert.equal(profileLockOwner(dir), undefined);
    await symlink(`${hostname()}-${process.pid}`, path.join(dir, "SingletonLock"));
    assert.equal(profileLockOwner(dir), process.pid);
    assert.equal(profileLockOwner(dir, "other-host"), undefined);
    await rm(path.join(dir, "SingletonLock"));
    await symlink(`${hostname()}-999999999`, path.join(dir, "SingletonLock"));
    assert.equal(profileLockOwner(dir), undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("rendered 2026 layouts: 智联 cards, 智联 detail, 51job cards and the slider page", { skip: !executablePath, timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ javaScriptEnabled: true });
    const pages: Record<string, string> = {
      "https://www.zhaopin.com/jobs/?jl=538": html("zhilian-jobs-2026.html"),
      "https://www.zhaopin.com/jobdetail/CC219109530J40837344505.htm": html("zhilian-detail-2026.html"),
      "https://we.51job.com/pc/search?keyword=x": html("job51-search-2026.html"),
      "https://jobs.51job.com/shanghai/1.html": slider,
    };
    await context.route("**/*", route => {
      const body = pages[route.request().url()];
      return body ? route.fulfill({ contentType: "text/html; charset=utf-8", body }) : route.abort();
    });
    const page = await context.newPage();
    const read = async (url: string, board: "zhilian" | "job51") => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      return readRenderedJobs(page, board, { timeoutMs: 3000, settleMs: 100 });
    };
    const cards = await read("https://www.zhaopin.com/jobs/?jl=538", "zhilian");
    assert.equal(cards.diagnostics.state, "ready");
    assert.equal(cards.jobs.length, 20);
    assert.equal(cards.jobs[0].url, "https://www.zhaopin.com/jobdetail/CC219109530J40837344505.htm");
    assert.equal(cards.jobs[0].companySize, "1000-9999人");
    assert.equal(cards.jobs[0].sourceTimeText, "2026-08-14 11:03:44");
    const detail = await read("https://www.zhaopin.com/jobdetail/CC219109530J40837344505.htm", "zhilian");
    assert.equal(detail.jobs[0].companyStage, "A轮");
    assert.equal(detail.jobs[0].companyIndustry, "消费金融、产业互联网平台");
    assert.match(detail.jobs[0].companyIntro ?? "", /^兴业消费金融股份公司是正规持牌金融机构/);
    const job51 = await read("https://we.51job.com/pc/search?keyword=x", "job51");
    assert.equal(job51.jobs.length, 20);
    assert.equal(job51.jobs[0].url, "https://jobs.51job.com/shanghai/174029263.html");
    assert.equal(job51.jobs[0].city, "上海");
    const blocked = await read("https://jobs.51job.com/shanghai/1.html", "job51");
    assert.equal(blocked.diagnostics.state, "restricted");
  } finally { await browser.close(); }
});
