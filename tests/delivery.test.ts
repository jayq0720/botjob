import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { executeDelivery, previewDelivery } from "../bot/lib/actions/delivery.js";
import { markApplied, queueApply, saveCoverLetter } from "../bot/lib/actions.js";
import { applicationsKey, type ApplicationRecord } from "../bot/lib/store.js";
import { mcpActionContext } from "../bot/lib/state-store.js";

export function deliveryApp(id = "1"): ApplicationRecord {
  return { id, status: "queued", createdAt: "2026-01-01", updatedAt: "2026-01-01",
    job: { id: `job-${id}`, board: "liepin", title: "薪酬经理", company: "测试科技公司", companyIndustry: "软件服务", city: "上海",
      url: `https://www.liepin.com/job/${id}.shtml`, sourceUpdatedAt: new Date(Date.now() - 3600000).toISOString(),
      matchScore: 80, matchReason: "测试", description: "负责薪酬核算和绩效管理，以及员工关系和人力成本预算。" } };
}

async function fixture(fn: (ctx: ReturnType<typeof mcpActionContext>) => Promise<void>) {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-delivery-"));
  const ctx = { ...mcpActionContext(home), offline: false };
  await ctx.store.put(applicationsKey(ctx.sessionId), [deliveryApp("1"), deliveryApp("2")]);
  try { await fn(ctx); } finally { await rm(home, { recursive: true, force: true }); }
}
const rows = async (ctx: ReturnType<typeof mcpActionContext>) => await ctx.store.get(applicationsKey(ctx.sessionId)) as ApplicationRecord[];

test("delivery journals before clicking, confirms each success, and rejects duplicates", async () => fixture(async ctx => {
  const preview = await previewDelivery(ctx, ["1", "2"]);
  let clicks = 0;
  const result = await executeDelivery(ctx, preview.ids, preview.snapshotHash, async (app, beforeClick) => {
    await beforeClick();
    assert.equal((await rows(ctx)).find(row => row.id === app.id)?.status, "submission_unknown");
    await assert.rejects(beforeClick(), /只能点击一次/);
    clicks++;
    return { outcome: "submitted", message: "成功", evidence: "已投递" };
  });
  assert.equal(result.executed, true);
  assert.equal(clicks, 2);
  assert.ok((await rows(ctx)).every(row => row.status === "submitted_auto"));
  const repeat = await executeDelivery(ctx, preview.ids, preview.snapshotHash, async () => { throw new Error("must not run"); });
  assert.equal(repeat.executed, false);
  const old = (await rows(ctx))[0];
  await queueApply(ctx, { jobs: [old.job] });
  assert.equal((await rows(ctx)).length, 2);
}));

test("login pauses batch without clicking remaining applications", async () => fixture(async ctx => {
  const preview = await previewDelivery(ctx, ["1", "2"]);
  let calls = 0;
  const result = await executeDelivery(ctx, preview.ids, preview.snapshotHash, async () => {
    calls++; return { outcome: "paused", message: "请登录" };
  });
  assert.equal(calls, 1);
  assert.ok((await rows(ctx)).every(row => row.status === "queued"));
  assert.equal(result.results[0].outcome, "paused");
}));

test("uncertain click is frozen, cannot be duplicated or edited, and requires manual resolution", async () => fixture(async ctx => {
  const preview = await previewDelivery(ctx, ["1", "2"]);
  await executeDelivery(ctx, preview.ids, preview.snapshotHash, async (_app, beforeClick) => {
    await beforeClick();
    const during = await markApplied(ctx, { results: [{ id: "1", outcome: "failed" }] });
    assert.equal(during.updated, false);
    throw new Error("connection lost after remote action");
  });
  assert.equal((await rows(ctx))[0].status, "submission_unknown");
  assert.equal((await rows(ctx))[1].status, "queued");
  await saveCoverLetter(ctx, { jobId: "1", greeting: "new", coverLetter: "new letter" });
  assert.equal((await rows(ctx))[0].greeting, undefined);
  await queueApply(ctx, { jobs: [(await rows(ctx))[0].job] });
  assert.equal((await rows(ctx)).length, 2);
  await markApplied(ctx, { results: [{ id: "1", outcome: "applied", note: "用户核对网站确认" }] });
  assert.equal((await rows(ctx))[0].status, "submitted_manual");
}));

test("changed snapshot, exclusion policy and offline mode never invoke delivery", async () => fixture(async ctx => {
  const preview = await previewDelivery(ctx, ["1"]);
  const apps = await rows(ctx); apps[0].job.title = "Changed";
  await ctx.store.put(applicationsKey(ctx.sessionId), apps);
  const driver = async () => { throw new Error("unexpected browser call"); };
  assert.equal((await executeDelivery(ctx, ["1"], preview.snapshotHash, driver)).executed, false);
  apps[0].job.company = "测试保险公司";
  await ctx.store.put(applicationsKey(ctx.sessionId), apps);
  assert.equal((await previewDelivery(ctx, ["1"])).ready, false);
  assert.equal((await executeDelivery({ ...ctx, offline: true }, ["2"], "any", driver)).executed, false);
}));

test("cancellation before a click leaves the batch queued", async () => fixture(async ctx => {
  const preview = await previewDelivery(ctx, ["1", "2"]);
  const controller = new AbortController();
  await executeDelivery(ctx, preview.ids, preview.snapshotHash, async (_app, beforeClick) => {
    controller.abort();
    await beforeClick();
    throw new Error("must never reach a click");
  }, controller.signal);
  assert.ok((await rows(ctx)).every(row => row.status === "queued"));
}));

test("concurrent delivery calls cannot both submit even with the same snapshot", async () => fixture(async ctx => {
  const preview = await previewDelivery(ctx, ["1"]);
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const entered = new Promise<void>(resolve => { started = resolve; });
  const first = executeDelivery(ctx, ["1"], preview.snapshotHash, async (_app, beforeClick) => {
    started(); await gate; await beforeClick(); return { outcome: "submitted", message: "ok", evidence: "已投递" };
  });
  await entered;
  try { assert.equal((await executeDelivery(ctx, ["1"], preview.snapshotHash, async () => { throw new Error("duplicate"); })).executed, false); }
  finally { release(); }
  await first;
}));
