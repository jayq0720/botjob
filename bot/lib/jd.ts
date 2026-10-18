import { createHash } from "node:crypto";
import type { BoardId, JdStatus, JobListing, ResumeProfile } from "./store.js";
import { scoreJob, type ScoreBreakdown } from "./score.js";

export type JobPosting = {
  board: BoardId;
  title: string;
  company: string;
  city: string;
  salary?: string;
  experience?: string;
  education?: string;
  description: string;
  url: string;
  jdStatus: JdStatus;
};

const LABEL =
  /^(职位|岗位名称|岗位|公司|公司名称|薪资|工资|城市|地点|工作地点|经验|工作经验|年限|学历)\s*[:：]\s*(.+)$/;

export function jobId(board: string, key: string): string {
  const hash = createHash("sha1").update(`${board}\n${key}`).digest("hex").slice(0, 10);
  return `${board}-${hash}`;
}

export function boardFromUrl(url: string): BoardId | undefined {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
  if (host === "zhaopin.com" || host.endsWith(".zhaopin.com")) return "zhilian";
  if (host === "liepin.com" || host.endsWith(".liepin.com")) return "liepin";
  if (host === "51job.com" || host.endsWith(".51job.com")) return "job51";
  if (host === "zhipin.com" || host.endsWith(".zhipin.com")) return "boss";
  return undefined;
}

export function allowedJobUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return false;
    return boardFromUrl(url) !== undefined;
  } catch {
    return false;
  }
}

export function listingFromPosting(
  posting: JobPosting,
  profile: ResumeProfile,
): JobListing {
  const score: ScoreBreakdown = scoreJob(profile, posting);
  const key = posting.url || `${posting.title}\n${posting.description}`;
  return {
    id: jobId(posting.board, key),
    board: posting.board,
    title: posting.title,
    company: posting.company || "（未提供）",
    city: posting.city,
    salary: posting.salary,
    experience: posting.experience,
    education: posting.education,
    description: posting.description || undefined,
    url: posting.url,
    jdStatus: posting.jdStatus,
    matchScore: score.total,
    matchReason: score.summary,
    score,
  };
}

export function parsePastedJd(input: {
  text: string;
  board: BoardId;
  url?: string;
  title?: string;
  company?: string;
  city?: string;
  salary?: string;
  experience?: string;
  education?: string;
}): { ok: true; job: JobPosting } | { ok: false; message: string } {
  const lines = input.text.replace(/\r\n/g, "\n").split("\n");
  const labeled: Record<string, string> = {};
  const body: string[] = [];
  for (const line of lines) {
    const match = line.trim().match(LABEL);
    if (!match) {
      if (line.trim()) body.push(line.trim());
      continue;
    }
    const key = match[1];
    const value = match[2].trim();
    if (/职位|岗位/.test(key) && !labeled.title) labeled.title = value;
    else if (/公司/.test(key) && !labeled.company) labeled.company = value;
    else if (/薪资|工资/.test(key) && !labeled.salary) labeled.salary = value;
    else if (/城市|地点/.test(key) && !labeled.city) labeled.city = value;
    else if (/经验|年限/.test(key) && !labeled.experience) labeled.experience = value;
    else if (/学历/.test(key) && !labeled.education) labeled.education = value;
  }
  const title = input.title?.trim() || labeled.title || firstShortLine(body);
  const description = body.join("\n").trim();
  if (!title) {
    return { ok: false, message: "没有职位名称。请在正文首行写岗位名，或传入 title。" };
  }
  if (description.length < 20 && !input.text.trim()) {
    return { ok: false, message: "JD 正文为空。" };
  }
  if ((input.text.trim().length < 20) && description.length < 20) {
    return { ok: false, message: "JD 正文少于 20 字，无法打分。请贴完整职位描述。" };
  }
  const prose = description.length >= 20 ? description : input.text.trim();
  if (prose.length < 20) {
    return { ok: false, message: "JD 正文少于 20 字，无法打分。请贴完整职位描述。" };
  }
  return {
    ok: true,
    job: {
      board: input.board,
      title,
      company: input.company?.trim() || labeled.company || "（未提供）",
      city: input.city?.trim() || labeled.city || "",
      salary: input.salary?.trim() || labeled.salary,
      experience: input.experience?.trim() || labeled.experience,
      education: input.education?.trim() || labeled.education,
      description: prose,
      url: input.url?.trim() || "",
      jdStatus: "pasted",
    },
  };
}

function firstShortLine(lines: string[]): string | undefined {
  const line = lines.find((item) => item.length > 0 && item.length <= 40);
  return line;
}
