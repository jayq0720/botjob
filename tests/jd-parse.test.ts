import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { listingFromPosting, parsePastedJd } from "../bot/lib/jd.js";
import { parseBossApi, parseDetailHtml, parseSearchHtml, parseZhilianApi } from "../bot/lib/boards/parse.js";
import type { BoardId, ResumeProfile } from "../bot/lib/store.js";

const profile: ResumeProfile = {
  summary: "6年前端，带过小组，熟悉 React 和 TypeScript。",
  yearsExperience: 6,
  education: "本科",
  currentTitle: "前端负责人",
  targetTitles: ["高级前端工程师"],
  skills: ["React", "TypeScript", "Node.js", "性能优化"],
  cities: ["上海"],
  industries: [],
  salaryExpectation: "40-50K",
  strengths: [],
  gaps: [],
  keywords: ["前端"],
  updatedAt: "2026-10-18T00:00:00.000Z",
};

function read(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

test("pasted JD keeps only fields that were written down", () => {
  const parsed = parsePastedJd({
    board: "liepin",
    text: [
      "职位：前端工程师",
      "公司：元辰云谷科技",
      "城市：上海-徐汇区",
      "薪资：20-30k·14薪",
      "经验：2年以上",
      "学历：统招本科",
      "负责 React 与 TypeScript 业务前端，要求性能优化经验，工作城市上海。",
    ].join("\n"),
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.job.company, "元辰云谷科技");
  assert.equal(parsed.job.jdStatus, "pasted");
  assert.equal(parsePastedJd({ board: "boss", text: "太短" }).ok, false);
});

test("four boards: HTML fixtures parse and score", () => {
  const cases: Array<{
    board: BoardId;
    search: string;
    detail: string;
    page: string;
    title: string;
    company: string;
  }> = [
    {
      board: "zhilian",
      search: "html/zhilian-search.html",
      detail: "html/zhilian-detail.html",
      page: "https://www.zhaopin.com/jobdetail/CC001.htm",
      title: "高级前端工程师",
      company: "星河科技",
    },
    {
      board: "liepin",
      search: "html/liepin-search.html",
      detail: "html/liepin-detail.html",
      page: "https://www.liepin.com/job/1982228597.shtml",
      title: "外滩豪宅销售",
      company: "上海六兴房地产经纪有限公司",
    },
    {
      board: "job51",
      search: "html/job51-search.html",
      detail: "html/job51-detail.html",
      page: "https://jobs.51job.com/shanghai/12345678.html",
      title: "前端开发工程师",
      company: "浦江软件",
    },
    {
      board: "boss",
      search: "html/boss-search.html",
      detail: "html/boss-detail.html",
      page: "https://www.zhipin.com/job_detail/abc123.html",
      title: "资深前端工程师",
      company: "云桥网络",
    },
  ];

  const scored = cases.map((item) => {
    const cards = parseSearchHtml(item.board, read(item.search), item.page);
    assert.ok(cards.length >= 1, item.board);
    const detail = parseDetailHtml(item.board, read(item.detail), item.page);
    assert.ok(detail, item.board);
    assert.equal(detail?.title, item.title);
    assert.equal(detail?.company, item.company);
    assert.ok((detail?.description.length ?? 0) >= 20);
    const listing = listingFromPosting(detail!, profile);
    return {
      board: item.board,
      searchTitle: cards[0]?.title,
      title: listing.title,
      company: listing.company,
      city: listing.city,
      salary: listing.salary,
      experience: listing.experience,
      education: listing.education,
      matchScore: listing.matchScore,
      summary: listing.matchReason,
    };
  });
  console.log(JSON.stringify(scored, null, 2));
  const byBoard = Object.fromEntries(scored.map((item) => [item.board, item]));
  assert.equal(byBoard.liepin.searchTitle, "前端工程师");
  assert.equal(byBoard.boss.city, "上海");
  assert.ok(byBoard.zhilian.matchScore > byBoard.liepin.matchScore);

  const liveCards = parseSearchHtml(
    "zhilian",
    read("html/zhilian-search-live.html"),
    "https://www.zhaopin.com/sou/",
  );
  assert.equal(liveCards[0]?.title, "web前端开发工程师五险一金");
  assert.equal(liveCards[0]?.company, "重庆清智企业管理有限公司");
  assert.equal(liveCards[0]?.salary, "1-1.8万·13薪");
  assert.equal(liveCards[0]?.city, "长沙·开福·东风路");
  assert.match(liveCards[0]?.url ?? "", /^https:\/\/www\.zhaopin\.com\/jobdetail\//);
  const liveDetail = parseDetailHtml(
    "zhilian",
    read("html/zhilian-detail-live.html"),
    liveCards[0]!.url,
  );
  assert.equal(liveDetail?.title, "web前端开发工程师五险一金");
  assert.equal(liveDetail?.company, "重庆清智企业管理有限公司");
  assert.equal(liveDetail?.salary, undefined);
  assert.equal(liveDetail?.experience, "1-3年");
  assert.equal(liveDetail?.education, "大专");
  assert.match(liveDetail?.city ?? "", /长沙/);
  assert.match(liveDetail?.description ?? "", /前端架构/);
});

test("recorded blocked payloads do not become jobs", () => {
  const boss = parseBossApi(JSON.parse(read("blocked/boss-api-blocked.json")));
  assert.equal(boss.ok, false);
  if (!boss.ok) assert.equal(boss.reason, "blocked");
  const zhilian = parseZhilianApi(JSON.parse(read("blocked/zhilian-api-empty.json")));
  assert.equal(zhilian.ok, false);
  if (!zhilian.ok) assert.equal(zhilian.reason, "empty");
  const sample = parseBossApi(JSON.parse(read("html/boss-joblist.sample.json")));
  assert.equal(sample.ok, true);
  if (sample.ok) assert.equal(sample.jobs[0]?.company, "云桥网络");
});
