import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ToolContext } from "@cursor/bdk/tools";
import { queueApply, type QueueJobInput } from "../bot/lib/actions.js";
import { actionContextFromTool } from "../bot/lib/bdk-context.js";
import queueApplyTool from "../bot/tools/queue_apply.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const job: QueueJobInput = {
  id: "z1",
  board: "zhilian",
  title: "高级前端工程师",
  company: "星河科技",
  city: "上海",
  url: "https://www.zhaopin.com/jobdetail/CC001.htm",
  matchReason: "匹配",
  matchScore: 80,
};

function memoryTool(opts: {
  channelId: string;
  approvedBy?: { principalId: string };
  dryRun?: boolean;
}): ToolContext {
  const kv = new Map<string, unknown>();
  return {
    session: {
      id: opts.channelId === "direct" ? "tool_queue_apply_test" : "ses_test",
      channelId: opts.channelId,
      mode: "agent",
      auth: null,
      dryRun: opts.dryRun,
    },
    approvedBy: opts.approvedBy,
    workspaceDir: "/tmp/botjob-unused",
    stateRoot: "/tmp",
    host: {
      kv: {
        get: async (key: string) => kv.get(key),
        put: async (key: string, value: unknown) => {
          kv.set(key, value);
        },
      },
      files: {
        forSession: () => ({
          read: async () => undefined,
          write: async () => undefined,
        }),
      },
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  } as unknown as ToolContext;
}

test("direct queue_apply without approvedBy stays queued", async () => {
  const ctx = actionContextFromTool(memoryTool({ channelId: "direct" }));
  assert.equal(ctx.queueStatus, "queued");
  assert.equal(ctx.durableSession, false);
  const result = await queueApply(ctx, { jobs: [job] });
  assert.equal(result.approved, false);
  assert.equal(result.applications[0]?.status, "queued");
});

test("session HTTP call without approvedBy stays queued", async () => {
  const ctx = actionContextFromTool(memoryTool({ channelId: "http" }));
  assert.equal(ctx.queueStatus, "queued");
  const result = await queueApply(ctx, { jobs: [job] });
  assert.equal(result.approved, false);
  assert.equal(result.applications[0]?.status, "queued");
});

test("approvedBy on a live session is the only path that approves", async () => {
  const ctx = actionContextFromTool(
    memoryTool({ channelId: "http", approvedBy: { principalId: "local" } }),
  );
  assert.equal(ctx.queueStatus, "approved");
  assert.equal(ctx.durableSession, true);
  const result = await queueApply(ctx, { jobs: [job] });
  assert.equal(result.approved, true);
  assert.equal(result.applications[0]?.status, "approved");
});

test("dry-run result is not approved, even if approvedBy is set", async () => {
  const ctx = actionContextFromTool(
    memoryTool({
      channelId: "http",
      dryRun: true,
      approvedBy: { principalId: "local" },
    }),
  );
  assert.equal(ctx.queueStatus, "queued");
  const dryRun = queueApplyTool.dryRunResult as (input: {
    jobs: QueueJobInput[];
  }) => { approved: boolean; dryRun: boolean; count: number };
  assert.deepEqual(dryRun({ jobs: [job] }), { approved: false, dryRun: true, count: 1 });
});

test("bdk call queue_apply does not approve", () => {
  const result = spawnSync(
    "npx",
    [
      "bdk",
      "call",
      "queue_apply",
      "--dir",
      root,
      "--input",
      JSON.stringify({ jobs: [job] }),
    ],
    { encoding: "utf8", cwd: root, timeout: 30_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    result: { approved: boolean; applications: { status: string }[] };
  };
  assert.equal(parsed.result.approved, false);
  assert.equal(parsed.result.applications[0]?.status, "queued");
});
