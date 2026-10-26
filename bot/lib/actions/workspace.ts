import { excludedEmployer, employerReview } from "../boards/employers.js";
import { SUPPORTED_BOARDS } from "../boards/types.js";
import type { ActionContext } from "../state-store.js";
import { applicationsKey, coverLettersKey, resumeMetaKey, resumeProfileKey, scoredJobsKey,
  type ApplicationRecord, type CoverLetterRecord, type JobListing, type ResumeMeta, type ResumeProfile } from "../store.js";

/** Resume text is deliberately opt-in via get_resume, not repeated on every session. */
export async function getWorkspace(ctx: ActionContext) {
  const [resume, profile, jobs, applications, letters] = await Promise.all([
    ctx.store.get(resumeMetaKey(ctx.sessionId)) as Promise<ResumeMeta | undefined>,
    ctx.store.get(resumeProfileKey(ctx.sessionId)) as Promise<ResumeProfile | undefined>,
    ctx.store.get(scoredJobsKey(ctx.sessionId)) as Promise<JobListing[] | undefined>,
    ctx.store.get(applicationsKey(ctx.sessionId)) as Promise<ApplicationRecord[] | undefined>,
    ctx.store.get(coverLettersKey(ctx.sessionId)) as Promise<CoverLetterRecord[] | undefined>,
  ]);
  const counts: Record<ApplicationRecord["status"], number> = {
    queued: 0, approved: 0, applying: 0, submitted_auto: 0, submission_unknown: 0, denied: 0, submitted_manual: 0, failed: 0, skipped: 0,
  };
  for (const app of applications ?? []) counts[app.status] += 1;
  return {
    sessionId: ctx.sessionId,
    resume: resume ?? null,
    profile: profile ?? null,
    savedJobs: jobs?.filter((job) => SUPPORTED_BOARDS.includes(job.board) && !excludedEmployer(job)).length ?? 0,
    savedLetters: letters?.length ?? 0,
    applications: { total: applications?.length ?? 0, byStatus: counts },
    offline: ctx.offline,
  };
}

export async function listJobs(
  ctx: ActionContext,
  input: { board?: JobListing["board"]; minScore?: number; limit?: number } = {},
) {
  const stored = (await ctx.store.get(scoredJobsKey(ctx.sessionId))) as JobListing[] | undefined;
  const jobs = [...(stored ?? [])]
    .filter((job) => SUPPORTED_BOARDS.includes(job.board) && !excludedEmployer(job) && (!input.board || job.board === input.board) && job.matchScore >= (input.minScore ?? 0))
    .map(job => ({ ...job, employerReview: employerReview(job) }))
    .sort((a, b) => b.matchScore - a.matchScore || a.id.localeCompare(b.id));
  return { total: jobs.length, jobs: jobs.slice(0, Math.max(1, Math.min(40, input.limit ?? 20))) };
}
