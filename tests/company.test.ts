import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { companyTags, introAfterHeading, trimIntro } from "../bot/lib/boards/company.js";
import { parseDetailHtml, parseSearchHtml } from "../bot/lib/boards/parse.js";

test("company tags split size and funding stage from industry text", () => {
  assert.deepEqual(companyTags("IT服务 1-49人"), { companySize: "1-49人", companyStage: undefined });
  assert.deepEqual(companyTags("20人以下 人力资源 已上市"), { companySize: "20人以下", companyStage: "已上市" });
  assert.deepEqual(companyTags(undefined), {});
});

test("company intro skips navigation tabs and stops at the next section", () => {
  const text = "首页 公司介绍 在招职位 职位描述 负责薪酬 公司介绍：某某集团创立于1998年，是国内领先的制造企业，员工超过一万人，业务覆盖全国三十个省份。 工作地点 上海市";
  assert.equal(introAfterHeading(text), "某某集团创立于1998年，是国内领先的制造企业，员工超过一万人，业务覆盖全国三十个省份。");
  assert.equal(introAfterHeading("没有相关章节"), undefined);
  const long = trimIntro("公司简介。".repeat(200));
  assert.ok(long && long.length <= 401 && long.endsWith("…"));
});

test("static detail pages and search cards carry company facts", () => {
  const html = `<span class="name">薪酬经理</span><dd data-selector="job-intro-content">负责薪酬体系设计、绩效考核与人力成本分析，向HRD汇报。</dd>
    <script>var nav = "公司介绍";</script><h3>公司介绍</h3><div>示例集团成立于2005年，主营新能源汽车零部件，在长三角拥有五个生产基地和两千名员工。</div><h3>工作地址</h3>`;
  const job = parseDetailHtml("liepin", html, "https://www.liepin.com/job/1.shtml", Date.now());
  assert.match(job?.companyIntro ?? "", /^示例集团成立于2005年/);
  const cards = parseSearchHtml("liepin", readFileSync(new URL("../fixtures/html/liepin-search.html", import.meta.url), "utf8"), "https://www.liepin.com/zhaopin/", Date.now());
  assert.ok(cards.some(card => card.companySize === "1-49人"));
  const zhilian = parseSearchHtml("zhilian", readFileSync(new URL("../fixtures/html/zhilian-search-live.html", import.meta.url), "utf8"), "https://www.zhaopin.com/sou/", Date.now());
  assert.ok(zhilian.some(card => card.companySize === "20人以下" && card.companyIndustry === "人力资源"));
});
