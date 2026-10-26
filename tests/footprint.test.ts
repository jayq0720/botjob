import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { scoreJob, searchJobs } from "../bot/lib/actions/jobs.js";
import { saveResumeProfile } from "../bot/lib/actions.js";
import { fetchBoard, pageGate } from "../bot/lib/boards/fetch.js";
import { activeCooldowns, detailCache, paced, readPacing } from "../bot/lib/boards/pace.js";
import { mcpActionContext } from "../bot/lib/state-store.js";

const slider = readFileSync(new URL("../fixtures/blocked/job51-slider.html", import.meta.url), "utf8");
const criteria = { titles: ["薪酬经理"], keywords: [], cities: ["上海"] };
const recent = new Date(Date.now() - 3600_000).toISOString();
const jd = "负责薪酬核算、绩效方案设计、人力成本预算及员工关系管理。";
const cards = (count: number) => Array.from({ length: count }, (_, i) =>
  `<div class="job-card-pc-container"><a href="https://www.liepin.com/job/${i + 1}.shtml"><div title="薪酬经理" class="ellipsis-1">薪酬经理</div></a><span class="company-name">示例科技${i}</span><div class="company-tags-box"><span>软件服务</span><span>100-499人</span></div></div>`).join("");
const detail = `<section class="job-apply-container"><span class="name">薪酬经理</span><span class="update-time">${recent}</span></section><dd data-selector="job-intro-content">${jd}</dd>`;

async function withHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-footprint-"));
  try { await run(home); } finally { await rm(home, { recursive: true, force: true }); }
}

async function withFetch(impl: (url: string) => Promise<Response>, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => impl(String(input))) as typeof fetch;
  try { await run(); } finally { globalThis.fetch = original; }
}

const html = (body: string) => new Response(body, { status: 200, headers: { "content-type": "text/html" } });

test("paced reads run one at a time per site with a gap between loads", async () => {
  const saved = { ...readPacing };
  Object.assign(readPacing, { minGapMs: 60, maxGapMs: 60 });
  try {
    const spans: Array<[number, number]> = [];
    let active = 0;
    let peak = 0;
    const read = paced("zhilian", async url => {
      active++; peak = Math.max(peak, active);
      const start = Date.now();
      await new Promise(resolve => setTimeout(resolve, 10));
      spans.push([start, Date.now()]);
      active--;
      return { status: 200, finalUrl: url, body: "", contentType: "text/html" };
    });
    await Promise.all(["1", "2", "3"].map(id => read(`https://www.zhaopin.com/jobdetail/${id}.htm`)));
    assert.equal(peak, 1);
    for (let i = 1; i < spans.length; i++) assert.ok(spans[i][0] - spans[i - 1][1] >= 55, JSON.stringify(spans));
  } finally { Object.assign(readPacing, saved); }
});

test("a search opens at most five detail pages and reuses cached ones for 24 hours", async () => withHome(async home => {
  const cache = detailCache(mcpActionContext(home).store);
  let details = 0;
  const read = async (url: string) => {
    if (url.includes("/job/")) details++;
    return { status: 200, finalUrl: url, body: url.includes("/job/") ? detail : cards(8), contentType: "text/html" };
  };
  const first = await fetchBoard("liepin", criteria, { read, browser: false, limit: 20, cache });
  assert.equal(details, 5);
  assert.equal(first.listings.length, 5);
  details = 0;
  const second = await fetchBoard("liepin", criteria, { read, browser: false, limit: 20, cache });
  // The five cached pages cost nothing; the budget goes to the three not yet read.
  assert.equal(details, 3);
  assert.equal(second.listings.length, 8);
  assert.equal(await cache.get("https://www.liepin.com/job/1.shtml", Date.now() + 25 * 3600_000), undefined);
}));

test("the first verification page on a site stops every further read there", async () => {
  const urls: string[] = [];
  const report = await fetchBoard("liepin", { ...criteria, titles: ["甲", "乙"] }, { browser: false, read: async url => {
    urls.push(url);
    return { status: 200, finalUrl: url, body: url.includes("/job/") ? slider : cards(3), contentType: "text/html" };
  } });
  // Two searches, then one detail page that showed the slider, then nothing.
  assert.equal(urls.filter(url => url.includes("/job/")).length, 1);
  assert.equal(report.userActions?.[0].reason, "captcha");
});

test("a rendered login prompt or slider counts as a stop, not a parse error", () => {
  const base = { status: 200, finalUrl: "https://we.51job.com/pc/search", body: "<div id=app></div>", contentType: "text/html" };
  const diagnostics = (restriction: "login" | "verification") => ({ jobs: [], diagnostics: { mode: "browser" as const, state: "restricted" as const, pageKind: "search" as const, elapsedMs: 1, cardCount: 0, parsedCount: 0, restriction } });
  const verify = pageGate({ ...base, rendered: diagnostics("verification") });
  assert.ok(verify.blocked && verify.reason === "captcha");
  const login = pageGate({ ...base, rendered: diagnostics("login") });
  assert.ok(login.blocked && login.reason === "login_required");
});

test("after a captcha a site cools down for 30 minutes unless the user retries", async () => withHome(async home => {
  const saved = { ...readPacing };
  Object.assign(readPacing, { minGapMs: 0, maxGapMs: 0 });
  const ctx = mcpActionContext(home);
  await saveResumeProfile(ctx, { summary: "十年人力资源经验，擅长薪酬绩效。", targetTitles: ["薪酬经理"], skills: ["薪酬"], keywords: ["薪酬"], cities: ["上海"] });
  let calls = 0;
  try {
    await withFetch(async () => { calls++; return html(slider); }, async () => {
      const first = await searchJobs(ctx, { boards: ["liepin"], attemptFetch: true });
      assert.ok("fetches" in first && first.fetches);
      assert.equal(first.fetches[0].reason, "captcha");
      assert.equal(calls, 1);
      const cooling = await activeCooldowns(ctx.store, ctx.sessionId);
      assert.ok(cooling.liepin && cooling.liepin.until - Date.now() > 29 * 60_000);

      const second = await searchJobs(ctx, { boards: ["liepin"], attemptFetch: true });
      assert.equal(calls, 1);
      assert.ok("fetches" in second && second.fetches);
      const cooled = second.fetches[0];
      assert.ok("userActions" in cooled);
      assert.equal(cooled.userActions?.[0].reason, "captcha");
      assert.match(second.fetches[0].message, /retryBlocked=true/);
      const scored = await scoreJob(ctx, { url: "https://www.liepin.com/job/1.shtml", board: "liepin" });
      assert.equal(scored.ok, false);
      assert.equal(calls, 1);

      await searchJobs(ctx, { boards: ["liepin"], attemptFetch: true, retryBlocked: true });
      assert.equal(calls, 2);
    });
    // A clean read on retry ends the cool-down.
    await withFetch(async () => html(cards(1)), async () => {
      await searchJobs(ctx, { boards: ["liepin"], attemptFetch: true, retryBlocked: true });
    });
    assert.equal((await activeCooldowns(ctx.store, ctx.sessionId)).liepin, undefined);
  } finally { Object.assign(readPacing, saved); }
}));

test("boards are searched one after another", async () => withHome(async home => {
  const saved = { ...readPacing };
  Object.assign(readPacing, { minGapMs: 0, maxGapMs: 0 });
  let active = 0;
  let peak = 0;
  try {
    await withFetch(async url => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 15));
      active--;
      return url.includes("fe-api") ? new Response("{}", { status: 200, headers: { "content-type": "application/json" } }) : html(url.includes("/job/") ? detail : cards(1));
    }, async () => {
      await searchJobs(mcpActionContext(home), { boards: ["zhilian", "liepin"], titles: ["薪酬经理"], attemptFetch: true });
    });
    assert.equal(peak, 1);
  } finally { Object.assign(readPacing, saved); }
}));
