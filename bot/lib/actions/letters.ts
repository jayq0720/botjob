import { applyLetter, upsertLetter } from "../job-state.js";
import type { ActionContext } from "../state-store.js";
import { applicationsKey, coverLettersKey, type ApplicationRecord, type CoverLetterRecord } from "../store.js";

function chars(value: string): number {
  return Array.from(value).length;
}

export async function saveCoverLetter(
  ctx: ActionContext,
  input: { jobId: string; greeting: string; coverLetter: string },
) {
  const hello = input.greeting.trim();
  const letter = input.coverLetter.trim();
  const greetingChars = chars(hello);
  if (greetingChars > 200) {
    return {
      saved: false as const,
      message: `打招呼语有 ${greetingChars} 字，请压到 150 字左右（最多 200）。`,
    };
  }
  if (chars(letter) > 4000) {
    return { saved: false as const, message: "求职信超过 4000 字，请缩短后再保存。" };
  }
  const now = new Date().toISOString();
  const record: CoverLetterRecord = {
    jobId: input.jobId,
    greeting: hello,
    coverLetter: letter,
    updatedAt: now,
  };
  await ctx.store.update(coverLettersKey(ctx.sessionId), (current) => {
    const existing = (current as CoverLetterRecord[] | undefined) ?? [];
    return { value: upsertLetter(existing, record), result: undefined };
  });

  const applied = await ctx.store.update(applicationsKey(ctx.sessionId), (current) => {
    const apps = Array.isArray(current) ? (current as ApplicationRecord[]) : [];
    const updated = applyLetter(apps, record, now);
    const changed = updated.some((app, index) => app !== apps[index]);
    return { value: changed ? updated : apps, result: { apps, updated } };
  });
  const { apps, updated } = applied;
  const rejectedApproved = apps
    .filter(
      (app, index) =>
        updated[index] === app &&
        (app.id === input.jobId || app.job.id === input.jobId) &&
        (["approved", "submitted_manual", "submitted_auto", "applying", "submission_unknown"].includes(app.status)),
    )
    .map((app) => app.id);
  return {
    saved: true as const,
    jobId: input.jobId,
    greetingChars,
    warning:
      greetingChars > 150 ? `打招呼语 ${greetingChars} 字，建议再压到 150 字以内。` : undefined,
    rejectedApproved,
    message:
      rejectedApproved.length > 0
        ? "已批准或已投递的申请不会改话术。这些状态再次 queue_apply 只返回原记录，不会改回 queued。"
        : undefined,
    attachedTo: updated
      .filter(
        (app) =>
          (app.job.id === input.jobId || app.id === input.jobId) &&
          !rejectedApproved.includes(app.id),
      )
      .map((app) => app.id),
    next: "未批准的岗位可在 queue_apply 里带上这段话术。已批准的记录保持原话术。",
  };
}
