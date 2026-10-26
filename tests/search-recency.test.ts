import assert from "node:assert/strict";
import { test } from "node:test";
import { freshness, jobTime, SEARCH_MAX_AGE_MS } from "../bot/lib/boards/freshness.js";
import { parseDetailHtml, parseSearchHtml } from "../bot/lib/boards/parse.js";
import { fetchBoard, fetchText } from "../bot/lib/boards/fetch.js";
import { boardFromUrl } from "../bot/lib/jd.js";
import { assertApplyTarget, parseApplyPack } from "../bot/lib/apply-pack.js";
import { buildSearchPacks, type BoardId } from "../bot/lib/boards/index.js";
import { readFileSync } from "node:fs";

const NOW = Date.parse("2026-10-25T08:00:00Z");
const detail = (number: string, dates: Record<string, unknown> = {}) => `<script type="application/ld+json">${JSON.stringify({
  "@type": "JobPosting", title: "HR经理", hiringOrganization: { name: "测试科技公司" }, industry: "软件服务", description: "负责招聘、绩效管理、员工关系与人力资源团队建设，工作地点上海。", ...dates,
})}</script>`;
const card = (id: string) => `<div class="joblist-box__item"><a class="jobinfo__name" href="https://www.zhaopin.com/jobdetail/${id}.htm">HR经理</a></div>`;
const state = (data: object) => `<script>__INITIAL_STATE__=${JSON.stringify(data)}</script>`;

test("rolling 72-hour cutoff rejects unknown, future and expired evidence", () => {
  assert.equal(freshness({sourceUpdatedAt:new Date(NOW-SEARCH_MAX_AGE_MS).toISOString()},NOW),"recent");
  assert.equal(freshness({sourceUpdatedAt:new Date(NOW-SEARCH_MAX_AGE_MS-1).toISOString()},NOW),"old");
  assert.equal(freshness({sourceUpdatedAt:new Date(NOW+1).toISOString()},NOW),"unknown");
  assert.equal(freshness({},NOW),"unknown");
  assert.equal(freshness(jobTime("2026-10-23 12:30:00","published",NOW),NOW),"recent");
  assert.equal(jobTime("2026-10-23 12:30:00","published",NOW).sourceUpdatedAt,"2026-10-23T04:30:00.000Z");
  assert.equal(jobTime("2026-02-30","updated",NOW).sourceUpdatedAt,undefined);
  assert.equal(jobTime("2026-02-30T00:00:00Z","updated",NOW).sourceUpdatedAt,undefined);
  assert.equal(freshness(jobTime("3天前更新","updated",NOW),NOW),"old");
  assert.equal(freshness(jobTime("昨天更新","updated",NOW),NOW),"recent");
  assert.equal(jobTime("12月31日更新","updated",Date.parse("2026-01-01T12:00:00Z")).sourceUpdatedAt,"2025-12-30T16:00:00.000Z");
});

test("Liepin uses the job update label over its old publication date and ignores SEO footer", () => {
  const html=detail("1",{datePosted:"2026-10-10T09:00:00+08:00"});
  const job=parseDetailHtml("liepin",html+'<section class="job-apply-container"><span class="update-time">10月24日更新</span></section>',"https://www.liepin.com/job/1.shtml",NOW)!;
  assert.equal(freshness(job,NOW),"recent");
  assert.equal(job.sourceTimeKind,"updated");
  const old=parseDetailHtml("liepin",html+'<section class="time-factor-wrap">更新时间：2026-10-25</section>',"https://www.liepin.com/job/1.shtml",NOW)!;
  assert.equal(freshness(old,NOW),"old");
  const unknown=parseDetailHtml("liepin",detail("1")+'<span>招聘者刚刚活跃</span>',"https://www.liepin.com/job/1.shtml",NOW)!;
  assert.equal(freshness(unknown,NOW),"unknown");
});

test("Zhilian binds source timestamps to the exact job, not recommendations", () => {
  const html=card("CC1")+card("CC2")+state({positionList:[{number:"CC2",publishTime:"2026-10-24 09:00:00"}]});
  const jobs=parseSearchHtml("zhilian",html,"https://www.zhaopin.com/sou",NOW);
  assert.equal(jobs[0].sourceUpdatedAt,undefined);
  assert.equal(jobs[1].sourceUpdatedAt,"2026-10-24T01:00:00.000Z");
  const page=detail("CC1")+state({jobDetail:{detailedPosition:{number:"CC1",positionPublishTime:"2026-10-01 10:00:00"}},jobDeliverList:[{number:"CC2",publishTime:"2026-10-25 09:00:00"}]});
  assert.equal(freshness(parseDetailHtml("zhilian",page,"https://www.zhaopin.com/jobdetail/CC1.htm",NOW)!,NOW),"old");
});

test("retired sites cannot be searched, fetched or opened for application", async () => {
  const original=globalThis.fetch;
  globalThis.fetch=async()=>{throw new Error("unexpected network call");};
  try {
    for(const [board,url] of [["boss","https://www.zhipin.com/job_detail/x.html"],["job51","https://jobs.51job.com/shanghai/x.html"]]) {
      assert.equal(boardFromUrl(url),undefined);
      assert.ok("error" in await fetchText(url));
      assert.throws(()=>assertApplyTarget({board,url},"goto"));
      assert.throws(()=>buildSearchPacks({titles:["HR经理"],keywords:[],cities:["上海"]},[board as BoardId]),/仅支持/);
    }
    assert.throws(()=>parseApplyPack(readFileSync(new URL("../fixtures/sample-apply-pack-boss.json",import.meta.url),"utf8")),/拒绝/);
  } finally {globalThis.fetch=original;}
});

test("search filters old and unknown dates before returning results and keeps source evidence", async () => {
  const now=Date.now();
  const old=new Date(now-7*86400_000).toISOString();
  const fresh=new Date(now-3600_000).toISOString();
  const positions=[...Array.from({length:6},(_,i)=>({number:`OLD${i}`,publishTime:old})),{number:"FRESH",publishTime:fresh},{number:"UNKNOWN"}];
  const html=positions.map(p=>card(p.number)).join('')+state({positionList:positions});
  const original=globalThis.fetch;
  globalThis.fetch=async(input)=>{
    const url=String(input);
    if(url.startsWith("https://sou.zhaopin.com/"))return new Response(html,{headers:{"content-type":"text/html"}});
    assert.doesNotMatch(url,/OLD/);
    const id=url.includes("FRESH")?"FRESH":"UNKNOWN";
    return new Response(detail(id)+(id==="FRESH"?state({jobDetail:{detailedPosition:{number:id,publishTime:fresh}}}):""));
  };
  try {
    const result=await fetchBoard("zhilian",{titles:["HR经理"],keywords:[],cities:["上海"]});
    assert.equal(result.ok,true);
    assert.equal(result.listings.length,1);
    assert.match(result.listings[0].url,/FRESH/);
    assert.equal(result.listings[0].sourceUpdatedAt,fresh);
    assert.equal(result.freshness?.excludedOld,6);
    assert.equal(result.freshness?.excludedUnknown,1);
  } finally {globalThis.fetch=original;}
});
