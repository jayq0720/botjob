import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import path from "node:path";
import { canonicalJobUrl, jobUrlAllowed } from "../jd.js";
import { employerReview, excludedEmployer } from "../boards/employers.js";
import { freshness } from "../boards/freshness.js";
import { applicationsKey, scoredJobsKey, type JobListing, type ApplicationRecord } from "../store.js";
import type { ActionContext } from "../state-store.js";
import { queueApply } from "./applications.js";

export type DeliveryResult = { outcome: "submitted" | "already_submitted" | "paused" | "unknown"; message: string; evidence?: string };
export type DeliveryDriver = (app: ApplicationRecord, beforeClick: () => Promise<void>) => Promise<DeliveryResult>;
export const DELIVERY_MATERIAL = "将点击招聘网站的申请/投递按钮，发送该网站账号当前选用的简历（含其中的联系方式）。请先在网站核对账号和简历。不会上传本地PDF，也不会自动发送已保存的打招呼语或求职信。";

function blocked(app: ApplicationRecord): string | undefined {
  if (!["queued", "approved"].includes(app.status)) return `当前状态 ${app.status}，不重复投递；结果未知时先人工核对。`;
  if (!jobUrlAllowed(app.job.url, app.job.board)) return "岗位链接不合法。";
  if (excludedEmployer(app.job) || employerReview(app.job) === "needs_review") return "公司属于排除类别或公司信息待核实。";
  if (freshness(app.job) !== "recent") return "岗位时间不在最近72小时内或无法确认，请重新搜索核实。";
  return undefined;
}

/** Resolve saved jobs on the server so clients never reconstruct application payloads. */
export async function prepareDelivery(ctx: ActionContext, input: { ids?: string[]; jobIds?: string[] }) {
  if (Boolean(input.ids) === Boolean(input.jobIds)) throw new Error("请提供 ids（申请）或 jobIds（已保存岗位）其中一项。");
  if (input.ids) return previewDelivery(ctx, input.ids);
  const selected = [...new Set(input.jobIds!)];
  if (!selected.length || selected.length > 10) throw new Error("每批请选择1–10个岗位。");
  const stored = ((await ctx.store.get(scoredJobsKey(ctx.sessionId))) as JobListing[] | undefined) ?? [];
  const jobs = selected.map(id => stored.find(job => job.id === id));
  if (jobs.some(job => !job)) throw new Error("部分岗位已不在候选池，请重新搜索或通过 list_jobs 选择；未准备任何新申请。");
  const queued = await queueApply({ ...ctx, queueStatus: "queued" }, { jobs: jobs as JobListing[] });
  return previewDelivery(ctx, queued.applications.map(app => app.id));
}

export async function previewDelivery(ctx: ActionContext, ids: string[]) {
  const selected = [...new Set(ids)];
  if (!selected.length || selected.length > 10) throw new Error("每批请选择1–10条申请。");
  const apps = ((await ctx.store.get(applicationsKey(ctx.sessionId))) as ApplicationRecord[] | undefined) ?? [];
  const rows = selected.map(id => apps.find(app => app.id === id));
  if (rows.some(app => !app)) throw new Error("部分申请不存在，请先 queue_apply 并使用返回的申请id。");
  const records = rows as ApplicationRecord[];
  const urls = records.map(app => canonicalJobUrl(app.job.url));
  const duplicate = new Set(urls).size !== urls.length;
  const issues = records.flatMap(app => { const reason = blocked(app); return reason ? [{ id: app.id, reason }] : []; });
  if (duplicate) issues.push({ id: "batch", reason: "同一岗位不能在一批中重复投递。" });
  const snapshotHash = createHash("sha256").update(JSON.stringify({ mode: "site-resume-v1", records })).digest("hex");
  return { ready: issues.length === 0, ids: selected, snapshotHash, material: DELIVERY_MATERIAL,
    applications: records.map(app => ({ id: app.id, board: app.job.board, title: app.job.title, company: app.job.company, city: app.job.city, salary: app.job.salary, description: app.job.description, companyDescription: app.job.companyDescription, companyDescriptionSourceUrl: app.job.companyDescriptionSourceUrl, url: app.job.url, status: app.status })), issues };
}

/** Persist intent before clicking. An interrupted/uncertain click is never retried automatically. */
export async function executeDelivery(ctx: ActionContext, ids: string[], snapshotHash: string, driver: DeliveryDriver, signal?: AbortSignal) {
  if (ctx.offline) return { executed: false, message: "离线或测试会话不执行真实投递。", results: [] };
  await mkdir(ctx.workspaceDir, { recursive: true });
  const lockPath = path.join(ctx.workspaceDir, "one-click-apply.lock");
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return { executed: false, message: "已有投递任务或中断任务的锁。先查看申请状态并核对网站记录，不自动重复提交。", results: [] };
  }
  const results: Array<DeliveryResult & { id: string }> = [];
  const attemptId = randomUUID();
  try {
    const preview = await previewDelivery(ctx, ids);
    if (!preview.ready || preview.snapshotHash !== snapshotHash) return { executed: false, message: "申请内容、时间或状态已变化，请重新预览确认。", results, preview };
    // Claim the whole batch atomically; another tool cannot change approved materials mid-run.
    const claimed = await ctx.store.update(applicationsKey(ctx.sessionId), current => {
      const apps = (current ?? []) as ApplicationRecord[];
      const records = ids.map(id => apps.find(app => app.id === id)!);
      const hash = createHash("sha256").update(JSON.stringify({ mode: "site-resume-v1", records })).digest("hex");
      if (hash !== snapshotHash || records.some(app => !app || blocked(app))) throw new Error("申请快照已变化，请重新确认。");
      const now = new Date().toISOString();
      return { value: apps.map(app => ids.includes(app.id) ? { ...app, status: "applying", updatedAt: now,
        delivery: { attemptId, phase: "prepared", at: now } } : app), result: records };
    });
    try {
      for (const app of claimed) {
        if (signal?.aborted) break;
        let clickStarted = false;
        const beforeClick = async () => {
          if (signal?.aborted) throw new Error("任务已取消，未点击。");
          if (clickStarted) throw new Error("同一申请只能点击一次。");
          await ctx.store.update(applicationsKey(ctx.sessionId), current => {
            const apps = current as ApplicationRecord[];
            const row = apps.find(item => item.id === app.id);
            if (row?.status !== "applying" || row.delivery?.attemptId !== attemptId) throw new Error("申请状态已变化，停止点击。");
            const at = new Date().toISOString();
            return { value: apps.map(item => item.id === app.id ? { ...item, status: "submission_unknown", updatedAt: at,
              delivery: { attemptId, phase: "click_started", at } } : item), result: undefined };
          });
          clickStarted = true;
        };
        let result: DeliveryResult;
        try { result = await driver(app, beforeClick); }
        catch { result = { outcome: clickStarted ? "unknown" : "paused", message: clickStarted ? "点击后未能确认结果，请在网站核对，禁止自动重试。" : "投递准备失败，未点击。请检查浏览器与登录状态。" }; }
        if (clickStarted && result.outcome === "paused") result = { ...result, outcome: "unknown" };
        if (result.outcome === "submitted" && (!clickStarted || !result.evidence)) result = { outcome: "unknown", message: "缺少提交或成功证据，需要人工核对。" };
        if (result.outcome === "already_submitted" && !result.evidence) result = { outcome: "unknown", message: "缺少已投递证据，需要人工核对。" };
        const at = new Date().toISOString();
        await ctx.store.update(applicationsKey(ctx.sessionId), current => {
          const apps = current as ApplicationRecord[];
          return { value: apps.map(item => item.id === app.id && item.delivery?.attemptId === attemptId ? {
            ...item, status: result.outcome === "submitted" || result.outcome === "already_submitted" ? "submitted_auto" : result.outcome === "unknown" ? "submission_unknown" : "queued",
            lastNote: result.message, updatedAt: at,
            delivery: { attemptId, phase: result.outcome, at, evidence: result.evidence },
          } : item), result: undefined };
        });
        results.push({ id: app.id, ...result });
        if (result.outcome === "paused" || result.outcome === "unknown") break;
      }
    } finally {
      // Only rows never clicked are safe to return to the queue after a pause.
      await ctx.store.update(applicationsKey(ctx.sessionId), current => ({
        value: (current as ApplicationRecord[]).map(app => app.status === "applying" && app.delivery?.attemptId === attemptId
          ? { ...app, status: "queued", lastNote: "本批次暂停，此申请未点击。", updatedAt: new Date().toISOString() } : app), result: undefined,
      }));
    }
    return { executed: true, results, remaining: ids.filter(id => !results.some(row => row.id === id)),
      message: "仅页面明确确认的申请记为成功；暂停后完成登录或补填，再重新预览未点击的申请。结果未知的申请先人工核对。" };
  } finally { await lock.close(); await unlink(lockPath); }
}
