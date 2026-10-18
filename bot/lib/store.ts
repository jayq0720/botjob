/** Session-scoped keys for resume + application state in host.kv / host.files. */

export type ResumeMeta = {
  filename: string;
  savedAt: string;
  charCount: number;
  source: "paste" | "upload" | "pdf";
  pageCount?: number;
  hasPdf?: boolean;
};

export type ResumeProfile = {
  name?: string;
  summary: string;
  yearsExperience?: number;
  currentTitle?: string;
  targetTitles: string[];
  skills: string[];
  cities: string[];
  industries: string[];
  salaryExpectation?: string;
  strengths: string[];
  gaps: string[];
  keywords: string[];
  updatedAt: string;
};

export type JobListing = {
  id: string;
  board: "zhilian" | "liepin" | "job51";
  title: string;
  company: string;
  city: string;
  salary?: string;
  url: string;
  matchReason: string;
  matchScore: number;
};

export type ApplicationRecord = {
  id: string;
  job: JobListing;
  status: "queued" | "approved" | "denied" | "submitted_manual";
  coverNote?: string;
  createdAt: string;
  updatedAt: string;
};

export function resumeTextPath(sessionId: string): string {
  return `resumes/${sessionId}/resume.txt`;
}

export function resumePdfPath(sessionId: string): string {
  return `resumes/${sessionId}/resume.pdf`;
}

export function resumeMetaKey(sessionId: string): string {
  return `resume:${sessionId}:meta`;
}

export function resumeProfileKey(sessionId: string): string {
  return `resume:${sessionId}:profile`;
}

export function applicationsKey(sessionId: string): string {
  return `apps:${sessionId}`;
}
