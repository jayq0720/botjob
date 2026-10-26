import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { chromium } from "playwright";
import { deliverOnPage } from "../bot/lib/boards/apply.js";
import type { ApplicationRecord } from "../bot/lib/store.js";

const executablePath = existsSync(chromium.executablePath()) ? chromium.executablePath() : "/usr/bin/chromium";
test("real browser on intercepted fixtures: submit, pause, ambiguity, stale success and unknown outcomes", { skip: !existsSync(executablePath), timeout: 60_000 }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath });
  const app: ApplicationRecord = { id: "test", status: "queued", createdAt: "", updatedAt: "", job: {
    id: "job", board: "liepin", title: "薪酬经理", company: "测试科技公司", companyIndustry: "软件服务", city: "上海",
    url: "https://www.liepin.com/job/123.shtml", matchScore: 80, matchReason: "测试" } };
  const ld = `<script type="application/ld+json">${JSON.stringify({ "@type": "JobPosting", title: app.job.title,
    hiringOrganization: { name: app.job.company }, industry: "软件服务", description: "负责薪酬核算与绩效管理，以及人力成本预算与员工关系。",
    dateModified: new Date(Date.now() - 1000).toISOString() })}</script>`;
  const cases = [
    { body: '<button onclick="window.clicks++;this.textContent=\'已投递\'">投递简历</button>', outcome: "submitted", clicks: 1 },
    { body: '<button onclick="window.clicks++">投递简历</button>', outcome: "unknown", clicks: 1 },
    { body: '<button>已投递</button>', outcome: "already_submitted", clicks: 0 },
    { body: '<button>投递简历</button><button>立即申请</button>', outcome: "paused", clicks: 0 },
    { body: '<a role="button">聊一聊</a>', outcome: "paused", clicks: 0 },
    { body: '<button>投递简历</button><input required>', outcome: "paused", clicks: 0 },
    { body: '<button>投递简历</button><div role="dialog">选择简历</div>', outcome: "paused", clicks: 0 },
    { body: '<button>投递简历</button><div role="alert">投递成功</div>', outcome: "paused", clicks: 0 },
    { body: '登录后查看完整岗位信息', outcome: "paused", clicks: 0 },
    { body: '<p>职位信息</p>', outside: '<button>投递简历</button>', outcome: "paused", clicks: 0 },
  ];
  try {
    for (const board of ["liepin", "zhilian"] as const) {
      for (const scenario of cases) {
        const page = await browser.newPage();
        const current = { ...app, job: { ...app.job, board, url: board === "liepin" ? app.job.url : "https://www.zhaopin.com/jobdetail/CC123.htm" } };
        const markup = `${ld}<script>window.clicks=0</script><section class="${board === "liepin" ? "job-apply-container" : "summary-planes"}">${scenario.body}</section>${scenario.outside ?? ""}`;
        // No requests reach either real site; every resource is intercepted here.
        await page.route("**/*", route => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: markup }));
        let journal = 0;
        const result = await deliverOnPage(page, current, async () => { journal++; }, 100);
        assert.equal(result.outcome, scenario.outcome, `${board}: ${scenario.body}: ${result.message}`);
        assert.equal(await page.evaluate("window.clicks"), scenario.clicks);
        assert.equal(journal, scenario.clicks);
        await page.close();
      }
    }
  } finally { await browser.close(); }
});
