import assert from "node:assert/strict";
import { test } from "node:test";
import { assertApplyTarget, parseApplyPack } from "../bot/lib/apply-pack.js";
import { parseDetailHtml, parseZhilianApi } from "../bot/lib/boards/parse.js";
import { listingFromPosting } from "../bot/lib/jd.js";
import { queueJobSchema } from "../bot/tools/queue_apply.js";
import type { ResumeProfile } from "../bot/lib/store.js";

const profile: ResumeProfile = {
  summary: "6年前端。",
  yearsExperience: 6,
  skills: ["React"],
  targetTitles: ["前端"],
  cities: ["上海"],
  industries: [],
  strengths: [],
  gaps: [],
  keywords: [],
  updatedAt: "2026-10-18T00:00:00.000Z",
};

const job = {
  id: "zhilian-1",
  board: "zhilian" as const,
  title: "前端",
  company: "甲",
  city: "上海",
  url: "https://www.zhaopin.com/jobdetail/CC1.htm",
  matchReason: "综合 80 分",
  matchScore: 80,
};

test("queue_apply only accepts an https URL on the named board", () => {
  assert.equal(queueJobSchema.safeParse(job).success, true);
  assert.equal(
    queueJobSchema.safeParse({ ...job, url: "https://evil.example/x" }).success,
    false,
  );
  assert.equal(
    queueJobSchema.safeParse({
      ...job,
      board: "zhilian",
      url: "https://www.zhipin.com/job_detail/a.html",
    }).success,
    false,
  );
  assert.equal(
    queueJobSchema.safeParse({ ...job, url: "http://www.zhaopin.com/jobdetail/CC1.htm" }).success,
    false,
  );
});

test("parseApplyPack rejects off-board and mismatched URLs", () => {
  const pack = {
    version: 1,
    exportedAt: "2026-10-18T00:00:00.000Z",
    sessionId: "s",
    items: [{ ...job, status: "approved" }],
  };
  assert.equal(parseApplyPack(JSON.stringify(pack)).items[0]?.url, job.url);
  assert.throws(
    () =>
      parseApplyPack(
        JSON.stringify({
          ...pack,
          items: [{ ...job, url: "https://evil.example/x", status: "approved" }],
        }),
      ),
    /拒绝打开链接/,
  );
  assert.throws(
    () =>
      parseApplyPack(
        JSON.stringify({
          ...pack,
          items: [
            {
              ...job,
              board: "boss",
              url: "https://www.zhaopin.com/jobdetail/CC1.htm",
              status: "approved",
            },
          ],
        }),
      ),
    /拒绝打开链接/,
  );
});

test("listingFromPosting rejects a URL that is not on that board", () => {
  assert.equal(
    listingFromPosting(
      {
        board: "zhilian",
        title: "前端",
        company: "甲",
        city: "上海",
        description: "负责 React 业务开发，工作城市上海。",
        url: job.url,
        jdStatus: "detail",
      },
      profile,
    ).url,
    job.url,
  );
  assert.throws(
    () =>
      listingFromPosting(
        {
          board: "zhilian",
          title: "前端",
          company: "甲",
          city: "上海",
          description: "负责 React 业务开发，工作城市上海。",
          url: "https://evil.example/x",
          jdStatus: "detail",
        },
        profile,
      ),
    /https/,
  );
});

test("local apply checks the URL before goto and before filling", () => {
  const evil = { url: "https://evil.example/x", board: "zhilian" };
  assert.throws(() => assertApplyTarget(evil, "goto"), /拒绝打开链接/);
  assert.throws(() => assertApplyTarget(evil, "fill"), /拒绝在该页面填入打招呼语/);
  assert.doesNotThrow(() =>
    assertApplyTarget(
      { url: "https://www.liepin.com/job/abc.shtml", board: "liepin" },
      "goto",
    ),
  );
  assert.doesNotThrow(() =>
    assertApplyTarget(
      { url: "https://www.liepin.com/job/abc.shtml", board: "liepin" },
      "fill",
    ),
  );
});

test("JSON-LD and 智联 API drop off-site job URLs", () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    "@type": "JobPosting",
    title: "前端工程师",
    hiringOrganization: { name: "甲公司" },
    description: "负责 React 与 TypeScript 业务开发，工作城市上海，要求本科。",
    url: "https://evil.example/x",
  })}</script>`;
  const detail = parseDetailHtml("liepin", html, "https://www.liepin.com/job/1.shtml");
  assert.equal(detail?.url, "https://www.liepin.com/job/1.shtml");
  assert.doesNotMatch(detail?.url ?? "", /evil\.example/);

  const api = parseZhilianApi({
    data: {
      results: [
        {
          jobName: "前端工程师",
          companyName: "甲",
          positionURL: "https://evil.example/x",
          salary: "20-30k",
        },
      ],
    },
  });
  assert.equal(api.ok, false);
});
