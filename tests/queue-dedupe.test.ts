import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  applicationSnapshotHash,
  approveApplications,
  listApplications,
  markApplied,
  queueApply,
  saveCoverLetter,
  type QueueJobInput,
} from "../bot/lib/actions.js";
import { mcpActionContext } from "../bot/lib/state-store.js";

const greeting = "您好，我做了 6 年前端，做过 React 和 TypeScript。想沟通一下。";
const coverLetter = "我应聘这个前端岗位。简历里的 React 和 TypeScript 与职责相符。希望进一步沟通。";

function job(url: string, id: string, board: QueueJobInput["board"] = "zhilian"): QueueJobInput {
  return {
    id,
    board,
    title: "高级前端工程师",
    company: "星河科技",
    city: "上海",
    url,
    matchReason: "匹配",
    matchScore: 80,
  };
}

test("queueApply returns the existing row and does not reset approved copy", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-dedupe-"));
  const ctx = mcpActionContext(home);
  const url = "https://www.zhaopin.com/jobdetail/CC001.htm";
  const firstJob = job(url, "zhilian-cc001");
  try {
    await saveCoverLetter(ctx, { jobId: firstJob.id, greeting, coverLetter });
    const first = await queueApply(ctx, { jobs: [firstJob] });
    const again = await queueApply(ctx, {
      jobs: [job("https://WWW.zhaopin.com/jobdetail/CC001.htm#top", "other-id")],
    });
    assert.equal(again.created, 0);
    assert.equal(again.applications[0]?.reused, true);
    assert.equal(again.applications[0]?.id, first.applications[0]?.id);
    assert.equal(again.applications[0]?.status, "queued");
    assert.equal((await listApplications(ctx)).count, 1);

    const current = again.applications[0]!;
    const hash = applicationSnapshotHash({
      id: current.id,
      url: current.applyUrl,
      greeting: current.greeting,
      coverLetter: current.coverLetter,
    });
    const approved = await approveApplications(ctx, {
      ids: [current.id],
      snapshots: { [current.id]: hash },
    });
    assert.equal(approved.approved, true);

    await saveCoverLetter(ctx, {
      jobId: current.id,
      greeting: "这是批准之后想换掉的打招呼语。",
      coverLetter: "这封求职信也不应该覆盖已经批准的原文内容。",
    });
    const afterApproval = await queueApply(ctx, { jobs: [firstJob] });
    assert.equal(afterApproval.created, 0);
    assert.equal(afterApproval.applications[0]?.id, current.id);
    assert.equal(afterApproval.applications[0]?.status, "approved");
    assert.equal(afterApproval.applications[0]?.greeting, greeting);
    assert.equal(afterApproval.applications[0]?.coverLetter, coverLetter);
    assert.equal((await listApplications(ctx)).count, 1);

    const marked = await markApplied(ctx, {
      results: [{ id: current.id, outcome: "applied", note: "本机已投" }],
    });
    assert.equal(marked.updated, true);
    const afterApplied = await queueApply(ctx, { jobs: [firstJob] });
    assert.equal(afterApplied.created, 0);
    assert.equal(afterApplied.applications[0]?.status, "submitted_manual");
    assert.equal(afterApplied.applications[0]?.greeting, greeting);
    assert.equal(afterApplied.applications[0]?.coverLetter, coverLetter);
    const listed = await listApplications(ctx);
    assert.equal(listed.count, 1);
    assert.equal(listed.applications[0]?.status, "submitted_manual");
    assert.equal(listed.applications[0]?.greeting, greeting);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("two concurrent queueApply calls create one row", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-dedupe-race-"));
  const ctx = mcpActionContext(home);
  const posting = job("https://www.liepin.com/job/race.htm", "liepin-race", "liepin");
  try {
    const [left, right] = await Promise.all([
      queueApply(ctx, { jobs: [posting] }),
      queueApply(ctx, { jobs: [posting] }),
    ]);
    assert.equal(left.applications[0]?.id, right.applications[0]?.id);
    const created = [left, right].filter((result) => result.created === 1);
    assert.equal(created.length, 1);
    const listed = await listApplications(ctx);
    assert.equal(listed.count, 1);
    assert.equal(listed.applications[0]?.url, "https://www.liepin.com/job/race.htm");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
