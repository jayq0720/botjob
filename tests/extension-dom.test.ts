import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { chromium } from 'playwright';
const executablePath = existsSync(chromium.executablePath()) ? chromium.executablePath() : '/usr/bin/chromium';

test('extension DOM guards block forms, chat, ambiguity, stale state and duplicate clicks on both boards', {skip:!existsSync(executablePath),timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true,executablePath});
 const script=await readFile('extension/page.js','utf8');
 const cases=[
  {html:'<button onclick="window.clicks++;this.textContent=\'已投递\'">投递简历</button>',click:true},
  {html:'<button>投递简历</button><button>立即申请</button>',click:false},
  {html:'<a>聊一聊</a>',click:false},
  {html:'<button>投递简历</button><input required>',click:false},
  {html:'<button>投递简历</button><div role="dialog">选择简历</div>',click:false},
  {html:'<button>投递简历</button><div role="alert">投递成功</div>',click:false},
  {html:'<button>已投递</button>',click:false},
 ];
 try{
  for(const board of ['liepin','zhilian'])for(const scenario of cases){
   const page=await browser.newPage();
   await page.setContent(`<script>window.clicks=0</script><section class="${board==='liepin'?'job-apply-container':'summary-planes'}">${scenario.html}</section>`);
   await page.addScriptTag({content:script});
   const inspect=await page.evaluate<{fingerprint:string;clicked:boolean;done:boolean}>(`BotjobPage.applicationDom('${board}','inspect')`);
   const result=await page.evaluate<{fingerprint:string;clicked:boolean;done:boolean}>(`BotjobPage.applicationDom('${board}','click',${JSON.stringify(inspect.fingerprint)})`);
   assert.equal(result.clicked,scenario.click,scenario.html);
   assert.equal(await page.evaluate('window.clicks'),scenario.click?1:0);
   if(scenario.click){
    assert.equal((await page.evaluate<{fingerprint:string;clicked:boolean;done:boolean}>(`BotjobPage.applicationDom('${board}','result')`)).done,true);
    const retry=await page.evaluate<{fingerprint:string;clicked:boolean;done:boolean}>(`BotjobPage.applicationDom('${board}','click',${JSON.stringify(inspect.fingerprint)})`);
    assert.equal(retry.clicked,false);
    assert.equal(await page.evaluate('window.clicks'),1);
   }
   await page.close();
  }
  const page=await browser.newPage();
  await page.setContent('<section class="job-apply-container"><span class="name">原岗位</span><button onclick="window.clicked=true">投递简历</button></section>');
  await page.addScriptTag({content:script});
  const before=await page.evaluate<{fingerprint:string;clicked:boolean;done:boolean}>("BotjobPage.applicationDom('liepin','inspect')");
  await page.locator('.name').evaluate(element=>{element.textContent='另一个岗位';});
  assert.equal((await page.evaluate<{fingerprint:string;clicked:boolean;done:boolean}>(`BotjobPage.applicationDom('liepin','click',${JSON.stringify(before.fingerprint)})`)).clicked,false);
  assert.equal(await page.evaluate('Boolean(window.clicked)'),false);
 }finally{await browser.close();}
});
