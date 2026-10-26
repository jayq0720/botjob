import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { saveCoverLetter, saveResumeProfile, scoreJob } from "../bot/lib/actions.js";
import { mcpActionContext } from "../bot/lib/state-store.js";
import { coverLettersKey, scoredJobsKey, type CoverLetterRecord, type JobListing } from "../bot/lib/store.js";

test("concurrent scoring retains both jobs", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-score-race-"));
  const ctx = { ...mcpActionContext(home), offline: true };
  try {
    await saveResumeProfile(ctx, {
      summary: "拥有六年前端开发经验，熟悉 React 和 TypeScript，目标上海前端岗位。",
      targetTitles: ["前端工程师"], skills: ["React"], keywords: ["前端"],
    });
    const urls = ["https://www.liepin.com/job/111.shtml", "https://www.liepin.com/job/222.shtml"];
    const results = await Promise.all(urls.map((url) => scoreJob(ctx, {
      board: "liepin", url, title: "前端工程师", company: "示例公司", city: "上海",
      text: "负责 React 和 TypeScript 前端开发，要求三年以上工作经验，工作地点上海。",
    })));
    assert.ok(results.every((result) => result.ok));
    const saved = await ctx.store.get(scoredJobsKey(ctx.sessionId)) as JobListing[];
    assert.deepEqual(saved.map((job) => job.url).sort(), urls);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("concurrent cover letters retain each job's copy", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-letter-race-"));
  const ctx = mcpActionContext(home);
  try {
    await Promise.all(["first", "second"].map((jobId) => saveCoverLetter(ctx, {
      jobId, greeting: `您好，应聘 ${jobId} 岗位。`, coverLetter: `${jobId} 求职信`,
    })));
    const saved = await ctx.store.get(coverLettersKey(ctx.sessionId)) as CoverLetterRecord[];
    assert.deepEqual(saved.map((letter) => letter.jobId).sort(), ["first", "second"]);
    for (const letter of saved) assert.equal(letter.coverLetter, `${letter.jobId} 求职信`);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
