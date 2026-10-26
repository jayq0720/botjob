import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { chromium } from "playwright";
import { createExtensionBridge } from "../bot/lib/boards/extension-bridge.js";
import { createExtensionAccess } from "../bot/lib/boards/extension-access.js";
import { fetchBoard } from "../bot/lib/boards/fetch.js";
import type { ApplicationRecord } from "../bot/lib/store.js";

const executablePath = existsSync(chromium.executablePath()) ? chromium.executablePath() : '/usr/bin/chromium';
test('actual extension reuses browser cookies for search and performs a confirmed one-time application', { skip: !existsSync(executablePath) || process.env.BOTJOB_TEST_EXTENSION !== "1" ? "Requires a browser that permits unpacked extensions; set BOTJOB_TEST_EXTENSION=1 locally" : false, timeout: 60_000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'botjob-extension-'));
  const extension = path.resolve('extension');
  const token = 'b'.repeat(64);
  const bridge = await createExtensionBridge(token, 0);
  const access = createExtensionAccess(async () => ({ ...bridge, pairingUrl: `${bridge.address}/#${token}` }), async () => {});
  const context = await chromium.launchPersistentContext(directory, { headless: true, executablePath,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const url = 'https://www.liepin.com/job/123.shtml';
  const app: ApplicationRecord = { id:'a1', status:'queued', createdAt:'', updatedAt:'', job: { id:'j1', board:'liepin', title:'薪酬经理', company:'示例科技', companyIndustry:'软件服务', city:'上海', url,
    sourceUpdatedAt: new Date(Date.now()-3600_000).toISOString(), matchScore:80, matchReason:'测试' } };
  let cookieReads = 0, journal = 0;
  const jd = '负责薪酬核算、绩效管理、人力预算及员工关系等工作。';
  const intro = '公司开发企业软件，提供制造业数字化产品。';
  const ld = `<script type="application/ld+json">${JSON.stringify({ '@type':'JobPosting', title:app.job.title, description:jd, dateModified:app.job.sourceUpdatedAt,
    industry:'软件服务', hiringOrganization:{name:app.job.company,description:intro}, url })}</script>`;
  try {
    await context.addCookies([{name:'fixture_session',value:'already-logged-in',url:'https://www.liepin.com'}]);
    await context.route('https://**/*', async route => {
      if ((await route.request().allHeaders()).cookie?.includes('fixture_session=already-logged-in')) cookieReads++;
      const detail = route.request().url().includes('/job/');
      const markup = detail ? `${ld}<section class="job-apply-container"><span class="name">薪酬经理</span><span class="update-time">${app.job.sourceUpdatedAt}</span><button onclick="window.clicks=(window.clicks||0)+1;this.textContent='已投递'">投递简历</button></section><div class="company-info"><span class="name">示例科技</span></div><div data-selector="job-intro-content">${jd}</div><div class="company-introduction">${intro}</div>`
        : `<div class="job-card-pc-container"><a href="${url}"><div class="ellipsis-1" title="薪酬经理">薪酬经理</div></a><span class="company-name">示例科技</span><div class="company-tags-box">软件服务</div></div>`;
      await route.fulfill({contentType:'text/html; charset=utf-8',body:markup});
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', {timeout:10000});
    await worker.evaluate(`(async()=>{await chrome.storage.local.set({connection:${JSON.stringify({address:bridge.address,token})}});void loop();})()`);
    for (let i=0;i<100 && !bridge.connected();i++) await new Promise(resolve=>setTimeout(resolve,50));
    assert.equal(bridge.connected(),true);
    const opened = await access.open('liepin');
    assert.equal(opened.status,'awaiting_login');
    const report = await fetchBoard('liepin',{titles:['薪酬经理'],cities:['上海'],keywords:[]},{read:access.reader('liepin')});
    assert.equal(report.ok,true,JSON.stringify(report));
    assert.equal(report.listings[0].companyDescription,intro);
    assert.ok(cookieReads>=2,'search and details must use the existing browser session');
    const result = await access.deliver(app,async()=>{journal++;});
    assert.equal(result.outcome,'submitted',JSON.stringify(result));
    assert.equal(journal,1);
    // The account/browser itself remains open; only botjob's transient tabs are closed.
    assert.ok(context.pages().length>0);
  } finally { await bridge.close(); await context.close(); await rm(directory,{recursive:true,force:true}); }
});
