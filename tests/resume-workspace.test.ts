import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ToolContext } from "@cursor/bdk/tools";
import { getResume, MAX_LOCAL_RESUME_BYTES, saveResume } from "../bot/lib/actions.js";
import { actionContextFromTool } from "../bot/lib/bdk-context.js";
import { mcpActionContext, type ActionContext } from "../bot/lib/state-store.js";
import getResumeTool from "../bot/tools/get_resume.js";
import saveResumeTool from "../bot/tools/save_resume.js";

const resumeText = "姓名：张三\n求职意向：高级前端工程师\n技能：React 与 TypeScript，五年经验。\n";

function workspaceCtx(home: string, workspaceDir: string): ActionContext {
  return { ...mcpActionContext(home), workspaceDir, allowAbsoluteResumePath: false };
}

function memoryTool(channelId: string): ToolContext {
  const kv = new Map<string, unknown>();
  const files = new Map<string, string>();
  return {
    session: {
      id: channelId === "direct" ? "tool_save_resume_test" : "ses_resume",
      channelId,
      mode: "agent",
      auth: null,
    },
    workspaceDir: "/tmp/botjob-no-such-workspace",
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
          read: async (rel: string) => files.get(rel),
          write: async (rel: string, data: string | Uint8Array) => {
            files.set(rel, typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
          },
        }),
      },
    },
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  } as unknown as ToolContext;
}

test("workspacePath reads the project root and prefers the session file", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-home-"));
  const workspace = await mkdtemp(path.join(tmpdir(), "botjob-ws-"));
  const ctx = workspaceCtx(home, workspace);
  try {
    const fromRoot = await saveResume(ctx, { workspacePath: "fixtures/sample-resume.pdf" });
    assert.equal(fromRoot.saved, true);
    const loaded = await getResume(ctx, {});
    assert.match(String(loaded.text), /张三/);

    const local = path.join(workspace, "cv.txt");
    await writeFile(local, "姓名：会话里的人\n求职意向：后端工程师\n技能：Go 与 MySQL，六年。\n");
    const preferred = await saveResume(ctx, { workspacePath: "cv.txt" });
    assert.equal(preferred.saved, true);
    const again = await getResume(ctx, {});
    assert.match(String(again.text), /会话里的人/);
    assert.doesNotMatch(String(again.text), /张三/);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
  }
});

test("workspacePath keeps extension, magic, hidden, size, and symlink checks", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-home-"));
  const workspace = await mkdtemp(path.join(tmpdir(), "botjob-ws-"));
  const outside = await mkdtemp(path.join(tmpdir(), "botjob-out-"));
  const ctx = workspaceCtx(home, workspace);
  try {
    await writeFile(path.join(outside, "secret.txt"), "SECRET-OUTSIDE");
    await symlink(path.join(outside, "secret.txt"), path.join(workspace, "escape.txt"));
    await writeFile(path.join(workspace, "notes.pdf"), "this is not a pdf");
    const huge = path.join(workspace, "huge.pdf");
    const handle = await open(huge, "w");
    await handle.truncate(MAX_LOCAL_RESUME_BYTES + 1);
    await handle.close();
    await mkdir(path.join(workspace, ".private"));
    await writeFile(path.join(workspace, ".private", "resume.txt"), "hidden");

    const rejected: Array<[string, RegExp]> = [
      ["../package.json", /relative path/],
      ["/etc/passwd", /relative path/],
      [".env", /隐藏/],
      [path.join(".private", "resume.txt"), /隐藏/],
      ["escape.txt", /项目根目录内/],
      ["notes.pdf", /扩展名/],
      ["huge.pdf", /字节上限/],
      ["fixtures/missing-resume.pdf", /找不到简历文件/],
    ];
    for (const [workspacePath, pattern] of rejected) {
      await assert.rejects(
        () => saveResume(ctx, { workspacePath }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, pattern);
          assert.equal(err.message.includes("tool-calls"), false);
          assert.equal(err.message.includes("SECRET-OUTSIDE"), false);
          return true;
        },
      );
    }
    const empty = await getResume(ctx, {});
    assert.equal(empty.found, false);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("durable sessions return sessionId; scratch calls do not", async () => {
  const save = saveResumeTool.execute as (
    input: { text: string; filename?: string },
    ctx: ToolContext,
  ) => Promise<{ saved: boolean; sessionId?: string }>;
  const load = getResumeTool.execute as (
    input: { includeText?: boolean },
    ctx: ToolContext,
  ) => Promise<{ found: boolean; sessionId?: string; text?: string | null }>;

  const durable = memoryTool("http");
  const saved = await save({ text: resumeText, filename: "me.txt" }, durable);
  assert.equal(saved.saved, true);
  assert.equal(saved.sessionId, "ses_resume");
  const loaded = await load({}, durable);
  assert.equal(loaded.found, true);
  assert.equal(loaded.sessionId, "ses_resume");
  assert.match(String(loaded.text), /张三/);

  const scratch = memoryTool("direct");
  const once = await save({ text: resumeText, filename: "me.txt" }, scratch);
  assert.equal(once.saved, true);
  assert.equal("sessionId" in once, false);
  const other = memoryTool("direct");
  const missed = await load({}, other);
  assert.equal(missed.found, false);
  assert.equal("sessionId" in missed, false);
  assert.equal(actionContextFromTool(scratch).durableSession, false);
});
