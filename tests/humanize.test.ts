import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { chromium } from "playwright";
import { searchJobs } from "../bot/lib/actions/jobs.js";
import { saveResumeProfile } from "../bot/lib/actions.js";
import { createBrowserAccess } from "../bot/lib/boards/browser.js";
import { bezierPath, logNormalMs, transientNavigationError, withRetry } from "../bot/lib/boards/humanize.js";
import { budgeted, nextGapMs, pageBudget, readPacing } from "../bot/lib/boards/pace.js";
import { parseSearchHtml } from "../bot/lib/boards/parse.js";
import { mcpActionContext } from "../bot/lib/state-store.js";

async function withHome(run: (home: string) => Promise<void>) {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-humanize-"));
  try { await run(home); } finally { await rm(home, { recursive: true, force: true }); }
}

test("page gaps are log-normal: clamped, centred near the median, and not a flat range", () => {
  const samples = Array.from({ length: 4000 }, () => nextGapMs());
  assert.ok(samples.every(ms => ms >= readPacing.minGapMs && ms <= readPacing.maxGapMs));
  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  assert.ok(median > 3_800 && median < 5_800, String(median));
  // A tail of longer "reading" pauses exists, unlike the old uniform 3-6 s.
  assert.ok(samples.filter(ms => ms > 8_000).length > 40);
  assert.equal(logNormalMs({ medianMs: 500, minMs: 60, maxMs: 60 }), 60);
});

test("mouse paths curve and end exactly on the target", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const path = bezierPath({ x: 0, y: 0 }, { x: 600, y: 300 }, 30, random);
  assert.equal(path.length, 30);
  assert.deepEqual(path.at(-1), { x: 600, y: 300 });
  // Not a straight line: some point is well off the direct segment.
  const offLine = path.some(p => Math.abs(p.y - p.x / 2) > 10);
  assert.ok(offLine);
});

test("navigation retries once on a timeout but never on other errors", async () => {
  const sleep = async () => undefined;
  let calls = 0;
  const value = await withRetry(async () => { if (++calls === 1) throw Object.assign(new Error("page.goto: Timeout 30000ms exceeded."), { name: "TimeoutError" }); return "ok"; }, { sleep });
  assert.equal(value, "ok");
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw new Error("boom"); }, { sleep }));
  assert.equal(calls, 1);
  assert.ok(transientNavigationError(new Error("net::ERR_CONNECTION_RESET at https://www.zhaopin.com/")));
  assert.ok(!transientNavigationError(new Error("Target page, context or browser has been closed")));
});

test("each site has a rolling hourly page budget that survives restarts", async () => withHome(async home => {
  const saved = { ...readPacing };
  Object.assign(readPacing, { pagesPerHour: 3 });
  try {
    const budget = pageBudget(mcpActionContext(home).store, "s1");
    let reads = 0;
    const read = budgeted("zhilian", "智联", async url => { reads++; return { status: 200, finalUrl: url, body: "", contentType: "text/html" }; }, budget);
    for (let i = 0; i < 3; i++) assert.ok(!("error" in await read("https://www.zhaopin.com/")));
    const refused = await read("https://www.zhaopin.com/");
    assert.ok("error" in refused && /一小时内已读取 3 个页面/.test(refused.error));
    assert.equal(reads, 3);
    // Another site keeps its own budget; a fresh store handle (restarted server) still sees the spent one.
    assert.equal((await pageBudget(mcpActionContext(home).store, "s1").status("liepin")).remaining, 3);
    assert.equal((await pageBudget(mcpActionContext(home).store, "s1").status("zhilian")).remaining, 0);
    assert.equal((await budget.status("zhilian", Date.now() + 3601_000)).remaining, 3);
  } finally { Object.assign(readPacing, saved); }
}));

test("a search skips a site whose hourly budget is spent, even with retryBlocked", async () => withHome(async home => {
  const saved = { ...readPacing };
  Object.assign(readPacing, { minGapMs: 0, maxGapMs: 0, pagesPerHour: 1 });
  const ctx = mcpActionContext(home);
  await saveResumeProfile(ctx, { summary: "十年人力资源经验，擅长薪酬绩效。", targetTitles: ["薪酬经理"], skills: ["薪酬"], keywords: ["薪酬"], cities: ["上海"] });
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }); }) as typeof fetch;
  try {
    await pageBudget(ctx.store, ctx.sessionId).take("liepin");
    const result = await searchJobs(ctx, { boards: ["liepin"], attemptFetch: true, retryBlocked: true });
    assert.ok("fetches" in result && result.fetches);
    assert.equal(result.fetches[0].reason, "rate_limited");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; Object.assign(readPacing, saved); }
}));

test("智联 falls back to __INITIAL_STATE__.positionList when no card markup matches", () => {
  const page = readFileSync(new URL("../fixtures/html/zhilian-jobs-2026.html", import.meta.url), "utf8")
    .replaceAll("job-card", "renamed-card").replaceAll("joblist-box__item", "renamed-item");
  const jobs = parseSearchHtml("zhilian", page, "https://www.zhaopin.com/jobs/?jl=538", Date.now());
  assert.equal(jobs.length, 20);
  assert.equal(jobs[0].title, "绩效管理岗");
  assert.equal(jobs[0].company, "兴业消费金融股份公司");
  assert.equal(jobs[0].url, "https://www.zhaopin.com/jobdetail/CC219109530J40837344505.htm");
  assert.equal(jobs[0].salary, "2-2.5万");
  assert.equal(jobs[0].city, "上海");
  assert.equal(jobs[0].sourceTimeText, "2026-08-14 11:03:44");
  assert.equal(jobs[0].jdStatus, "list_only");
});

const executablePath = [chromium.executablePath(), "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"].find(file => existsSync(file));
// One Chromium for this file: other test files launch their own in parallel, and every extra launch slows CI runners.
let shared: ReturnType<typeof chromium.launch> | undefined;
const sharedBrowser = () => shared ??= chromium.launch({ executablePath, headless: true });
after(async () => { await (await shared)?.close(); });

test("the browser reader reuses one tab per site, sends the previous page as referer, and keeps a verification page open", { skip: !executablePath, timeout: 60_000 }, async () => {
  const context = await (await sharedBrowser()).newContext();
  try {
    const referers: Array<string | undefined> = [];
    await context.route("**/*", route => {
      referers.push(route.request().headers().referer);
      const slider = route.request().url().includes("slider");
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: slider ? "<title>滑动验证页面</title><p>请按住滑块，拖动到最右边</p>" : "<div style='height:4000px'>岗位</div>" });
    });
    let humanized = 0;
    const access = createBrowserAccess(async () => context, async () => ({ jobs: [], diagnostics: undefined as never }), undefined, async () => { humanized++; });
    const read = access.reader("zhilian");
    await read("https://www.zhaopin.com/jobs/?kw=a");
    await read("https://www.zhaopin.com/jobdetail/CC1.htm");
    await read("https://www.zhaopin.com/slider");
    assert.equal(context.pages().length, 1);
    assert.equal(referers[0], undefined);
    assert.equal(referers[1], "https://www.zhaopin.com/jobs/?kw=a");
    assert.equal(humanized, 3);
    // The verification page stays on screen for the user to complete.
    assert.equal(context.pages()[0].url(), "https://www.zhaopin.com/slider");
    await access.close();
  } finally { await context.close(); }
});

test("rendered 智联 search reads positionList when the cards use unknown classes", { skip: !executablePath, timeout: 60_000 }, async () => {
  const context = await (await sharedBrowser()).newContext();
  try {
    const time = new Date(Date.now() - 3600_000).toISOString();
    const state = { positionList: [{ name: "薪酬绩效经理", companyName: "示例科技", positionURL: "https://www.zhaopin.com/jobdetail/CC9.htm", workCity: "上海", salary60: "2-3万", industryName: "软件服务", companySize: "100-299人", publishTime: time }] };
    await context.route("**/*", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<div class="new-card-2027">薪酬绩效经理</div><script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>` }));
    const page = await context.newPage();
    await page.goto("https://www.zhaopin.com/jobs/?kw=x");
    const { readRenderedJobs } = await import("../bot/lib/boards/rendered.js");
    const result = await readRenderedJobs(page, "zhilian", { timeoutMs: 2_000, settleMs: 100 });
    assert.equal(result.diagnostics.state, "ready");
    assert.equal(result.jobs.length, 1);
    assert.equal(result.jobs[0].company, "示例科技");
    assert.equal(result.jobs[0].salary, "2-3万");
    assert.equal(result.jobs[0].companySize, "100-299人");
  } finally { await context.close(); }
});
