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

const nextGreeting = "失败之后按最新简历重写的打招呼语，请重新审批。";
const nextLetter = "这是重新入队要用的新求职信。旧的失败或跳过记录要留着，这条必须再审批。";

async function requeueAfter(
  outcome: "failed" | "skipped",
): Promise<void> {
  const home = await mkdtemp(path.join(tmpdir(), `botjob-requeue-${outcome}-`));
  const ctx = mcpActionContext(home);
  const posting = job("https://www.zhaopin.com/jobdetail/CC009.htm", "zhilian-cc009");
  try {
    await saveCoverLetter(ctx, { jobId: posting.id, greeting, coverLetter });
    const first = await queueApply(ctx, { jobs: [posting] });
    const oldId = first.applications[0]!.id;
    const hash = applicationSnapshotHash({
      id: oldId,
      url: first.applications[0]!.applyUrl,
      greeting: first.applications[0]!.greeting,
      coverLetter: first.applications[0]!.coverLetter,
    });
    const approved = await approveApplications(ctx, {
      ids: [oldId],
      snapshots: { [oldId]: hash },
    });
    assert.equal(approved.approved, true);
    const marked = await markApplied(ctx, {
      results: [{ id: oldId, outcome, note: outcome }],
    });
    assert.equal(marked.updated, true);

    await saveCoverLetter(ctx, {
      jobId: posting.id,
      greeting: nextGreeting,
      coverLetter: nextLetter,
    });
    const again = await queueApply(ctx, { jobs: [posting] });
    assert.equal(again.created, 1);
    assert.equal(again.applications[0]?.reused, false);
    assert.equal(again.applications[0]?.status, "queued");
    assert.notEqual(again.applications[0]?.id, oldId);
    assert.equal(again.applications[0]?.greeting, nextGreeting);
    assert.equal(again.applications[0]?.coverLetter, nextLetter);

    const listed = await listApplications(ctx);
    assert.equal(listed.count, 2);
    assert.equal(listed.applications.find((app) => app.id === oldId)?.status, outcome);
    const fresh = listed.applications.find((app) => app.id === again.applications[0]?.id);
    assert.equal(fresh?.status, "queued");
    assert.equal(fresh?.greeting, nextGreeting);
    assert.equal(fresh?.coverLetter, nextLetter);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

test("queueApply after failed creates a new queued row and keeps the old one", async () => {
  await requeueAfter("failed");
});

test("queueApply after skipped creates a new queued row and keeps the old one", async () => {
  await requeueAfter("skipped");
});

test("query string and trailing slash are the same posting", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-canonical-"));
  const ctx = mcpActionContext(home);
  const cases: { board: QueueJobInput["board"]; plain: string; decorated: string }[] = [
    {
      board: "zhilian",
      plain: "https://www.zhaopin.com/jobdetail/CC001.htm",
      decorated: "https://WWW.Zhaopin.com/jobdetail/CC001.htm/?ref=list",
    },
    {
      board: "liepin",
      plain: "https://www.liepin.com/job/198.htm",
      decorated: "https://www.liepin.com/job/198.htm?d_sfrom=search_prime",
    },
  ];
  try {
    for (const [index, item] of cases.entries()) {
      const first = await queueApply(ctx, {
        jobs: [job(item.plain, `${item.board}-plain`, item.board)],
      });
      assert.equal(first.created, 1);
      const second = await queueApply(ctx, {
        jobs: [job(item.decorated, `${item.board}-decorated`, item.board)],
      });
      assert.equal(second.created, 0);
      assert.equal(second.applications[0]?.reused, true);
      assert.equal(second.applications[0]?.id, first.applications[0]?.id);
      assert.equal((await listApplications(ctx)).count, index + 1);
    }
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("different job paths stay two applications", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-two-paths-"));
  const ctx = mcpActionContext(home);
  try {
    const both = await queueApply(ctx, {
      jobs: [
        job("https://www.liepin.com/job/abc123.html", "boss-abc", "liepin"),
        job("https://www.liepin.com/job/def456.html?ka=x", "boss-def", "liepin"),
      ],
    });
    assert.equal(both.created, 2);
    assert.equal(both.applications[0]?.reused, false);
    assert.equal(both.applications[1]?.reused, false);
    assert.notEqual(both.applications[0]?.id, both.applications[1]?.id);
    const listed = await listApplications(ctx);
    assert.equal(listed.count, 2);
    assert.equal(
      listed.applications.filter((app) => app.url.includes("abc123")).length,
      1,
    );
    assert.equal(
      listed.applications.filter((app) => app.url.includes("def456")).length,
      1,
    );
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("approveApplications and queueApply both survive a concurrent write", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-approve-race-"));
  const ctx = mcpActionContext(home);
  const posting = job("https://www.zhaopin.com/jobdetail/CC010.htm", "zhilian-cc010");
  const other = job("https://www.liepin.com/job/other-race.htm", "liepin-other", "liepin");
  try {
    const first = await queueApply(ctx, { jobs: [posting] });
    const row = first.applications[0]!;
    const hash = applicationSnapshotHash({
      id: row.id,
      url: row.applyUrl,
      greeting: row.greeting,
      coverLetter: row.coverLetter,
    });
    const [approved, added] = await Promise.all([
      approveApplications(ctx, { ids: [row.id], snapshots: { [row.id]: hash } }),
      queueApply(ctx, { jobs: [other] }),
    ]);
    assert.equal(approved.approved, true);
    assert.equal(approved.count, 1);
    assert.equal(added.created, 1);
    const listed = await listApplications(ctx);
    assert.equal(listed.count, 2);
    assert.equal(listed.applications.find((app) => app.id === row.id)?.status, "approved");
    const extra = listed.applications.find((app) => app.id === added.applications[0]?.id);
    assert.equal(extra?.status, "queued");
    assert.equal(extra?.url, other.url);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
