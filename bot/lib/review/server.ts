import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { canonicalJobUrl } from "../jd.js";
import { employerReview, excludedEmployer } from "../boards/employers.js";
import { freshness } from "../boards/freshness.js";
import { SUPPORTED_BOARDS, type BoardId } from "../boards/types.js";
import { markApplied, queueApply } from "../actions/applications.js";
import { DELIVERY_MATERIAL, executeDelivery, previewDelivery, type DeliveryDriver } from "../actions/delivery.js";
import type { ActionContext } from "../state-store.js";
import { applicationsKey, scoredJobsKey, type ApplicationRecord, type JobListing } from "../store.js";
import { REVIEW_PAGE } from "./page.js";

const MAX_BATCH = 10;
const BOARD_NAMES: Record<string, string> = { zhilian: "智联", liepin: "猎聘", job51: "前程无忧" };
const DONE = new Set<ApplicationRecord["status"]>(["submitted_auto", "submitted_manual", "applying", "submission_unknown"]);

function excerpt(text: string | undefined, max: number): string | undefined {
  const clean = text?.replace(/\s+/g, " ").trim();
  if (!clean) return undefined;
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function latestApplication(apps: ApplicationRecord[], job: JobListing): ApplicationRecord | undefined {
  const key = canonicalJobUrl(job.url);
  return apps.filter(app => canonicalJobUrl(app.job.url) === key).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Same gates as apply_jobs, evaluated before a job can be ticked. */
function blockReason(job: JobListing, app: ApplicationRecord | undefined): string | undefined {
  if (app && DONE.has(app.status)) return app.status === "submission_unknown" ? "上次投递结果未知，请先到网站核对" : "已投递";
  if (excludedEmployer(job)) return "公司属于保险或劳务派遣，已排除";
  if (employerReview(job) === "needs_review") return "公司性质待核实";
  if (freshness(job) !== "recent") return "不在最近72小时内，请重新搜索";
  return undefined;
}

export async function reviewSnapshot(ctx: ActionContext) {
  const jobs = ((await ctx.store.get(scoredJobsKey(ctx.sessionId))) as JobListing[] | undefined) ?? [];
  const apps = ((await ctx.store.get(applicationsKey(ctx.sessionId))) as ApplicationRecord[] | undefined) ?? [];
  // Excluded employers never appear, matching list_jobs.
  const rows = jobs.filter(job => !excludedEmployer(job)).sort((a, b) => b.matchScore - a.matchScore).map(job => {
    const app = latestApplication(apps, job);
    const facts = [job.companyIndustry, job.companySize, job.companyStage].filter(Boolean).join(" · ");
    return {
      id: job.id, board: BOARD_NAMES[job.board] ?? job.board, boardId: job.board, title: job.title, company: job.company, city: job.city,
      salary: job.salary, experience: job.experience, education: job.education,
      url: job.url, matchScore: job.matchScore, matchReason: job.matchReason,
      sourceTime: job.sourceTimeText ?? job.sourceUpdatedAt, sourceAt: job.sourceUpdatedAt,
      jobSummary: job.jobSummary ?? excerpt(job.description, 160) ?? "未抓到 JD 正文",
      companyFacts: facts || undefined,
      companySummary: job.companySummary ?? excerpt(job.companyIntro, 160) ?? "网站未提供公司介绍",
      status: app?.status, appId: app?.id, note: app?.lastNote, updatedAt: app?.updatedAt,
      blocked: blockReason(job, app),
    };
  });
  const stats = {
    total: rows.length,
    ready: rows.filter(row => !row.blocked).length,
    submitted: rows.filter(row => row.status === "submitted_auto" || row.status === "submitted_manual").length,
    attention: rows.filter(row => row.status === "submission_unknown" || (row.status === "queued" && !!row.note)).length,
  };
  return { jobs: rows, stats, material: DELIVERY_MATERIAL, maxBatch: MAX_BATCH };
}

type BatchJob = { jobId: string; appId: string; title: string; company: string };
export type ReviewResult = {
  executed: boolean; message: string;
  counts?: { submitted: number; paused: number; unknown: number; notStarted: number };
  items?: Array<BatchJob & { outcome: "submitted" | "already_submitted" | "paused" | "unknown" | "not_started"; message: string }>;
};

/** Turns executeDelivery's raw result into what a person wants to read: which job, what happened, why. */
export function summarizeDelivery(batch: BatchJob[], raw: unknown): ReviewResult {
  const result = (raw ?? {}) as { executed?: boolean; message?: string; results?: Array<{ id: string; outcome: string; message: string }> };
  if (!result.executed) return { executed: false, message: result.message ?? "投递未执行。" };
  const items = batch.map(job => {
    const row = result.results?.find(item => item.id === job.appId);
    return { ...job, outcome: (row?.outcome ?? "not_started") as NonNullable<ReviewResult["items"]>[number]["outcome"],
      message: row?.message ?? "本批次暂停，此岗位未点击，可重新勾选投递。" };
  });
  const counts = {
    submitted: items.filter(item => item.outcome === "submitted" || item.outcome === "already_submitted").length,
    paused: items.filter(item => item.outcome === "paused").length,
    unknown: items.filter(item => item.outcome === "unknown").length,
    notStarted: items.filter(item => item.outcome === "not_started").length,
  };
  const parts = [`成功 ${counts.submitted} 个`];
  if (counts.unknown) parts.push(`结果待核对 ${counts.unknown} 个`);
  if (counts.paused) parts.push(`暂停 ${counts.paused} 个`);
  if (counts.notStarted) parts.push(`未开始 ${counts.notStarted} 个`);
  const stop = items.find(item => item.outcome === "paused" || item.outcome === "unknown");
  return { executed: true, counts, items,
    message: `本批投递完成：${parts.join("，")}。${stop ? `在「${stop.title}」处停下：${stop.message}` : ""}` };
}

/** Queue the ticked jobs and start delivery. The click on the local page is the user's confirmation. */
export async function applyFromReview(ctx: ActionContext, jobIds: string[], driver: DeliveryDriver, onDone: (result: ReviewResult) => void) {
  const ids = [...new Set(jobIds)];
  if (!ids.length || ids.length > MAX_BATCH) throw new Error(`每批请选择1–${MAX_BATCH}个岗位。`);
  const jobs = ((await ctx.store.get(scoredJobsKey(ctx.sessionId))) as JobListing[] | undefined) ?? [];
  const apps = ((await ctx.store.get(applicationsKey(ctx.sessionId))) as ApplicationRecord[] | undefined) ?? [];
  const selected = ids.map(id => jobs.find(job => job.id === id));
  if (selected.some(job => !job)) throw new Error("部分岗位已不在列表中，请刷新页面。");
  for (const job of selected as JobListing[]) {
    const reason = blockReason(job, latestApplication(apps, job));
    if (reason) throw new Error(`${job.title}｜${job.company}：${reason}`);
  }
  const queued = await queueApply(ctx, { jobs: (selected as JobListing[]).map(job => ({
    id: job.id, board: job.board, title: job.title, company: job.company, city: job.city, salary: job.salary,
    experience: job.experience, education: job.education, description: job.description, url: job.url,
    matchReason: job.matchReason, matchScore: job.matchScore,
  })) });
  const appIds = queued.applications.map(app => app.id);
  const batch: BatchJob[] = queued.applications.map((app, index) => ({ jobId: ids[index], appId: app.id, title: app.title, company: app.company }));
  const preview = await previewDelivery(ctx, appIds);
  if (!preview.ready) throw new Error(preview.issues.map(issue => issue.reason).join("；"));
  void executeDelivery(ctx, preview.ids, preview.snapshotHash, driver)
    .then(result => onDone(summarizeDelivery(batch, result)),
      error => onDone({ executed: false, message: error instanceof Error ? error.message : String(error) }));
  return { started: true, count: appIds.length, jobIds: ids };
}

function send(res: ServerResponse, status: number, body: unknown, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 64_000) throw new Error("请求过大。");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

export type ReviewLogin = (board: BoardId) => Promise<{ message: string }>;

/**
 * Local-only page listing saved jobs with checkboxes and a one-click apply button.
 * Bound to 127.0.0.1 behind a random path token; Host is checked against DNS rebinding.
 */
export function createReviewServer(ctx: () => ActionContext, driver: DeliveryDriver, openLogin?: ReviewLogin) {
  let server: Server | undefined;
  let base = "";
  let running = false;
  let lastResult: ReviewResult | undefined;
  let batch: { jobIds: string[]; startedAt: string } | undefined;
  const token = randomBytes(16).toString("hex");

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const port = (server!.address() as AddressInfo).port;
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, { error: "forbidden" });
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (!url.pathname.startsWith(`/${token}/`)) return send(res, 404, { error: "not found" });
    const route = url.pathname.slice(token.length + 1);
    // A JSON content type forces a CORS preflight, so other sites cannot post here blindly.
    const sameOrigin = () => !!req.headers["content-type"]?.startsWith("application/json") && req.headers.origin === `http://127.0.0.1:${port}`;
    try {
      if (req.method === "GET" && route === "/") return send(res, 200, REVIEW_PAGE, "text/html; charset=utf-8");
      if (req.method === "GET" && route === "/api/jobs") return send(res, 200, { ...(await reviewSnapshot(ctx())), running, lastResult, batch, canLogin: !!openLogin });
      if (req.method === "POST" && route === "/api/apply") {
        if (!sameOrigin()) return send(res, 403, { error: "forbidden" });
        // Set the flag before any await. Two requests can otherwise both pass the check.
        if (running) return send(res, 409, { error: "已有投递在进行，请等待完成。" });
        running = true;
        lastResult = undefined;
        try {
          const body = await readJson(req) as { jobIds?: unknown };
          const jobIds = Array.isArray(body.jobIds) ? body.jobIds.filter((id): id is string => typeof id === "string") : [];
          const started = await applyFromReview(ctx(), jobIds, driver, result => { lastResult = result; running = false; });
          batch = { jobIds: started.jobIds, startedAt: new Date().toISOString() };
          return send(res, 202, started);
        } catch (error) { running = false; throw error; }
      }
      if (req.method === "POST" && route === "/api/login") {
        if (!openLogin || !sameOrigin()) return send(res, 403, { error: "forbidden" });
        const body = await readJson(req) as { board?: unknown };
        const board = SUPPORTED_BOARDS.find(item => item === body.board);
        if (!board) return send(res, 400, { error: "不支持的招聘站。" });
        const opened = await openLogin(board);
        return send(res, 200, { opened: true, message: opened.message });
      }
      if (req.method === "POST" && route === "/api/mark") {
        if (!sameOrigin()) return send(res, 403, { error: "forbidden" });
        const body = await readJson(req) as { appId?: unknown; outcome?: unknown; note?: unknown };
        const appId = typeof body.appId === "string" ? body.appId.trim() : "";
        const outcome = body.outcome === "applied" || body.outcome === "skipped" || body.outcome === "failed" ? body.outcome : undefined;
        const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : undefined;
        if (!appId || !outcome) return send(res, 400, { error: "参数无效。" });
        const marked = await markApplied(ctx(), { results: [{ id: appId, outcome, note }] });
        if (!marked.updated) return send(res, 409, { error: marked.message ?? "当前状态不可修改。" });
        return send(res, 200, marked);
      }
      return send(res, 404, { error: "not found" });
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    async url() {
      if (!server) {
        server = createServer((req, res) => { void handle(req, res); });
        await new Promise<void>((resolve, reject) => { server!.once("error", reject); server!.listen(0, "127.0.0.1", resolve); });
        base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/${token}/`;
      }
      return base;
    },
    async close() {
      const current = server;
      server = undefined;
      if (current) await new Promise(resolve => current.close(resolve));
    },
  };
}
