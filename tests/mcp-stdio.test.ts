import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { ElicitRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

type ToolCall = Awaited<ReturnType<Client["callTool"]>>;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin/botjob-mcp.js");
const resumePdf = path.join(root, "fixtures/sample-resume.pdf");
const detailHtml = path.join(root, "fixtures/html/zhilian-detail.html");
const jobUrl = "https://www.zhaopin.com/jobdetail/CC001.htm";

const TOOL_NAMES = [
  "get_workspace",
  "list_jobs",
  "save_resume",
  "get_resume",
  "save_resume_profile",
  "search_jobs",
  "open_job_login",
  "score_job",
  "save_cover_letter",
  "queue_apply",
  "approve_apply",
  "apply_jobs",
  "list_applications",
  "export_apply_pack",
  "mark_applied",
  "open_job_list",
];

const profile = {
  name: "张三",
  summary: "6年前端，熟悉 React、TypeScript 和性能优化，目标上海高级前端。",
  yearsExperience: 6,
  education: "本科",
  targetTitles: ["高级前端工程师"],
  skills: ["React", "TypeScript", "Node.js"],
  cities: ["上海"],
  keywords: ["前端", "React"],
};

const greeting = "您好，我做了 6 年前端，做过 React 和 TypeScript 交易前台。看到这个岗位在上海，想沟通一下。";
const coverLetter = "我应聘这个前端岗位。简历里的 React、TypeScript 和交易前台重构与职责相符。希望进一步沟通。";

function asCall(result: ToolCall): CallToolResult {
  if (!("content" in result) || !Array.isArray(result.content)) {
    throw new Error(`unexpected tool result: ${JSON.stringify(result)}`);
  }
  return result as CallToolResult;
}

function textOf(result: ToolCall): string {
  const block = asCall(result).content.find((item) => item.type === "text");
  if (!block || block.type !== "text") throw new Error("tool result has no text");
  return block.text;
}

function jsonResult(result: ToolCall): Record<string, any> {
  if (asCall(result).isError) throw new Error(textOf(result));
  return JSON.parse(textOf(result)) as Record<string, any>;
}

async function connect(
  home: string,
  elicit?: (message: string) => Promise<{ action: "accept" | "decline"; content?: { confirm: boolean } }>,
) {
  let stderr = "";
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [bin],
    cwd: root,
    env: {
      ...getDefaultEnvironment(),
      BOTJOB_HOME: home,
      BOTJOB_OFFLINE: "1",
    },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const client = new Client(
    { name: "botjob-mcp-test", version: "0.0.0" },
    {
      capabilities: elicit ? { elicitation: { form: {} } } : {},
    },
  );
  if (elicit) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => elicit(request.params.message));
  }
  await client.connect(transport);
  return {
    client,
    stderr: () => stderr,
    async close() {
      await client.close();
    },
  };
}

test("stdio MCP server runs the local apply flow", { timeout: 60_000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-mcp-"));
  const session = await connect(home);
  try {
    const listed = await session.client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...TOOL_NAMES].sort());
    const byName = new Map(listed.tools.map((tool) => [tool.name, tool]));
    const schema = byName.get("search_jobs")!.inputSchema as unknown as { properties: { boards: { items: { enum: string[] } } } };
    assert.deepEqual(schema.properties.boards.items.enum, ["zhilian", "liepin", "job51"]);
    assert.match(byName.get("search_jobs")!.description!, /72小时/);
    assert.equal(byName.get("get_resume")?.annotations?.readOnlyHint, true);
    assert.equal(byName.get("list_applications")?.annotations?.readOnlyHint, true);
    assert.equal(byName.get("save_resume")?.annotations?.destructiveHint, true);
    assert.equal(byName.get("approve_apply")?.annotations?.readOnlyHint, false);
    assert.equal(byName.get("search_jobs")?.annotations?.openWorldHint, true);
    assert.equal(byName.get("search_jobs")?.annotations?.readOnlyHint, false);
    assert.equal(byName.get("score_job")?.annotations?.openWorldHint, true);
    assert.equal(byName.get("score_job")?.annotations?.readOnlyHint, false);
    assert.match(byName.get("score_job")?.description ?? "", /不访问网络/);
    assert.equal(byName.get("queue_apply")?.annotations?.idempotentHint, true);
    assert.match(byName.get("approve_apply")?.description ?? "", /elicitation/);
    assert.match(byName.get("save_resume")?.description ?? "", /OCR/);

    const workspace = jsonResult(await session.client.callTool({ name: "get_workspace", arguments: {} }));
    assert.equal(workspace.resume, null);
    assert.equal(workspace.savedJobs, 0);
    assert.equal(workspace.applications.total, 0);
    const emptyJobs = jsonResult(await session.client.callTool({ name: "list_jobs", arguments: {} }));
    assert.deepEqual(emptyJobs, { total: 0, jobs: [] });

    const prompts = await session.client.listPrompts();
    assert.equal(prompts.prompts.some((prompt) => prompt.name === "job-hunt"), true);
    const resource = await session.client.readResource({ uri: "botjob://skills/job-hunt" });
    const resourceText = resource.contents.map((item) => ("text" in item ? item.text : "")).join("\n");
    assert.match(resourceText, /save_resume/);
    assert.match(resourceText, /approve_apply/);

    const saved = jsonResult(
      await session.client.callTool({
        name: "save_resume",
        arguments: { filePath: resumePdf },
      }),
    );
    assert.equal(saved.saved, true);
    assert.ok(saved.charCount >= 40);

    const analyzed = jsonResult(
      await session.client.callTool({
        name: "save_resume_profile",
        arguments: profile,
      }),
    );
    assert.equal(analyzed.saved, true);

    const offline = jsonResult(
      await session.client.callTool({
        name: "score_job",
        arguments: { url: jobUrl, board: "zhilian" },
      }),
    );
    assert.equal(offline.ok, false);
    assert.match(String(offline.message), /不访问招聘网站/);

    const html = await readFile(detailHtml, "utf8");
    const scored = jsonResult(
      await session.client.callTool({
        name: "score_job",
        arguments: { html, url: jobUrl, board: "zhilian" },
      }),
    );
    assert.equal(scored.ok, true);
    const candidates = await session.client.callTool({ name: "list_jobs", arguments: { board: "zhilian" } });
    assert.equal(jsonResult(candidates).jobs[0].url, jobUrl);
    assert.deepEqual(candidates.structuredContent, jsonResult(candidates));
    const progress = jsonResult(await session.client.callTool({ name: "get_workspace", arguments: {} }));
    assert.equal(progress.savedJobs, 1);
    assert.equal(progress.profile.name, profile.name);

    assert.equal(scored.job.title, "高级前端工程师");
    assert.equal(scored.job.company, "星河科技");
    assert.equal(scored.job.url, jobUrl);

    const blocked = jsonResult(
      await session.client.callTool({
        name: "score_job",
        arguments: { html, url: "https://evil.example/x", board: "zhilian" },
      }),
    );
    assert.equal(blocked.ok, false);
    assert.match(String(blocked.message), /https/);

    const letter = jsonResult(
      await session.client.callTool({
        name: "save_cover_letter",
        arguments: { jobId: scored.job.id, greeting, coverLetter },
      }),
    );
    assert.equal(letter.saved, true);

    const queued = jsonResult(
      await session.client.callTool({
        name: "queue_apply",
        arguments: {
          jobs: [
            {
              id: scored.job.id,
              board: scored.job.board,
              title: scored.job.title,
              company: scored.job.company,
              city: scored.job.city,
              url: scored.job.url,
              salary: scored.job.salary,
              description: scored.job.description,
              matchReason: scored.job.matchReason,
              matchScore: scored.job.matchScore,
            },
          ],
        },
      }),
    );
    assert.equal(queued.approved, false);
    assert.equal(queued.applications[0].status, "queued");
    assert.equal(queued.applications[0].greeting, greeting);
    const applicationId = queued.applications[0].id as string;

    const early = jsonResult(
      await session.client.callTool({
        name: "export_apply_pack",
        arguments: {},
      }),
    );
    assert.equal(early.exported, false);

    const unconfirmed = jsonResult(
      await session.client.callTool({
        name: "approve_apply",
        arguments: { ids: [applicationId] },
      }),
    );
    assert.equal(unconfirmed.approved, false);
    assert.match(String(unconfirmed.message), /confirm/);
    assert.match(String(unconfirmed.snapshotHash), /^[a-f0-9]{64}$/);
    assert.deepEqual(unconfirmed.ids, [applicationId]);

    const bareConfirm = jsonResult(
      await session.client.callTool({
        name: "approve_apply",
        arguments: { ids: [applicationId], confirm: true },
      }),
    );
    assert.equal(bareConfirm.approved, false);
    assert.match(String(bareConfirm.message), /snapshotHash/);

    const approved = jsonResult(
      await session.client.callTool({
        name: "approve_apply",
        arguments: {
          ids: [applicationId],
          confirm: true,
          snapshotHash: unconfirmed.snapshotHash,
        },
      }),
    );
    assert.equal(approved.approved, true);
    assert.equal(approved.applications[0].greeting, greeting);

    const rewritten = jsonResult(
      await session.client.callTool({
        name: "save_cover_letter",
        arguments: {
          jobId: applicationId,
          greeting: "这是想偷偷换掉的已批准打招呼语。",
          coverLetter: "这封信也不应该覆盖已经批准的求职信内容。",
        },
      }),
    );
    assert.equal(rewritten.saved, true);
    assert.deepEqual(rewritten.rejectedApproved, [applicationId]);

    const apps = jsonResult(
      await session.client.callTool({ name: "list_applications", arguments: {} }),
    );
    assert.equal(apps.applications[0].status, "approved");
    assert.equal(apps.applications[0].greeting, greeting);

    const exported = jsonResult(
      await session.client.callTool({ name: "export_apply_pack", arguments: {} }),
    );
    assert.equal(exported.exported, true);
    assert.equal(exported.count, 1);
    assert.equal(exported.pack.items[0].greeting, greeting);
    assert.match(exported.localCommand, /apply:local/);
    const packOnDisk = await readFile(exported.workspaceAbs, "utf8");
    assert.match(packOnDisk, /星河科技/);
    const kv = await readFile(path.join(home, "data", "kv.json"), "utf8");
    assert.match(kv, /张三/);

    const evil = await session.client.callTool({
      name: "queue_apply",
      arguments: {
        jobs: [
          {
            id: "evil",
            board: "zhilian",
            title: "前端",
            company: "站外",
            city: "上海",
            url: "https://evil.example/x",
            matchReason: "不该入库",
            matchScore: 1,
          },
        ],
      },
    });
    assert.equal(asCall(evil).isError, true);
    assert.match(textOf(evil), /https|url|board/i);
    assert.doesNotMatch(session.stderr(), /\{"jsonrpc"/);
  } finally {
    await session.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("approve_apply uses elicitation when the client supports it", { timeout: 30_000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-mcp-elicit-"));
  const accepted = await connect(home, async (message) => {
    assert.match(message, /星河科技/);
    assert.match(message, /求职信/);
    assert.ok(message.includes(coverLetter));
    return { action: "accept", content: { confirm: true } };
  });
  try {
    await seedQueued(accepted.client);
    const approved = jsonResult(
      await accepted.client.callTool({ name: "approve_apply", arguments: {} }),
    );
    assert.equal(approved.approved, true);
  } finally {
    await accepted.close();
    await rm(home, { recursive: true, force: true });
  }

  const declinedHome = await mkdtemp(path.join(tmpdir(), "botjob-mcp-decline-"));
  const declined = await connect(declinedHome, async () => ({ action: "decline" }));
  try {
    await seedQueued(declined.client);
    const rejected = jsonResult(
      await declined.client.callTool({
        name: "approve_apply",
        arguments: { confirm: true },
      }),
    );
    assert.equal(rejected.approved, false);
    assert.match(String(rejected.message), /没有批准/);
    const exported = jsonResult(
      await declined.client.callTool({ name: "export_apply_pack", arguments: {} }),
    );
    assert.equal(exported.exported, false);
  } finally {
    await declined.close();
    await rm(declinedHome, { recursive: true, force: true });
  }
});

test("approve_apply rejects content changed while the dialog is open", { timeout: 60_000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-mcp-race-"));
  let applicationId = "";
  const other = await connect(home);
  const session = await connect(home, async (message) => {
    assert.match(message, /求职信/);
    assert.ok(message.includes(coverLetter));
    assert.ok(message.includes(greeting));
    const changed = jsonResult(
      await other.client.callTool({
        name: "save_cover_letter",
        arguments: {
          jobId: applicationId,
          greeting: "确认期间被改掉的打招呼语。",
          coverLetter: "确认期间被改掉的求职信，不应该被这次弹窗批准。",
        },
      }),
    );
    assert.equal(changed.saved, true);
    jsonResult(
      await other.client.callTool({
        name: "queue_apply",
        arguments: {
          jobs: [
            {
              id: "late-job",
              board: "liepin",
              title: "后端工程师",
              company: "迟到公司",
              city: "北京",
              url: "https://www.liepin.com/job/late.htm",
              matchReason: "确认期间才入队",
              matchScore: 1,
            },
          ],
        },
      }),
    );
    return { action: "accept", content: { confirm: true } };
  });
  try {
    const seeded = await seedQueued(session.client);
    applicationId = seeded.applicationId;
    const decision = jsonResult(
      await session.client.callTool({ name: "approve_apply", arguments: {} }),
    );
    assert.equal(decision.approved, false);
    assert.match(String(decision.message), /不一致/);
    const apps = jsonResult(
      await session.client.callTool({ name: "list_applications", arguments: {} }),
    );
    const original = apps.applications.find((app: { id: string }) => app.id === applicationId);
    const late = apps.applications.find((app: { company: string }) => app.company === "迟到公司");
    assert.equal(original.status, "queued");
    assert.match(original.greeting, /确认期间/);
    assert.equal(late.status, "queued");
    assert.equal(
      apps.applications.some((app: { status: string }) => app.status === "approved"),
      false,
    );
  } finally {
    await session.close();
    await other.close();
    await rm(home, { recursive: true, force: true });
  }
});

test("approve_apply elicitation includes a cover letter longer than 500 characters", { timeout: 30_000 }, async () => {
  const longLetter = `我应聘这个前端岗位，想说明和职责的对应关系。${"匹配证据来自简历里的 React 与 TypeScript。".repeat(20)}`;
  assert.ok(longLetter.length > 500);
  const home = await mkdtemp(path.join(tmpdir(), "botjob-mcp-letter-"));
  const session = await connect(home, async (message) => {
    assert.ok(message.includes(greeting));
    assert.ok(message.includes(longLetter));
    assert.equal(message.includes(`${longLetter.slice(0, 180)}…`), false);
    return { action: "decline" };
  });
  try {
    const jobId = "zhilian-long-letter";
    jsonResult(
      await session.client.callTool({
        name: "save_cover_letter",
        arguments: { jobId, greeting, coverLetter: longLetter },
      }),
    );
    jsonResult(
      await session.client.callTool({
        name: "queue_apply",
        arguments: {
          jobs: [
            {
              id: jobId,
              board: "zhilian",
              title: "高级前端工程师",
              company: "星河科技",
              city: "上海",
              url: jobUrl,
              matchReason: "长求职信",
              matchScore: 80,
            },
          ],
        },
      }),
    );
    const decision = jsonResult(
      await session.client.callTool({ name: "approve_apply", arguments: {} }),
    );
    assert.equal(decision.approved, false);
  } finally {
    await session.close();
    await rm(home, { recursive: true, force: true });
  }
});

async function seedQueued(client: Client): Promise<{ applicationId: string; jobId: string }> {
  const html = await readFile(detailHtml, "utf8");
  jsonResult(
    await client.callTool({
      name: "save_resume",
      arguments: { filePath: resumePdf },
    }),
  );
  jsonResult(await client.callTool({ name: "save_resume_profile", arguments: profile }));
  const scored = jsonResult(
    await client.callTool({
      name: "score_job",
      arguments: { html, url: jobUrl, board: "zhilian" },
    }),
  );
  jsonResult(
    await client.callTool({
      name: "save_cover_letter",
      arguments: { jobId: scored.job.id, greeting, coverLetter },
    }),
  );
  const queued = jsonResult(
    await client.callTool({
      name: "queue_apply",
      arguments: {
        jobs: [
          {
            id: scored.job.id,
            board: scored.job.board,
            title: scored.job.title,
            company: scored.job.company,
            city: scored.job.city,
            url: scored.job.url,
            matchReason: scored.job.matchReason,
            matchScore: scored.job.matchScore,
          },
        ],
      },
    }),
  );
  assert.equal(queued.applications[0].status, "queued");
  return {
    applicationId: queued.applications[0].id as string,
    jobId: scored.job.id as string,
  };
}
