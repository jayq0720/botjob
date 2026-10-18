import type { ApplicationRecord, BoardId } from "./store.js";

export type ApplyPackItem = {
  id: string;
  board: BoardId;
  title: string;
  company: string;
  city: string;
  url: string;
  salary?: string;
  matchScore?: number;
  coverNote?: string;
  greeting?: string;
  coverLetter?: string;
  status: ApplicationRecord["status"];
};

export type ApplyPack = {
  version: 1;
  exportedAt: string;
  sessionId: string;
  items: ApplyPackItem[];
};

export type ApplyRunResult = {
  id: string;
  outcome: "applied" | "skipped" | "failed";
  note?: string;
  at: string;
};

export type ApplyRunReport = {
  version: 1;
  packExportedAt: string;
  finishedAt: string;
  results: ApplyRunResult[];
};

export function applicationsToPack(
  sessionId: string,
  apps: ApplicationRecord[],
  onlyApproved = true,
): ApplyPack {
  const items = apps
    .filter((a) => (onlyApproved ? a.status === "approved" : true))
    .map((a) => ({
      id: a.id,
      board: a.job.board,
      title: a.job.title,
      company: a.job.company,
      city: a.job.city,
      url: a.job.url,
      salary: a.job.salary,
      matchScore: a.job.matchScore,
      coverNote: a.coverNote,
      greeting: a.greeting,
      coverLetter: a.coverLetter,
      status: a.status,
    }));
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    sessionId,
    items,
  };
}

export function applyPackPath(sessionId: string, stamp: string): string {
  return `apply-packs/${sessionId}/pack-${stamp}.json`;
}

export function parseApplyPack(raw: string): ApplyPack {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Invalid apply pack: not JSON");
  }
  if (!data || typeof data !== "object") {
    throw new Error("Invalid apply pack: expected an object");
  }
  const pack = data as ApplyPack;
  if (pack.version !== 1 || !Array.isArray(pack.items)) {
    throw new Error("Invalid apply pack: expected version 1 with items[]");
  }
  return pack;
}

/** Best-effort selectors for “申请/投递” buttons — never click without user confirm. */
export const boardApplyHints: Record<
  ApplyPackItem["board"],
  { label: string; selectors: string[] }
> = {
  zhilian: {
    label: "智联招聘",
    selectors: [
      "text=立即申请",
      "text=申请职位",
      "button:has-text('申请')",
      "a:has-text('申请')",
    ],
  },
  liepin: {
    label: "猎聘",
    selectors: [
      "text=立即沟通",
      "text=投递简历",
      "text=申请职位",
      "button:has-text('申请')",
    ],
  },
  job51: {
    label: "前程无忧",
    selectors: [
      "text=申请职位",
      "text=立即申请",
      "button:has-text('申请')",
      "a:has-text('申请')",
    ],
  },
  boss: {
    label: "BOSS直聘",
    selectors: [
      "text=立即沟通",
      "text=继续沟通",
      "button:has-text('立即沟通')",
    ],
  },
};
