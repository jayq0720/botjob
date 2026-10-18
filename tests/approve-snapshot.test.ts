import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  applicationSnapshotHash,
  approveApplications,
  listApplications,
  markApplied,
  queueApply,
  saveCoverLetter,
  saveResume,
  saveResumeProfile,
  scoreJob,
} from "../bot/lib/actions.js";
import { mcpActionContext } from "../bot/lib/state-store.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const detailHtml = path.join(repo, "fixtures/html/zhilian-detail.html");
const jobUrl = "https://www.zhaopin.com/jobdetail/CC001.htm";
const greeting = "您好，我做了 6 年前端，做过 React 和 TypeScript。想沟通一下。";
const coverLetter = "我应聘这个前端岗位。简历里的 React 和 TypeScript 与职责相符。希望进一步沟通。";

test("approveApplications checks the snapshot and markApplied ignores unapproved rows", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-approve-"));
  const ctx = mcpActionContext(home);
  try {
    await saveResume(ctx, {
      text: "姓名：张三。6 年前端，熟悉 React、TypeScript 和性能优化，目标上海高级前端工程师。",
    });
    await saveResumeProfile(ctx, {
      summary: "6年前端，熟悉 React、TypeScript 和性能优化，目标上海高级前端。",
      targetTitles: ["高级前端工程师"],
      skills: ["React", "TypeScript"],
      keywords: ["前端"],
    });
    const html = await readFile(detailHtml, "utf8");
    const scored = await scoreJob(ctx, { html, url: jobUrl, board: "zhilian" });
    assert.equal(scored.ok, true);
    if (!scored.ok || !scored.job) return;
    await saveCoverLetter(ctx, { jobId: scored.job.id, greeting, coverLetter });
    const queued = await queueApply(ctx, {
      jobs: [
        {
          id: scored.job.id,
          board: scored.job.board,
          title: scored.job.title,
          company: scored.job.company,
          city: scored.job.city,
          url: scored.job.url,
          matchReason: scored.job.matchReason,
          matchScore: scored.job.matchScore ?? 0,
        },
      ],
    });
    const first = queued.applications[0]!;
    const snapshot = applicationSnapshotHash({
      id: first.id,
      url: first.applyUrl,
      greeting: first.greeting,
      coverLetter: first.coverLetter,
    });

    const late = await queueApply(ctx, {
      jobs: [
        {
          id: "other-job",
          board: "liepin",
          title: "后端工程师",
          company: "另一家",
          city: "北京",
          url: "https://www.liepin.com/job/other.htm",
          matchReason: "不在这次确认里",
          matchScore: 1,
        },
      ],
    });
    const secondId = late.applications[0]!.id;

    await saveCoverLetter(ctx, {
      jobId: first.id,
      greeting: "内容已经变了，不能沿用旧哈希。",
      coverLetter: "这封求职信是确认之后才写上的，不应该被旧快照批准。",
    });
    const raced = await approveApplications(ctx, {
      ids: [first.id, secondId],
      snapshots: { [first.id]: snapshot, [secondId]: "stale" },
    });
    assert.equal(raced.approved, false);
    assert.match(String(raced.message), /不一致/);
    const pending = await listApplications(ctx);
    assert.equal(pending.applications.find((app) => app.id === first.id)?.status, "queued");
    assert.equal(pending.applications.find((app) => app.id === secondId)?.status, "queued");

    const ignored = await markApplied(ctx, {
      results: [{ id: first.id, outcome: "applied", note: "还没批准" }],
    });
    assert.equal(ignored.updated, false);
    assert.deepEqual(ignored.ignored, [first.id]);
    assert.equal(
      (await listApplications(ctx)).applications.find((app) => app.id === first.id)?.status,
      "queued",
    );

    const current = (await listApplications(ctx)).applications.find((app) => app.id === first.id)!;
    const fresh = applicationSnapshotHash({
      id: current.id,
      url: current.url,
      greeting: current.greeting,
      coverLetter: current.coverLetter,
    });
    const approved = await approveApplications(ctx, {
      ids: [first.id],
      snapshots: { [first.id]: fresh },
    });
    assert.equal(approved.approved, true);
    assert.equal(approved.count, 1);
    assert.equal(
      (await listApplications(ctx)).applications.find((app) => app.id === secondId)?.status,
      "queued",
    );

    const marked = await markApplied(ctx, {
      results: [
        { id: first.id, outcome: "applied", note: "本机已投" },
        { id: secondId, outcome: "applied", note: "这条还在排队" },
      ],
    });
    assert.equal(marked.updated, true);
    assert.equal(marked.changed, 1);
    assert.deepEqual(marked.ignored, [secondId]);
    const after = await listApplications(ctx);
    assert.equal(after.applications.find((app) => app.id === first.id)?.status, "submitted_manual");
    assert.equal(after.applications.find((app) => app.id === secondId)?.status, "queued");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
