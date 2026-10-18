import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import * as z from "zod/v4";
import {
  approveApplications,
  exportApplyPack,
  getResume,
  listApplications,
  markApplied,
  queueApply,
  saveCoverLetter,
  saveResume,
  saveResumeProfile,
  scoreJob,
  searchJobs,
} from "../bot/lib/actions.js";
import { jobUrlAllowed } from "../bot/lib/jd.js";
import { mcpActionContext } from "../bot/lib/state-store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = path.join(root, "bot/skills/job-hunt/SKILL.md");

const INSTRUCTIONS = [
  "botjob 是本机求职助手，只处理智联、猎聘、51job、BOSS 的 https 链接。",
  "顺序：save_resume → save_resume_profile → search_jobs 或 score_job → 你来写打招呼语和求职信 → save_cover_letter → queue_apply → 用户明确同意后 approve_apply → export_apply_pack。",
  "不要编造岗位。不要改已批准话术。不要打开浏览器；把 localCommand 交给用户本机运行。",
  "完整写作规范见 prompt / resource job-hunt。",
].join("");

const MCP_ADDENDUM = `
## MCP 本机服务器

BDK 的 queue_apply 自带审批卡片。这个 stdio 服务器没有审批卡片：

1. queue_apply 只把申请标成 queued。
2. 向用户展示岗位、链接、打招呼语和求职信，得到明确同意。
3. 调用 approve_apply。它会用 MCP elicitation 再确认一次。客户端不支持 elicitation 时，只有用户已经同意才传 confirm: true。
4. 然后 export_apply_pack。未批准的岗位不能导出。
5. 把 localCommand 给用户。投递是用户本机 npm run apply:local，逐条确认。不要自己开浏览器，不要代按发送。
`;

const boardSchema = z.enum(["zhilian", "liepin", "job51", "boss"]);

const saveResumeSchema = z
  .object({
    text: z.string().min(40).optional().describe("简历全文。与文件、base64 四选一。"),
    pdfBase64: z
      .string()
      .min(80)
      .optional()
      .describe("PDF 的 base64，或 data:application/pdf;base64,..."),
    imageBase64: z
      .string()
      .min(80)
      .optional()
      .describe("png 或 jpg 的 base64，或 data URL。扫描件会 OCR。"),
    filePath: z
      .string()
      .optional()
      .describe("本机简历路径，可以是绝对路径。支持 .pdf、扫描件 PDF、.png、.jpg、.txt。"),
    filename: z.string().optional().describe("原始文件名，可选。"),
    source: z.enum(["paste", "upload", "pdf", "image"]).optional(),
  })
  .refine(
    (value) =>
      [value.text, value.pdfBase64, value.imageBase64, value.filePath].filter((item) =>
        Boolean(item),
      ).length === 1,
    { message: "text、pdfBase64、imageBase64、filePath 必须且只能提供一个" },
  );

const profileSchema = z.object({
  name: z.string().optional().describe("姓名"),
  summary: z.string().min(20).describe("简历摘要，至少 20 字"),
  yearsExperience: z.number().optional().describe("工作年限"),
  education: z.string().optional().describe("最高学历，如本科、硕士"),
  currentTitle: z.string().optional().describe("当前或最近职位"),
  targetTitles: z.array(z.string()).min(1).describe("目标岗位"),
  skills: z.array(z.string()).min(1).describe("技能"),
  cities: z.array(z.string()).optional().describe("期望城市"),
  industries: z.array(z.string()).optional().describe("行业"),
  salaryExpectation: z.string().optional().describe("期望薪资"),
  strengths: z.array(z.string()).optional().describe("优势"),
  gaps: z.array(z.string()).optional().describe("短板"),
  keywords: z.array(z.string()).min(1).describe("搜索关键词"),
});

const searchSchema = z.object({
  boards: z
    .array(boardSchema)
    .optional()
    .describe("要搜索的站点。默认智联、猎聘、51job、BOSS。"),
  extraKeywords: z.array(z.string()).optional().describe("额外关键词"),
  cities: z.array(z.string()).optional().describe("覆盖画像里的城市"),
  titles: z.array(z.string()).optional().describe("没有画像时用来临时指定岗位名"),
  attemptFetch: z
    .boolean()
    .optional()
    .describe("false 时只生成搜索链接，不访问招聘网站。默认会尝试抓取公开页面。"),
});

const scoreSchema = z
  .object({
    text: z.string().optional().describe("用户贴来的 JD 正文"),
    html: z
      .string()
      .optional()
      .describe("已经拿到的岗位详情 HTML。提供时只解析这份 HTML，不访问网络。"),
    url: z.string().optional().describe("岗位 https 链接，域名必须属于对应招聘站"),
    board: boardSchema.optional().describe("zhilian、liepin、job51 或 boss。链接能判断时可以省略。"),
    title: z.string().optional(),
    company: z.string().optional(),
    city: z.string().optional(),
    salary: z.string().optional(),
    experience: z.string().optional(),
    education: z.string().optional(),
  })
  .refine((value) => Boolean(value.text?.trim() || value.url?.trim() || value.html?.trim()), {
    message: "需要 JD 文本、岗位 HTML 或岗位 URL",
  });

const queueJobSchema = z
  .object({
    id: z.string().describe("score_job 或 search_jobs 返回的岗位 id"),
    board: boardSchema,
    title: z.string(),
    company: z.string(),
    city: z.string(),
    salary: z.string().optional(),
    experience: z.string().optional(),
    education: z.string().optional(),
    description: z.string().optional(),
    url: z.string().describe("该 board 站点上的 https 岗位链接"),
    matchReason: z.string(),
    matchScore: z.number(),
  })
  .refine((job) => jobUrlAllowed(job.url, job.board), {
    message:
      "url 必须是该 board 的 https 链接（zhaopin.com、liepin.com、51job.com、zhipin.com），且域名与 board 一致。",
  });

const READ = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const ADD = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

const REPLACE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

type ToolExtra = RequestHandlerExtra<never, never>;

export function createBotjobServer(): McpServer {
  const server = new McpServer(
    { name: "botjob", version: "0.0.0" },
    { instructions: INSTRUCTIONS },
  );
  const ctx = () => mcpActionContext();

  server.registerTool(
    "save_resume",
    {
      title: "保存简历",
      description:
        "保存用户简历。text、本机 filePath、pdfBase64、imageBase64 四选一。文本层 PDF 直接抽取；没有文本层的 PDF 和 png/jpg 走 OCR（chi_sim+eng）。不支持 webp/gif。保存后请分析并调用 save_resume_profile。",
      inputSchema: saveResumeSchema,
      annotations: REPLACE,
    },
    async (args) => run(() => saveResume(ctx(), args)),
  );

  server.registerTool(
    "get_resume",
    {
      title: "读取简历",
      description: "读取已保存的简历全文、元数据（含是否 OCR）和结构化画像。",
      inputSchema: z.object({
        includeText: z.boolean().optional().describe("是否返回全文，默认 true"),
      }),
      annotations: READ,
    },
    async (args) => run(() => getResume(ctx(), args)),
  );

  server.registerTool(
    "save_resume_profile",
    {
      title: "保存简历画像",
      description:
        "保存你对简历的结构化分析（目标岗位、技能、城市、年限、学历、薪资）。服务器不替你分析。搜岗和打分之前必须先调用。",
      inputSchema: profileSchema,
      annotations: REPLACE,
    },
    async (args) => run(() => saveResumeProfile(ctx(), args)),
  );

  server.registerTool(
    "search_jobs",
    {
      title: "搜索岗位",
      description:
        "按已保存画像生成智联、猎聘、51job、BOSS 的公开搜索链接。页面可读时抓取真实岗位并打分；抓不到就返回原因。不要编造职位。eval 以外默认会访问网络，attemptFetch=false 可只生成链接。",
      inputSchema: searchSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => run(() => searchJobs(ctx(), args)),
  );

  server.registerTool(
    "score_job",
    {
      title: "给岗位打分",
      description:
        "用已保存画像给一个岗位打 0–100 分。可传 JD 文本、岗位 https 链接，或已经拿到的详情 HTML。传 html 时不访问网络。站外链接会被拒绝。不编造页面里没有的字段，不绕过验证码。",
      inputSchema: scoreSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => run(() => scoreJob(ctx(), args)),
  );

  server.registerTool(
    "save_cover_letter",
    {
      title: "保存打招呼语和求职信",
      description:
        "只保存你写好的打招呼语（约 150 字，最多 200）和求职信。服务器不撰写、不发送。已批准或已投递的申请不能靠这个工具改话术。",
      inputSchema: z.object({
        jobId: z.string().describe("岗位 id 或申请 id"),
        greeting: z.string().min(1).describe("打招呼语，约 150 字"),
        coverLetter: z.string().min(20).describe("求职信"),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => run(() => saveCoverLetter(ctx(), args)),
  );

  server.registerTool(
    "queue_apply",
    {
      title: "加入投递队列",
      description:
        "把岗位放进投递队列，状态是 queued，还没有批准。只接受智联、猎聘、51job、BOSS 的 https 链接，且域名必须和 board 一致。不会登录、不会打开浏览器、不会代投。接下来必须让用户确认，再调用 approve_apply。",
      inputSchema: z.object({
        jobs: z.array(queueJobSchema).min(1).max(10),
        coverNote: z.string().optional().describe("还没单独保存话术时的简短备注"),
      }),
      annotations: ADD,
    },
    async (args) => run(() => queueApply(ctx(), args)),
  );

  server.registerTool(
    "approve_apply",
    {
      title: "批准投递",
      description:
        "把 queued 申请标为已批准。必须先让用户看过岗位、链接、打招呼语和求职信并明确同意，然后才能调用。调用时会用 MCP elicitation 再向用户确认；客户端不支持 elicitation 时，只有 confirm 为 true（且你确认用户已经同意）才会批准。未确认不要调用，也不要擅自传 confirm。批准后话术不能再改。批准不会打开浏览器。",
      inputSchema: z.object({
        ids: z
          .array(z.string())
          .optional()
          .describe("要批准的申请 id。省略则批准当前所有排队申请。"),
        confirm: z
          .boolean()
          .optional()
          .describe(
            "仅当客户端不支持 MCP elicitation 时使用。必须在用户明确同意后才传 true。支持 elicitation 时以弹窗结果为准。",
          ),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args, extra) => {
      try {
        const listed = await listApplications(ctx());
        const ids = args.ids?.filter((id) => id.trim());
        const queued = listed.applications.filter(
          (app) => app.status === "queued" && (!ids?.length || ids.includes(app.id)),
        );
        if (queued.length === 0) {
          return toolResult(await approveApplications(ctx(), { ids }));
        }
        const lines = queued.map(
          (app) =>
            `- ${app.title}｜${app.company}｜${app.board}｜${app.url}\n  打招呼语：${app.greeting ?? "（无）"}`,
        );
        const decision = await userConfirmed(
          server,
          extra,
          `请确认是否批准下面 ${queued.length} 条申请。批准后才能导出投递包，打招呼语和求职信将不能再改。服务器不会打开浏览器。\n\n${lines.join("\n")}`,
          args.confirm,
        );
        if (!decision.ok) return toolResult({ approved: false, message: decision.message });
        return toolResult(await approveApplications(ctx(), { ids }));
      } catch (err) {
        return toolError(err instanceof Error ? err.message : String(err));
      }
    },
  );

  server.registerTool(
    "list_applications",
    {
      title: "查看申请",
      description: "列出本机会话里的投递申请和状态（queued、approved、已投递等），含分数和话术。",
      inputSchema: z.object({}),
      annotations: READ,
    },
    async () => run(() => listApplications(ctx())),
  );

  server.registerTool(
    "export_apply_pack",
    {
      title: "导出投递包",
      description:
        "只导出已批准的申请，写成投递包 JSON，并返回 localCommand。未批准不能导出。不要自己执行投递；请用户在本机运行 npm run apply:local，逐条确认。",
      inputSchema: z.object({}),
      annotations: ADD,
    },
    async () => run(() => exportApplyPack(ctx(), { onlyApproved: true })),
  );

  server.registerTool(
    "mark_applied",
    {
      title: "回写投递结果",
      description:
        "用户在本机跑完 npm run apply:local 之后，按 results 回写状态。applied 记为 submitted_manual，skipped 记为 skipped，failed 记为 failed。",
      inputSchema: z.object({
        results: z
          .array(
            z.object({
              id: z.string().describe("申请 id"),
              outcome: z.enum(["applied", "skipped", "failed"]).describe("本机脚本的结果"),
              note: z.string().optional().describe("备注"),
            }),
          )
          .min(1),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => run(() => markApplied(ctx(), args)),
  );

  server.registerPrompt(
    "job-hunt",
    {
      title: "求职流程",
      description:
        "求职调用顺序，以及打招呼语和求职信的写作规范。话术由你撰写，服务器只保存。MCP 里 queue_apply 之后还要 approve_apply。",
    },
    async () => ({
      messages: [
        {
          role: "user",
          content: { type: "text", text: `${readSkill()}\n${MCP_ADDENDUM}` },
        },
      ],
    }),
  );

  server.registerResource(
    "job-hunt",
    "botjob://skills/job-hunt",
    {
      title: "求职流程指引",
      description:
        "bot/skills/job-hunt 的求职流程、调用顺序和写作规范，并附带 MCP 批准步骤。话术由模型撰写。",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: `${readSkill()}\n${MCP_ADDENDUM}`,
        },
      ],
    }),
  );

  return server;
}

function readSkill(): string {
  return readFileSync(skillPath, "utf8");
}

function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(message: string) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

async function run<T>(fn: () => Promise<T>) {
  try {
    return toolResult(await fn());
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

async function userConfirmed(
  server: McpServer,
  extra: ToolExtra,
  message: string,
  confirm: boolean | undefined,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const result = await server.server.elicitInput(
      {
        mode: "form",
        message,
        requestedSchema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              title: "批准这些申请",
              description:
                "同意后才标为已批准，并允许导出投递包。不会打开浏览器，也不会改写打招呼语或求职信。",
            },
          },
          required: ["confirm"],
        },
      },
      extra.requestId === undefined ? undefined : { relatedRequestId: extra.requestId },
    );
    if (result.action === "accept" && result.content?.confirm === true) return { ok: true };
    return {
      ok: false,
      message: "用户没有批准。申请仍是 queued，不会导出，也不会打开浏览器。",
    };
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (/does not support form elicitation|does not support elicitation/i.test(text)) {
      if (confirm === true) return { ok: true };
      return {
        ok: false,
        message:
          "当前客户端不支持 MCP elicitation。请先向用户展示岗位和话术并得到明确同意，然后带 confirm: true 再调用 approve_apply。未确认时不要传 true。",
      };
    }
    throw err;
  }
}
