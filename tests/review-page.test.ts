import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBotjobServer } from "../mcp/server.js";
import { mcpActionContext } from "../bot/lib/state-store.js";
import { applicationsKey, scoredJobsKey, type ApplicationRecord, type JobListing } from "../bot/lib/store.js";

const recent = () => new Date(Date.now() - 3600_000).toISOString();
const job = (id: string, extra: Partial<JobListing> = {}): JobListing => ({
  id, board: "liepin", title: `薪酬经理${id}`, company: "测试科技", companyIndustry: "软件服务", companySize: "100-499人",
  companyIntro: "测试科技是一家企业软件公司，服务制造业客户。", city: "上海", description: "负责薪酬体系与绩效管理。",
  url: `https://www.liepin.com/job/${id}.shtml`, sourceUpdatedAt: recent(), matchScore: 80, matchReason: "匹配", ...extra,
});

test("job list page shows summaries and its button queues and delivers only the ticked jobs", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-review-"));
  const ctx = { ...mcpActionContext(home), offline: false };
  await ctx.store.put(scoredJobsKey(ctx.sessionId), [job("1"), job("2"), job("3", { sourceUpdatedAt: "2020-01-01T00:00:00Z" })]);
  const delivered: string[] = [];
  let opened = "";
  let finished!: () => void;
  const done = new Promise<void>(resolve => { finished = resolve; });
  const server = createBotjobServer({ actionContext: ctx, openUrl: async url => { opened = url; },
    deliveryDriver: async (app, beforeClick) => { await beforeClick(); delivered.push(app.job.id); setTimeout(finished, 50); return { outcome: "submitted", message: "成功", evidence: "投递成功" }; } });
  const client = new Client({ name: "review-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    const result = await client.callTool({ name: "open_job_list", arguments: { summaries: [{ jobId: "1", jobSummary: "AI 写的岗位简介", companySummary: "AI 写的公司简介" }] } });
    const data = result.structuredContent as { opened: boolean; url?: string };
    assert.equal(data.opened, true);
    assert.equal(data.url, undefined, "the page address is not handed to the AI");
    assert.match(opened, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);

    const page = await fetch(opened);
    assert.match(await page.text(), /一键投递所选岗位/);
    const jobs = await (await fetch(opened + "api/jobs")).json() as { jobs: Array<{ id: string; jobSummary: string; companySummary: string; companyFacts?: string; blocked?: string }> };
    const first = jobs.jobs.find(row => row.id === "1")!;
    assert.equal(first.jobSummary, "AI 写的岗位简介");
    assert.equal(first.companySummary, "AI 写的公司简介");
    assert.equal(first.companyFacts, "软件服务 · 100-499人");
    assert.equal(jobs.jobs.find(row => row.id === "2")!.companySummary, "测试科技是一家企业软件公司，服务制造业客户。");
    assert.match(jobs.jobs.find(row => row.id === "3")!.blocked ?? "", /72小时/);

    const origin = new URL(opened).origin;
    const post = (body: unknown, headers: Record<string, string> = { origin }) =>
      fetch(opened + "api/apply", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    assert.equal((await post({ jobIds: ["2"] }, { origin: "https://evil.example" })).status, 403);
    assert.equal((await fetch(opened.replace(/[0-9a-f]{32}/, "0".repeat(32)) + "api/jobs")).status, 404);
    assert.equal((await post({ jobIds: ["3"] })).status, 400);
    assert.deepEqual(delivered, []);

    const started = await post({ jobIds: ["2"] });
    assert.equal(started.status, 202);
    await done;
    assert.deepEqual(delivered, ["2"]);
    const apps = await ctx.store.get(applicationsKey(ctx.sessionId)) as ApplicationRecord[];
    assert.equal(apps.find(app => app.job.id === "2")?.status, "submitted_auto");
    const after = await (await fetch(opened + "api/jobs")).json() as { jobs: Array<{ id: string; blocked?: string }> };
    assert.equal(after.jobs.find(row => row.id === "2")!.blocked, "已投递");
  } finally { await client.close(); await server.closeReview(); await server.close(); await rm(home, { recursive: true, force: true }); }
});

test("open_job_list failure does not return the page address or its token", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-review-"));
  const ctx = { ...mcpActionContext(home), offline: false };
  let secret = "";
  const server = createBotjobServer({ actionContext: ctx, openUrl: async url => { secret = url; throw new Error("browser failed " + url); } });
  const client = new Client({ name: "review-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  const written: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: string | Uint8Array) => { written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString()); return true; }) as typeof process.stderr.write;
  try {
    const result = await client.callTool({ name: "open_job_list", arguments: {} });
    const data = result.structuredContent as { opened: boolean; url?: string };
    const token = new URL(secret).pathname.split("/").filter(Boolean)[0];
    const dumped = JSON.stringify(result);
    assert.equal(data.opened, false);
    assert.equal(Object.hasOwn(data, "url"), false);
    assert.equal(dumped.includes(secret), false);
    assert.equal(dumped.includes(token), false);
    assert.match(written.join(""), new RegExp(token));
  } finally {
    process.stderr.write = original;
    await client.close(); await server.closeReview(); await server.close(); await rm(home, { recursive: true, force: true });
  }
});

test("two concurrent apply posts accept only one", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-review-"));
  const ctx = { ...mcpActionContext(home), offline: false };
  await ctx.store.put(scoredJobsKey(ctx.sessionId), [job("1"), job("2")]);
  let opened = "";
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const server = createBotjobServer({ actionContext: ctx, openUrl: async url => { opened = url; },
    deliveryDriver: async (_app, beforeClick) => { await beforeClick(); await hold; return { outcome: "submitted", message: "成功", evidence: "投递成功" }; } });
  const client = new Client({ name: "review-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  try {
    await client.callTool({ name: "open_job_list", arguments: {} });
    const origin = new URL(opened).origin;
    const post = (body: string) => fetch(opened + "api/apply", { method: "POST", headers: { "content-type": "application/json", origin }, body });
    const bad = await post("{");
    assert.equal(bad.status, 400);
    const [left, right] = await Promise.all([post(JSON.stringify({ jobIds: ["2"] })), post(JSON.stringify({ jobIds: ["2"] }))]);
    assert.deepEqual([left.status, right.status].sort(), [202, 409]);
  } finally {
    release();
    await new Promise(resolve => setTimeout(resolve, 50));
    await client.close(); await server.closeReview(); await server.close(); await rm(home, { recursive: true, force: true });
  }
});
