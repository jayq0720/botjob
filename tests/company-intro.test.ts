import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseDetailHtml } from "../bot/lib/boards/parse.js";
import { scoreJob, listJobs, prepareDelivery } from "../bot/lib/actions.js";
import { mcpActionContext } from "../bot/lib/state-store.js";
import { resumeProfileKey } from "../bot/lib/store.js";

test("company evidence remains separate from JD through scoring, saved jobs and application preview", async () => {
  const url = 'https://www.liepin.com/job/123.shtml';
  const jd = '负责薪酬核算、绩效方案设计、人力成本预算及员工关系管理。';
  const intro = '示例公司开发企业管理软件，为制造业客户提供信息化产品。';
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: '薪酬经理', description: jd,
    industry: '软件服务', dateModified: new Date(Date.now()-1000).toISOString(), url,
    hiringOrganization: { name: '示例科技', description: intro, numberOfEmployees: '100-499人', sameAs: 'https://www.liepin.com/company/123/' } })}</script>`;
  const parsed = parseDetailHtml('liepin', html, url)!;
  assert.equal(parsed.description, jd); assert.equal(parsed.companyDescription, intro);
  assert.equal(parsed.companyDescriptionSourceUrl, url);
  assert.equal(parseDetailHtml('liepin', html.replace(intro, ''), url)?.companyDescription, undefined);
  assert.equal(parseDetailHtml('liepin', html.replace(intro, '') + '<div class="company-introduction"><p>企业介绍原文</p></div>', url)?.companyDescription, '企业介绍原文');
  const home = await mkdtemp(path.join(tmpdir(), 'botjob-company-'));
  const ctx = { ...mcpActionContext(home), offline: true };
  try {
    await ctx.store.put(resumeProfileKey(ctx.sessionId), { summary: '薪酬经验', skills: [], keywords: [], cities: ['上海'], industries: [], targetTitles: ['薪酬经理'], strengths: [], gaps: [] });
    await scoreJob(ctx, { html, url });
    const saved = await listJobs(ctx);
    assert.equal(saved.jobs[0].companyDescription, intro);
    assert.match(saved.displayHint, /岗位简介.*公司简介/);
    assert.equal(saved.nextAction?.tool, 'apply_jobs');
    const preview = await prepareDelivery(ctx, { jobIds: [saved.jobs[0].id] });
    assert.equal(preview.ready, true);
    assert.equal(preview.applications[0].companyDescription, intro);
    assert.equal(preview.applications[0].description, jd);
    const repeated = await prepareDelivery(ctx, { jobIds: [saved.jobs[0].id] });
    assert.deepEqual(repeated.ids, preview.ids);
    await assert.rejects(prepareDelivery(ctx, { jobIds: [saved.jobs[0].id, 'missing'] }), /未准备任何/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
