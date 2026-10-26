import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { canonicalJobUrl } from "../jd.js";
import { employerReview, excludedEmployer } from "../boards/employers.js";
import { freshness } from "../boards/freshness.js";
import { queueApply } from "../actions/applications.js";
import { DELIVERY_MATERIAL, executeDelivery, previewDelivery, type DeliveryDriver } from "../actions/delivery.js";
import type { ActionContext } from "../state-store.js";
import { applicationsKey, scoredJobsKey, type ApplicationRecord, type JobListing } from "../store.js";
import { REVIEW_PAGE } from "./page.js";

const MAX_BATCH = 10;
const BOARD_NAMES: Record<string, string> = { zhilian: "智联", liepin: "猎聘" };
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
      id: job.id, board: BOARD_NAMES[job.board] ?? job.board, title: job.title, company: job.company, city: job.city,
      salary: job.salary, url: job.url, matchScore: job.matchScore, matchReason: job.matchReason,
      sourceTime: job.sourceTimeText ?? job.sourceUpdatedAt,
      jobSummary: job.jobSummary ?? excerpt(job.description, 160) ?? "未抓到 JD 正文",
      companyFacts: facts || undefined,
      companySummary: job.companySummary ?? excerpt(job.companyIntro, 160) ?? "网站未提供公司介绍",
      status: app?.status, note: app?.lastNote,
      blocked: blockReason(job, app),
    };
  });
  return { jobs: rows, material: DELIVERY_MATERIAL, maxBatch: MAX_BATCH };
}

/** Queue the ticked jobs and start delivery. The click on the local page is the user's confirmation. */
export async function applyFromReview(ctx: ActionContext, jobIds: string[], driver: DeliveryDriver, onDone: (result: unknown) => void) {
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
  const preview = await previewDelivery(ctx, appIds);
  if (!preview.ready) throw new Error(preview.issues.map(issue => issue.reason).join("；"));
  void executeDelivery(ctx, preview.ids, preview.snapshotHash, driver)
    .then(onDone, error => onDone({ executed: false, message: error instanceof Error ? error.message : String(error) }));
  return { started: true, count: appIds.length };
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

/**
 * Local-only page listing saved jobs with checkboxes and a one-click apply button.
 * Bound to 127.0.0.1 behind a random path token; Host is checked against DNS rebinding.
 */
export function createReviewServer(ctx: () => ActionContext, driver: DeliveryDriver) {
  let server: Server | undefined;
  let base = "";
  let running = false;
  let lastResult: unknown;
  const token = randomBytes(16).toString("hex");

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const port = (server!.address() as AddressInfo).port;
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, { error: "forbidden" });
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
    if (!url.pathname.startsWith(`/${token}/`)) return send(res, 404, { error: "not found" });
    const route = url.pathname.slice(token.length + 1);
    try {
      if (req.method === "GET" && route === "/") return send(res, 200, REVIEW_PAGE, "text/html; charset=utf-8");
      if (req.method === "GET" && route === "/api/jobs") return send(res, 200, { ...(await reviewSnapshot(ctx())), running, lastResult });
      if (req.method === "POST" && route === "/api/apply") {
        // A JSON content type forces a CORS preflight, so other sites cannot post here blindly.
        if (!req.headers["content-type"]?.startsWith("application/json") || req.headers.origin !== `http://127.0.0.1:${port}`) return send(res, 403, { error: "forbidden" });
        if (running) return send(res, 409, { error: "已有投递在进行，请等待完成。" });
        const body = await readJson(req) as { jobIds?: unknown };
        const jobIds = Array.isArray(body.jobIds) ? body.jobIds.filter((id): id is string => typeof id === "string") : [];
        running = true;
        lastResult = undefined;
        try {
          return send(res, 202, await applyFromReview(ctx(), jobIds, driver, result => { lastResult = result; running = false; }));
        } catch (error) { running = false; throw error; }
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
