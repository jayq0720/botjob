import type { JobTime } from "./boards/freshness.js";
/** Session-scoped keys for resume + application state in host.kv / host.files. */

import type { ScoreBreakdown } from "./score.js";
import type { BoardId as Board } from "./boards/types.js";

export type BoardId = Board;

export type ResumeMeta = {
  filename: string;
  savedAt: string;
  charCount: number;
  source: "paste" | "upload" | "pdf" | "image";
  pageCount?: number;
  hasPdf?: boolean;
  ocr?: boolean;
};

export type ResumeProfile = {
  name?: string;
  summary: string;
  yearsExperience?: number;
  education?: string;
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

export type JdStatus = "detail" | "list_only" | "pasted";

export type JobListing = JobTime & {
  id: string;
  board: BoardId;
  title: string;
  company: string;
  companyIndustry?: string;
  companySize?: string;
  companyStage?: string;
  companyIntro?: string;
  /** Written by the AI for the review page; never scraped. */
  jobSummary?: string;
  companySummary?: string;
  employerReview?: "needs_review" | "no_exclusion_evidence";
  city: string;
  salary?: string;
  experience?: string;
  education?: string;
  description?: string;
  url: string;
  jdStatus?: JdStatus;
  matchReason: string;
  matchScore: number;
  score?: ScoreBreakdown;
};

export type ApplicationRecord = {
  id: string;
  job: JobListing;
  status:
    | "queued"
    | "approved"
    | "denied"
    | "submitted_manual"
    | "submitted_auto"
    | "applying"
    | "submission_unknown"
    | "skipped"
    | "failed";
  coverNote?: string;
  greeting?: string;
  coverLetter?: string;
  createdAt: string;
  updatedAt: string;
  lastNote?: string;
  delivery?: { attemptId: string; phase: string; at: string; evidence?: string };
};

export type CoverLetterRecord = {
  jobId: string;
  greeting: string;
  coverLetter: string;
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

export function scoredJobsKey(sessionId: string): string {
  return `jobs:${sessionId}:scored`;
}

export function coverLettersKey(sessionId: string): string {
  return `letters:${sessionId}`;
}
