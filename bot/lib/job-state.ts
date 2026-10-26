import type {
  ApplicationRecord,
  CoverLetterRecord,
  JobListing,
} from "./store.js";

export function upsertJobs(
  existing: JobListing[],
  incoming: JobListing[],
  cap = 40,
): JobListing[] {
  const map = new Map(existing.map((job) => [job.id, job]));
  for (const job of incoming) {
    const prev = map.get(job.id);
    map.set(job.id, prev ? { ...prev, ...job } : job);
  }
  return [...map.values()].slice(-cap);
}

export function upsertLetter(
  existing: CoverLetterRecord[],
  letter: CoverLetterRecord,
): CoverLetterRecord[] {
  const rest = existing.filter((item) => item.jobId !== letter.jobId);
  return [...rest, letter];
}

export function letterFor(
  letters: CoverLetterRecord[],
  jobId: string,
  applicationId?: string,
): CoverLetterRecord | undefined {
  return letters.find(
    (item) => item.jobId === jobId || (applicationId && item.jobId === applicationId),
  );
}

export function applyLetter(
  apps: ApplicationRecord[],
  letter: CoverLetterRecord,
  now = new Date().toISOString(),
): ApplicationRecord[] {
  return apps.map((app) => {
    if (app.id !== letter.jobId && app.job.id !== letter.jobId) return app;
    if (["approved", "submitted_manual", "submitted_auto", "applying", "submission_unknown"].includes(app.status)) return app;
    return {
      ...app,
      greeting: letter.greeting,
      coverLetter: letter.coverLetter,
      coverNote: letter.greeting,
      updatedAt: now,
    };
  });
}
