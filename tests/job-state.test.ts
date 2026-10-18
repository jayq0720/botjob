import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLetter, upsertJobs, upsertLetter } from "../bot/lib/job-state.js";
import {
  applicationsKey,
  coverLettersKey,
  scoredJobsKey,
  type ApplicationRecord,
  type JobListing,
} from "../bot/lib/store.js";

test("session keys and job/letter upserts", () => {
  assert.equal(scoredJobsKey("s1"), "jobs:s1:scored");
  assert.equal(coverLettersKey("s1"), "letters:s1");
  assert.equal(applicationsKey("s1"), "apps:s1");

  const job: JobListing = {
    id: "boss-1",
    board: "boss",
    title: "前端",
    company: "云桥",
    city: "上海",
    url: "https://www.zhipin.com/job_detail/1.html",
    matchReason: "综合 80 分",
    matchScore: 80,
  };
  const stored = upsertJobs([job], [{ ...job, matchScore: 88, matchReason: "综合 88 分" }]);
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.matchScore, 88);

  const letters = upsertLetter([], {
    jobId: "boss-1",
    greeting: "您好",
    coverLetter: "这是一封足够长的求职信正文，用来说明匹配点。",
    updatedAt: "2026-10-18T00:00:00.000Z",
  });
  assert.equal(upsertLetter(letters, { ...letters[0]!, greeting: "您好，更新" }).length, 1);

  const queued: ApplicationRecord = {
    id: "app-1",
    job,
    status: "queued",
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
  };
  const next = applyLetter([queued], letters[0]!);
  assert.equal(next[0]?.greeting, "您好");
  assert.equal(next[0]?.coverNote, "您好");

  const approved: ApplicationRecord = {
    ...queued,
    id: "app-approved",
    status: "approved",
    greeting: "批准时的原文",
  };
  const kept = applyLetter([approved], {
    ...letters[0]!,
    jobId: "app-approved",
    greeting: "偷偷换掉的话术",
  });
  assert.equal(kept[0]?.status, "approved");
  assert.equal(kept[0]?.greeting, "批准时的原文");
  assert.equal(kept[0]?.coverLetter, undefined);
});
