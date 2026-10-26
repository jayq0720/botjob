import { canonicalJobUrl, jobUrlAllowed } from "../jd.js";
import { access } from "node:fs/promises";
import path from "node:path";
import { letterFor } from "../job-state.js";
import { scoreJob as scoreAgainstProfile } from "../score.js";
import type { ActionContext } from "../state-store.js";
import { applicationsKey, coverLettersKey, resumeProfileKey, scoredJobsKey, type ApplicationRecord, type BoardId, type CoverLetterRecord, type JobListing, type ResumeProfile } from "../store.js";

export type QueueJobInput = {
  id: string;
  board: BoardId;
  title: string;
  company: string;
  city: string;
  salary?: string;
  experience?: string;
  education?: string;
  description?: string;
  url: string;
  matchReason: string;
  matchScore: number;
};

function samePosting(url: string, other: string): boolean {
  try {
    return canonicalJobUrl(url) === canonicalJobUrl(other);
  } catch {
    return false;
  }
}

/** Only an in-flight or already submitted row blocks another queue_apply. */
const DEDUPE_STATUSES = new Set<ApplicationRecord["status"]>([
  "queued",
  "approved",
  "submitted_manual",
  "submitted_auto",
  "applying",
  "submission_unknown",
]);

export async function queueApply(
  ctx: ActionContext,
  input: { jobs: QueueJobInput[]; coverNote?: string },
) {
  for (const job of input.jobs) {
    if (!jobUrlAllowed(job.url, job.board)) {
      throw new Error(
        "url 必须是该 board 的 https 链接（zhaopin.com、liepin.com、51job.com），且域名与 board 一致。",
      );
    }
  }
  const now = new Date().toISOString();
  const scored =
    ((await ctx.store.get(scoredJobsKey(ctx.sessionId))) as JobListing[] | undefined) ?? [];
  const letters =
    ((await ctx.store.get(coverLettersKey(ctx.sessionId))) as CoverLetterRecord[] | undefined) ??
    [];
  const profile = (await ctx.store.get(resumeProfileKey(ctx.sessionId))) as
    | ResumeProfile
    | undefined;

  const planned = await ctx.store.update(applicationsKey(ctx.sessionId), (current) => {
    const existing = Array.isArray(current) ? (current as ApplicationRecord[]) : [];
    const next = [...existing];
    const rows: { record: ApplicationRecord; reused: boolean }[] = [];
    let created = 0;
    for (const [index, job] of input.jobs.entries()) {
      const found = next.find(
        (item) => DEDUPE_STATUSES.has(item.status) && samePosting(item.job.url, job.url),
      );
      if (found) {
        rows.push({ record: found, reused: true });
        continue;
      }
      const prev = scored.find((item) => item.id === job.id || samePosting(item.url, job.url));
      const merged: JobListing = {
        ...prev,
        ...job,
        description: job.description ?? prev?.description,
        experience: job.experience ?? prev?.experience,
        education: job.education ?? prev?.education,
        salary: job.salary ?? prev?.salary,
        score: prev?.score,
      };
      if (profile) {
        const breakdown = scoreAgainstProfile(profile, merged);
        merged.score = breakdown;
        merged.matchScore = breakdown.total;
        merged.matchReason = breakdown.summary;
      }
      const letter = letterFor(letters, merged.id);
      const record: ApplicationRecord = {
        id: `app-${job.board}-${job.id}-${Date.now()}-${index}`,
        job: merged,
        status: ctx.queueStatus,
        coverNote: letter?.greeting ?? input.coverNote,
        greeting: letter?.greeting ?? input.coverNote,
        coverLetter: letter?.coverLetter,
        createdAt: now,
        updatedAt: now,
      };
      next.push(record);
      rows.push({ record, reused: false });
      created += 1;
    }
    return { value: next, result: { rows, created } };
  });

  const applications = planned.rows.map(({ record, reused }) => ({
    id: record.id,
    board: record.job.board,
    title: record.job.title,
    company: record.job.company,
    applyUrl: record.job.url,
    status: record.status,
    matchScore: record.job.matchScore,
    score: record.job.score,
    greeting: record.greeting,
    coverLetter: record.coverLetter,
    reused,
  }));
  const reusedNote =
    planned.created < applications.length
      ? "排队、已批准、执行中、已投递或结果未知的同一岗位返回原记录，不新增，也不改话术。"
      : "";

  if (ctx.queueStatus === "approved") {
    return {
      approved: true as const,
      count: applications.length,
      created: planned.created,
      applications,
      nextSteps: [
        "调用 export_apply_pack 导出投递包",
        "本机执行 npm run apply:local -- --pack <workspacePath>（持久化浏览器配置 ~/.botjob/browser-profile）",
        "每个岗位由用户确认后投递；跑完用 mark_applied 回写状态",
      ],
      note: ["半自动投递：本机 Playwright 打开页面，登录态保留在用户本机配置目录；每次点击/标记需用户确认。", reusedNote]
        .filter(Boolean)
        .join(" "),
    };
  }

  return {
    approved: false as const,
    count: applications.length,
    created: planned.created,
    applications,
    nextSteps: [
      "排队、已批准、执行中、已投递或结果未知的同一岗位不会重复入队，也不会被改回 queued。failed 或 skipped 会另开一条 queued，使用最新话术，并需要重新审批；旧记录保留。",
      "新排队的申请状态是 queued，还没有批准。",
      "一键模式：apply_jobs 预览岗位和网站简历投递方式，再一次确认整批。手动模式：展示岗位与话术，明确同意后 approve_apply。",
      "approve_apply 会用 MCP elicitation 向用户确认。客户端不支持时，先取回 snapshotHash，用户同意后再带 confirm: true 和这个哈希；只传 confirm 不会批准。",
      "可调用 apply_jobs 预览这些申请，并在用户一次确认后执行批量投递；手动路径仍需批准后 export_apply_pack。",
    ],
    note: [
      "MCP 没有 BDK 审批卡片。queue_apply 不会把申请标成已批准，也不会打开浏览器。",
      reusedNote,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export async function listApplications(ctx: ActionContext) {
  const apps =
    ((await ctx.store.get(applicationsKey(ctx.sessionId))) as ApplicationRecord[] | undefined) ??
    [];
  return {
    count: apps.length,
    applications: apps.map((app) => ({
      id: app.id,
      status: app.status,
      board: app.job.board,
      title: app.job.title,
      company: app.job.company,
      city: app.job.city,
      url: app.job.url,
      salary: app.job.salary,
      experience: app.job.experience,
      education: app.job.education,
      matchScore: app.job.matchScore,
      matchReason: app.job.matchReason,
      score: app.job.score,
      coverNote: app.coverNote,
      greeting: app.greeting,
      coverLetter: app.coverLetter,
      lastNote: app.lastNote,
      delivery: app.delivery,
      updatedAt: app.updatedAt,
    })),
  };
}

export async function markApplied(
  ctx: ActionContext,
  input: { results: { id: string; outcome: "applied" | "skipped" | "failed"; note?: string }[] },
) {
  const deliveryRunning = await access(path.join(ctx.workspaceDir, "one-click-apply.lock")).then(() => true, () => false);
  const now = new Date().toISOString();
  const byId = new Map(input.results.map((result) => [result.id, result]));
  type MarkOutcome =
    | { kind: "empty" }
    | { kind: "unchanged"; ignored: string[] }
    | { kind: "changed"; changed: number; ignored: string[]; updated: ApplicationRecord[] };
  const outcome = await ctx.store.update<MarkOutcome>(applicationsKey(ctx.sessionId), (current) => {
    const apps = Array.isArray(current) ? (current as ApplicationRecord[]) : [];
    if (apps.length === 0) {
      return { value: apps, result: { kind: "empty" as const } };
    }
    let changed = 0;
    const ignored: string[] = [];
    const updated = apps.map((app) => {
      const result = byId.get(app.id);
      if (!result) return app;
      if ((app.status !== "approved" && app.status !== "submission_unknown") || (app.status === "submission_unknown" && deliveryRunning)) {
        ignored.push(app.id);
        return app;
      }
      changed += 1;
      const status: ApplicationRecord["status"] =
        result.outcome === "applied"
          ? "submitted_manual"
          : result.outcome === "skipped"
            ? "skipped"
            : "failed";
      return {
        ...app,
        status,
        lastNote: result.note,
        updatedAt: now,
      };
    });
    if (changed === 0) {
      return { value: apps, result: { kind: "unchanged" as const, ignored } };
    }
    return { value: updated, result: { kind: "changed" as const, changed, ignored, updated } };
  });

  if (outcome.kind === "empty") {
    return {
      updated: false as const,
      message: "No applications in this session to update.",
    };
  }
  if (outcome.kind === "unchanged") {
    return {
      updated: false as const,
      changed: 0,
      ignored: outcome.ignored,
      message: outcome.ignored.length
        ? "只有已批准或结果未知的申请可以根据用户实际核对回写。"
        : "没有匹配到已批准的申请。",
    };
  }

  return {
    updated: true as const,
    changed: outcome.changed,
    ignored: outcome.ignored,
    applications: outcome.updated
      .filter((app) => byId.has(app.id) && !outcome.ignored.includes(app.id))
      .map((app) => ({
        id: app.id,
        status: app.status,
        title: app.job.title,
        company: app.job.company,
        lastNote: app.lastNote,
      delivery: app.delivery,
      })),
  };
}
