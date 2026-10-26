import assert from "node:assert/strict";
import { test } from "node:test";
import { excludedEmployer, employerReview } from "../bot/lib/boards/employers.js";
import { classifyFetch, fetchBoard, type PageReader } from "../bot/lib/boards/fetch.js";
import { parseSearchHtml } from "../bot/lib/boards/parse.js";
import { readFileSync } from "node:fs";

const criteria = { titles: ["HR经理"], cities: ["上海"], keywords: [] };
const fresh = new Date(Date.now() - 3600_000).toISOString();
function search(names: string[], suffix = "") {
  return names.map((name, i) => `<div class="joblist-box__item"><a class="jobinfo__name" href="https://www.zhaopin.com/jobdetail/CC${i}.htm">HR经理</a><a class="companyinfo__name">${name}</a></div>`).join("") +
    `<script>__INITIAL_STATE__=${JSON.stringify({ positionList: names.map((_, i) => ({ number: `CC${i}`, publishTime: fresh })) })}</script>` + suffix;
}
function detail(company: string, industry?: string) {
  return `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: "HR经理", hiringOrganization: { name: company }, industry,
    description: "负责招聘绩效及员工社保管理，为员工提供五险一金和商业保险福利。", datePosted: fresh })}</script>`;
}
const page = (body: string, url: string) => ({ body, status: 200, finalUrl: url, contentType: "text/html" });

test("employer restrictions use company evidence, not HR duties or benefits", () => {
  assert.equal(excludedEmployer({ company: "某人寿保险上海分公司" }), "insurance");
  assert.equal(excludedEmployer({ company: "ABC Insurance Ltd" }), "insurance");
  assert.equal(excludedEmployer({ company: "某服务集团", companyIndustry: "保险" }), "insurance");
  assert.equal(excludedEmployer({ company: "某劳务派遣有限公司" }), "labor_dispatch");
  assert.equal(excludedEmployer({ company: "某人力资源有限公司", companyIndustry: "劳务派遣服务" }), "labor_dispatch");
  assert.equal(excludedEmployer({ company: "某人力资源有限公司", companyIndustry: "招聘/猎头" }), undefined);
  assert.equal(employerReview({ company: "某人力资源有限公司", companyIndustry: "招聘/猎头" }), "needs_review");
  assert.equal(excludedEmployer({ company: "某科技公司", companyIndustry: "软件服务" }), undefined);
  assert.equal(employerReview({ company: "（未提供）", companyIndustry: "软件服务" }), "needs_review");
  assert.equal(employerReview({ company: "", companyIndustry: "软件服务" }), "needs_review");
});

test("both site cards retain employer industry evidence", () => {
  const read = (name: string) => readFileSync(new URL(`../fixtures/html/${name}`, import.meta.url), "utf8");
  assert.equal(parseSearchHtml("liepin", read("liepin-search.html"), "https://www.liepin.com/")[0].companyIndustry, "IT服务");
  assert.equal(parseSearchHtml("zhilian", read("zhilian-search-live.html"), "https://www.zhaopin.com/")[0].companyIndustry, "人力资源");
});

test("search excludes company names before detail reads and industry revealed in details", async () => {
  const names = ["某保险公司", "某劳务派遣公司", "某服务集团", "某科技公司"];
  const read: PageReader = async url => {
    if (url.startsWith("https://sou.")) return page(search(names), url);
    assert.doesNotMatch(url, /CC[01]/);
    return page(detail(url.includes("CC2") ? names[2] : names[3], url.includes("CC2") ? "保险" : "软件服务"), url);
  };
  const result = await fetchBoard("zhilian", criteria, { read });
  assert.deepEqual(result.excludedEmployers, { insurance: 2, labor_dispatch: 1 });
  assert.deepEqual(result.listings.map(j => j.company), ["某科技公司"]);
  assert.equal(result.listings[0].companyIndustry, "软件服务");
  assert.equal(result.listings[0].sourceUpdatedAt, fresh);
});

test("partial login wall preserves public results, prompts and stops further reads", async () => {
  let reads = 0;
  const read: PageReader = async url => {
    reads++;
    return page(search(["某科技公司"], "<div>登录后查看更多岗位</div>"), url);
  };
  const result = await fetchBoard("zhilian", criteria, { read });
  assert.equal(result.listings.length, 0);
  assert.equal(result.pendingEmployerReview?.length, 1);
  assert.equal(result.userActions?.[0].reason, "login_required");
  assert.equal(reads, 1);
});

test("detail login wall stops remaining details and reports the affected URL", async () => {
  let reads = 0;
  const read: PageReader = async url => {
    reads++;
    return page(reads === 1 ? search(["某科技公司", "某制造公司"]) : "登录后查看完整信息", url);
  };
  const result = await fetchBoard("zhilian", criteria, { read });
  assert.equal(reads, 2);
  assert.equal(result.userActions?.[0].url, "https://www.zhaopin.com/jobdetail/CC0.htm");
});

test("raising the local result cap never claims login is required", async () => {
  const names = Array.from({ length: 8 }, (_, i) => `科技公司${i}`);
  const read: PageReader = async url => page(url.startsWith("https://sou.") ? search(names) : detail("某科技公司", "软件服务"), url);
  const limited = await fetchBoard("zhilian", criteria, { read });
  assert.equal(limited.listings.length, 5);
  assert.equal(limited.limits?.truncated, true);
  assert.equal(limited.pendingEmployerReview?.length, 3);
  const more = await fetchBoard("zhilian", criteria, { read, limit: 20 });
  assert.equal(more.listings.length, 8);
  assert.deepEqual(more.userActions, []);
});

test("login detection distinguishes authentication, forbidden responses and normal login links", () => {
  const check = (body: string, status = 200) => classifyFetch({ body, status, finalUrl: "https://www.liepin.com/" });
  assert.deepEqual(check('<a href="/login">登录</a><script>"登录后查看更多岗位"</script>'), { blocked: false });
  const login = check("", 401);
  assert.equal(login.blocked && login.reason, "login_required");
  const forbidden = check("", 403);
  assert.equal(forbidden.blocked && forbidden.reason, "blocked");
  const late = check("x".repeat(21000) + "登录后查看全部职位");
  assert.equal(late.blocked && late.reason, "login_required");
});
