import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createBotjobServer } from "../mcp/server.js";
import { mcpActionContext } from "../bot/lib/state-store.js";
import { applicationsKey, type ApplicationRecord } from "../bot/lib/store.js";

for (const scenario of ["accept", "decline", "changed", "unsupported"] as const) {
  test(`one-click MCP ${scenario}: preview and confirmation precede browser actions`, async () => {
    const home = await mkdtemp(path.join(tmpdir(), "botjob-delivery-mcp-"));
    const ctx = { ...mcpActionContext(home), offline: false };
    const app: ApplicationRecord = { id: "app1", status: "queued", createdAt: "", updatedAt: "", job: {
      id: "j1", board: "liepin", title: "薪酬经理", company: "测试科技公司", companyIndustry: "软件服务", city: "上海",
      url: "https://www.liepin.com/job/123.shtml", sourceUpdatedAt: new Date(Date.now() - 1000).toISOString(), matchScore: 80, matchReason: "测试" } };
    await ctx.store.put(applicationsKey(ctx.sessionId), [app]);
    let calls = 0, prompts = 0;
    const server = createBotjobServer({ actionContext: ctx, deliveryDriver: async (_app, beforeClick) => {
      calls++; await beforeClick(); return { outcome: "submitted", message: "测试成功", evidence: "已投递" };
    } });
    const client = new Client({ name: "apply-test", version: "1" }, { capabilities: scenario === "unsupported" ? {} : { elicitation: { form: {} } } });
    if (scenario !== "unsupported") client.setRequestHandler(ElicitRequestSchema, async request => {
      prompts++;
      assert.match(request.params.message, /当前选用的简历/);
      assert.match(request.params.message, /薪酬经理｜测试科技公司/);
      assert.equal(calls, 0);
      if (scenario === "changed") { app.job.company = "另一家公司"; await ctx.store.put(applicationsKey(ctx.sessionId), [app]); }
      return { action: scenario === "decline" ? "decline" : "accept", content: { submit: true } };
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b); await client.connect(a);
    try {
      const preview = await client.callTool({ name: "apply_jobs", arguments: { ids: ["app1"] } });
      assert.equal((preview.structuredContent as any).ready, true);
      assert.equal(calls, 0); assert.equal(prompts, 0);
      const result = await client.callTool({ name: "apply_jobs", arguments: { ids: ["app1"], execute: true, confirm: true, snapshotHash: "wrong" } });
      assert.equal((result.structuredContent as any).executed, scenario === "accept");
      assert.equal(calls, scenario === "accept" ? 1 : 0);
      if (scenario === "unsupported") {
        const data = result.structuredContent as any;
        assert.match(data.message, /不支持弹窗/);
        const confirmed = await client.callTool({ name: "apply_jobs", arguments: { ids: ["app1"], execute: true, confirm: true, snapshotHash: data.snapshotHash } });
        assert.equal((confirmed.structuredContent as any).executed, true);
        assert.equal(calls, 1);
      }
    } finally { await client.close(); await server.close(); await rm(home, { recursive: true, force: true }); }
  });
}
