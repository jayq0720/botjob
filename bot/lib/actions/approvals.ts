import { createHash } from "node:crypto";
import type { ActionContext } from "../state-store.js";
import { applicationsKey, type ApplicationRecord } from "../store.js";

export function applicationSnapshotHash(app: {
  id: string;
  url: string;
  greeting?: string;
  coverLetter?: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: app.id,
        url: app.url,
        greeting: app.greeting ?? "",
        coverLetter: app.coverLetter ?? "",
      }),
    )
    .digest("hex");
}

/** Hash of the exact ids shown to the user, in stable order. */
export function approvalBundleHash(ids: string[], snapshots: Record<string, string>): string {
  const body = [...ids]
    .sort()
    .map((id) => `${id}:${snapshots[id] ?? ""}`)
    .join("\n");
  return createHash("sha256").update(body).digest("hex");
}

const SNAPSHOT_MISMATCH =
  "申请内容与确认时不一致，未批准。请重新查看岗位、链接、打招呼语和求职信。";

export async function approveApplications(
  ctx: ActionContext,
  input: { ids: string[]; snapshots: Record<string, string> },
) {
  const ids = [...new Set(input.ids.map((id) => id.trim()).filter((id) => id.length > 0))];
  if (ids.length === 0) {
    return {
      approved: false as const,
      count: 0,
      mismatched: [] as string[],
      message: "没有要批准的申请。请先 queue_apply。",
    };
  }
  type ApproveDecision =
    | { ok: false; mismatched: string[]; apps: ApplicationRecord[] }
    | { ok: true; mismatched: string[]; apps: ApplicationRecord[]; approvedIds: Set<string> };
  const decided = await ctx.store.update<ApproveDecision>(applicationsKey(ctx.sessionId), (current) => {
    const apps = Array.isArray(current) ? (current as ApplicationRecord[]) : [];
    const mismatched: string[] = [];
    const queued: ApplicationRecord[] = [];
    for (const id of ids) {
      const app = apps.find((item) => item.id === id);
      if (!app || app.status !== "queued") {
        mismatched.push(id);
        continue;
      }
      const hash = applicationSnapshotHash({
        id: app.id,
        url: app.job.url,
        greeting: app.greeting,
        coverLetter: app.coverLetter,
      });
      if (hash !== input.snapshots[id]) mismatched.push(id);
      else queued.push(app);
    }
    if (mismatched.length > 0 || queued.length !== ids.length) {
      return { value: apps, result: { ok: false as const, mismatched, apps } };
    }
    const now = new Date().toISOString();
    const approvedIds = new Set(queued.map((app) => app.id));
    const updated = apps.map((app) =>
      approvedIds.has(app.id) ? { ...app, status: "approved" as const, updatedAt: now } : app,
    );
    return { value: updated, result: { ok: true as const, mismatched, apps: updated, approvedIds } };
  });
  if (!decided.ok) {
    return {
      approved: false as const,
      count: 0,
      mismatched: decided.mismatched,
      message: SNAPSHOT_MISMATCH,
    };
  }
  return {
    approved: true as const,
    count: decided.approvedIds.size,
    mismatched: decided.mismatched,
    applications: decided.apps
      .filter((app) => decided.approvedIds.has(app.id))
      .map((app) => ({
        id: app.id,
        status: app.status,
        board: app.job.board,
        title: app.job.title,
        company: app.job.company,
        applyUrl: app.job.url,
        greeting: app.greeting,
        coverLetter: app.coverLetter,
      })),
    next: "可调用 apply_jobs 确认立即批量投递，或 export_apply_pack 使用本机手动流程。",
  };
}
