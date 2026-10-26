import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildSearchPacks } from "../bot/lib/boards/index.js";
import { parseDetailHtml, parseSearchHtml } from "../bot/lib/boards/parse.js";
import { freshness } from "../bot/lib/boards/freshness.js";
import { canonicalJobUrl, jobUrlAllowed } from "../bot/lib/jd.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/html/${name}`, import.meta.url), "utf8");
const today = () => { const d = new Date(Date.now() + 8 * 3600_000); return `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };

test("51job URLs are allowed only on 51job hosts and keep the job id", () => {
  assert.equal(jobUrlAllowed("https://jobs.51job.com/shanghai-pdxq/155000001.html?s=sou", "job51"), true);
  assert.equal(jobUrlAllowed("https://jobs.51job.com.evil.example/x/1.html", "job51"), false);
  assert.equal(jobUrlAllowed("https://www.liepin.com/job/1.shtml", "job51"), false);
  assert.equal(canonicalJobUrl("https://jobs.51job.com/shanghai-pdxq/155000001.html?s=sou#x"), "https://jobs.51job.com/shanghai-pdxq/155000001.html");
});

test("51job search pack maps the city to its jobArea code", () => {
  const [pack] = buildSearchPacks({ titles: ["薪酬经理"], keywords: [], cities: ["上海"] }, ["job51"]);
  assert.equal(pack.boardName, "前程无忧");
  const url = new URL(pack.searchUrl);
  assert.equal(url.hostname, "we.51job.com");
  assert.equal(url.searchParams.get("keyword"), "薪酬经理");
  assert.equal(url.searchParams.get("jobArea"), "020000");
});

test("51job detail page yields job, company facts, intro and publish date", () => {
  const html = fixture("job51-detail-live.html").replaceAll("__DATE__", today());
  const job = parseDetailHtml("job51", html, "https://jobs.51job.com/shanghai-pdxq/155000001.html");
  assert.ok(job);
  assert.equal(job.title, "薪酬绩效经理");
  assert.equal(job.company, "上海示例制造有限公司");
  assert.equal(job.salary, "2-3万·14薪");
  assert.equal(job.city, "上海-浦东新区");
  assert.equal(job.experience, "5-7年经验");
  assert.equal(job.education, "本科");
  assert.match(job.description, /薪酬体系设计/);
  assert.doesNotMatch(job.description, /职能类别/);
  assert.equal(job.companySize, "500-1000人");
  assert.equal(job.companyStage, "民营");
  assert.equal(job.companyIndustry, "汽车零配件");
  assert.match(job.companyIntro ?? "", /^上海示例制造有限公司成立于2003年/);
  assert.equal(job.sourceTimeKind, "published");
  assert.equal(freshness(job), "recent");
});

test("51job search cards read sensorsdata JSON when DOM fields are missing", () => {
  const data = { jobId: "155000002", jobTitle: "HRBP", jobSalary: "1.5-2万", jobArea: "上海·徐汇区", jobYear: "3-4年", jobDegree: "本科", jobTime: "2026-10-25 09:30:00" };
  const html = `<div class="joblist-item"><div class="joblist-item-job" sensorsdata="${JSON.stringify(data).replaceAll('"', "&quot;")}"><a href="https://jobs.51job.com/shanghai-xhq/155000002.html?s=sou_sou_soulb"></a><a class="cname">示例科技</a><span class="dc">互联网</span><span class="dc">150-500人</span></div></div>`;
  const [card] = parseSearchHtml("job51", html, "https://we.51job.com/pc/search", Date.parse("2026-10-26T00:00:00Z"));
  assert.equal(card.title, "HRBP");
  assert.equal(card.company, "示例科技");
  assert.equal(card.salary, "1.5-2万");
  assert.equal(card.city, "上海·徐汇区");
  assert.equal(card.companyIndustry, "互联网");
  assert.equal(card.companySize, "150-500人");
  assert.equal(card.sourceUpdatedAt, "2026-10-25T01:30:00.000Z");
});

test("51job public search asks for browser mode instead of fetching a script shell", async () => {
  const { fetchBoard } = await import("../bot/lib/boards/fetch.js");
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected network call"); };
  try {
    const report = await fetchBoard("job51", { titles: ["薪酬经理"], keywords: [], cities: ["上海"] });
    assert.equal(report.ok, false);
    assert.match(report.message ?? "", /accessMode="browser"/);
  } finally { globalThis.fetch = original; }
});
