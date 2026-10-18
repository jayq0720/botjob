import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPackPath, applicationsToPack } from "./apply-pack.js";
import { fetchBoard, fetchJobUrl } from "./boards/fetch.js";
import {
  buildSearchPacks,
  criteriaFromProfile,
  type BoardId,
} from "./boards/index.js";
import { parseDetailHtml } from "./boards/parse.js";
import {
  allowedJobUrl,
  boardFromUrl,
  canonicalJobUrl,
  jobUrlAllowed,
  listingFromPosting,
  parsePastedJd,
} from "./jd.js";
import { applyLetter, letterFor, upsertJobs, upsertLetter } from "./job-state.js";
import {
  assertOcrText,
  decodeImageBase64,
  MAX_IMAGE_BYTES,
  ocrImage,
  sniffImage,
} from "./ocr.js";
import { decodePdfBase64, extractTextFromPdf, isPdfBytes } from "./pdf.js";
import { persistResumeText } from "./resume.js";
import { scoreJob as scoreAgainstProfile } from "./score.js";
import type { ActionContext } from "./state-store.js";
import {
  applicationsKey,
  coverLettersKey,
  resumeMetaKey,
  resumeProfileKey,
  resumeTextPath,
  scoredJobsKey,
  type ApplicationRecord,
  type CoverLetterRecord,
  type JobListing,
  type ResumeMeta,
  type ResumeProfile,
} from "./store.js";

export type SaveResumeInput = {
  text?: string;
  pdfBase64?: string;
  imageBase64?: string;
  workspacePath?: string;
  filePath?: string;
  filename?: string;
  source?: ResumeMeta["source"];
};

type SavedResume = {
  saved: true;
  filename: string;
  charCount: number;
  pageCount?: number;
  ocr?: boolean;
};

/** Local MCP `filePath` cap. Checked with stat before any read. */
export const MAX_LOCAL_RESUME_BYTES = 10 * 1024 * 1024;

const LOCAL_RESUME_EXT = new Set([".pdf", ".png", ".jpg", ".jpeg", ".txt"]);

type LocalResumeKind = "pdf" | "png" | "jpeg" | "txt";

export async function saveResume(ctx: ActionContext, input: SaveResumeInput) {
  const { text, pdfBase64, imageBase64, workspacePath, filePath, filename, source } = input;
  const sources = [text, pdfBase64, imageBase64, workspacePath, filePath].filter((item) =>
    Boolean(item),
  );
  if (sources.length !== 1) {
    throw new Error(
      "Provide exactly one of text, pdfBase64, imageBase64, workspacePath, or filePath",
    );
  }

  if (pdfBase64) {
    const bytes = decodePdfBase64(pdfBase64);
    // pdf.js moves this buffer into its worker. Keep a separate copy to store.
    const pdfBytes = new Uint8Array(bytes);
    const extracted = await extractTextFromPdf(bytes);
    const saved = await persistResumeText(ctx.store, ctx.sessionId, {
      text: extracted.text,
      filename: filename?.trim() || "resume.pdf",
      source: source ?? "pdf",
      pageCount: extracted.pageCount,
      pdfBytes,
      ocr: extracted.ocr,
    });
    return preview(saved, extracted.text, extracted.ocr);
  }

  if (imageBase64) {
    const bytes = decodeImageBase64(imageBase64);
    const extracted = assertOcrText(await ocrImage(bytes));
    const saved = await persistResumeText(ctx.store, ctx.sessionId, {
      text: extracted,
      filename: filename?.trim() || "resume.png",
      source: source ?? "image",
      pageCount: 1,
      ocr: true,
    });
    return preview(saved, extracted, true);
  }

  if (workspacePath || filePath) {
    const loaded = await loadResumeFile(ctx, { workspacePath, filePath });
    return saveResumeBytes(ctx, loaded.bytes, {
      filename: filename?.trim() || loaded.filename,
      source,
      relHint: loaded.relHint,
      kind: loaded.kind,
    });
  }

  const saved = await persistResumeText(ctx.store, ctx.sessionId, {
    text: text!,
    filename: filename?.trim() || "resume.txt",
    source: source ?? "paste",
  });
  return {
    ...saved,
    next: "Analyze the resume, then call save_resume_profile with a structured profile.",
  };
}

async function loadResumeFile(
  ctx: ActionContext,
  input: { workspacePath?: string; filePath?: string },
): Promise<{ bytes: Uint8Array; filename: string; relHint: string; kind?: LocalResumeKind }> {
  if (input.filePath) {
    if (!ctx.allowAbsoluteResumePath) {
      throw new Error("filePath is only available on the local MCP server");
    }
    return readLocalResumeFile(input.filePath);
  }
  const rel = input.workspacePath!.replace(/^\/+/, "");
  if (rel.includes("..") || path.isAbsolute(rel)) {
    throw new Error("workspacePath must be a relative path without ..");
  }
  const abs = path.join(ctx.workspaceDir, rel);
  return {
    bytes: new Uint8Array(await readFile(abs)),
    filename: path.basename(rel),
    relHint: rel,
  };
}

function hasHiddenSegment(absPath: string): boolean {
  return absPath
    .split(/[\\/]/)
    .filter((part) => part.length > 0)
    .some((part) => part.startsWith("."));
}

function kindForExtension(ext: string): LocalResumeKind | undefined {
  if (ext === ".pdf") return "pdf";
  if (ext === ".png") return "png";
  if (ext === ".jpg" || ext === ".jpeg") return "jpeg";
  if (ext === ".txt") return "txt";
  return undefined;
}

function assertLocalResumeBytes(kind: LocalResumeKind, bytes: Uint8Array): void {
  if (kind === "pdf") {
    if (!isPdfBytes(bytes)) throw new Error("文件内容与扩展名不符");
    return;
  }
  if (kind === "png" || kind === "jpeg") {
    if (sniffImage(bytes) !== kind) throw new Error("文件内容与扩展名不符");
    return;
  }
  if (bytes.includes(0)) throw new Error("txt 简历必须是合法 UTF-8 文本");
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("txt 简历必须是合法 UTF-8 文本");
  }
}

/** Absolute MCP resume path: extension, magic bytes, size, and no hidden path or symlink target. */
async function readLocalResumeFile(
  filePath: string,
): Promise<{ bytes: Uint8Array; filename: string; relHint: string; kind: LocalResumeKind }> {
  if (filePath.includes("\0")) throw new Error("非法路径");
  const abs = path.resolve(filePath);
  if (hasHiddenSegment(abs)) throw new Error("不读取隐藏文件或隐藏目录");
  let real: string;
  try {
    real = await realpath(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error("找不到简历文件");
    throw err;
  }
  if (hasHiddenSegment(real)) throw new Error("不读取隐藏文件或隐藏目录");
  const kind = kindForExtension(path.extname(real).toLowerCase());
  if (!kind || !LOCAL_RESUME_EXT.has(path.extname(real).toLowerCase())) {
    throw new Error("只接受 .pdf、.png、.jpg、.jpeg、.txt 简历");
  }
  let info;
  try {
    info = await stat(real);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new Error("找不到简历文件");
    throw err;
  }
  if (!info.isFile()) throw new Error("简历路径必须是普通文件");
  if (info.size > MAX_LOCAL_RESUME_BYTES) {
    throw new Error(`简历文件超过 ${MAX_LOCAL_RESUME_BYTES} 字节上限`);
  }
  const bytes = new Uint8Array(await readFile(real));
  if (bytes.byteLength > MAX_LOCAL_RESUME_BYTES) {
    throw new Error(`简历文件超过 ${MAX_LOCAL_RESUME_BYTES} 字节上限`);
  }
  assertLocalResumeBytes(kind, bytes);
  return { bytes, filename: path.basename(real), relHint: real, kind };
}

async function saveResumeBytes(
  ctx: ActionContext,
  bytes: Uint8Array,
  args: {
    filename: string;
    source?: ResumeMeta["source"];
    relHint: string;
    kind?: LocalResumeKind;
  },
) {
  const rel = args.relHint;
  if (args.kind === "txt") {
    const asText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const saved = await persistResumeText(ctx.store, ctx.sessionId, {
      text: asText,
      filename: args.filename,
      source: args.source ?? "upload",
    });
    return {
      ...saved,
      next: "Analyze the resume, then call save_resume_profile with a structured profile.",
    };
  }
  if (args.kind === "pdf" || (!args.kind && (isPdfBytes(bytes) || rel.toLowerCase().endsWith(".pdf")))) {
    // pdf.js moves this buffer into its worker. Keep a separate copy to store.
    const pdfBytes = new Uint8Array(bytes);
    const extracted = await extractTextFromPdf(bytes);
    const saved = await persistResumeText(ctx.store, ctx.sessionId, {
      text: extracted.text,
      filename: args.filename,
      source: args.source ?? "pdf",
      pageCount: extracted.pageCount,
      pdfBytes,
      ocr: extracted.ocr,
    });
    return preview(saved, extracted.text, extracted.ocr);
  }
  if (
    args.kind === "png" ||
    args.kind === "jpeg" ||
    (!args.kind && (sniffImage(bytes) || /\.(png|jpe?g)$/i.test(rel)))
  ) {
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error(`图片超过 ${MAX_IMAGE_BYTES} 字节上限`);
    }
    if (!sniffImage(bytes)) {
      throw new Error("只支持 png / jpg 简历图片");
    }
    const extracted = assertOcrText(await ocrImage(bytes));
    const saved = await persistResumeText(ctx.store, ctx.sessionId, {
      text: extracted,
      filename: args.filename,
      source: args.source ?? "image",
      pageCount: 1,
      ocr: true,
    });
    return preview(saved, extracted, true);
  }
  const asText = Buffer.from(bytes).toString("utf8");
  const saved = await persistResumeText(ctx.store, ctx.sessionId, {
    text: asText,
    filename: args.filename,
    source: args.source ?? "upload",
  });
  return {
    ...saved,
    next: "Analyze the resume, then call save_resume_profile with a structured profile.",
  };
}

function preview(saved: SavedResume, text: string, ocr: boolean) {
  return {
    ...saved,
    ocr,
    extractedPreview: text.slice(0, 400),
    next: "Analyze the extracted resume text, then call save_resume_profile.",
  };
}

export async function getResume(ctx: ActionContext, input: { includeText?: boolean }) {
  const meta = (await ctx.store.get(resumeMetaKey(ctx.sessionId))) as ResumeMeta | undefined;
  const profile = (await ctx.store.get(resumeProfileKey(ctx.sessionId))) as
    | ResumeProfile
    | undefined;
  const text =
    input.includeText === false
      ? undefined
      : await ctx.store.readText(resumeTextPath(ctx.sessionId));

  if (!meta && !text && !profile) {
    return {
      found: false,
      message: "No resume saved yet. Ask the user to paste or upload one.",
    };
  }

  return {
    found: true,
    meta: meta ?? null,
    profile: profile ?? null,
    text: text ?? null,
    textPreview: text ? text.slice(0, 400) : null,
  };
}

export type SaveProfileInput = {
  name?: string;
  summary: string;
  yearsExperience?: number;
  education?: string;
  currentTitle?: string;
  targetTitles: string[];
  skills: string[];
  cities?: string[];
  industries?: string[];
  salaryExpectation?: string;
  strengths?: string[];
  gaps?: string[];
  keywords: string[];
};

export async function saveResumeProfile(ctx: ActionContext, input: SaveProfileInput) {
  const profile: ResumeProfile = {
    name: input.name,
    summary: input.summary,
    yearsExperience: input.yearsExperience,
    education: input.education,
    currentTitle: input.currentTitle,
    targetTitles: input.targetTitles,
    skills: input.skills,
    cities: input.cities ?? [],
    industries: input.industries ?? [],
    salaryExpectation: input.salaryExpectation,
    strengths: input.strengths ?? [],
    gaps: input.gaps ?? [],
    keywords: input.keywords,
    updatedAt: new Date().toISOString(),
  };
  await ctx.store.put(resumeProfileKey(ctx.sessionId), profile);
  return {
    saved: true,
    profile,
    next: "Call search_jobs for 智联/猎聘/51job/BOSS，或把 JD 文本 / 岗位 URL 交给 score_job。",
  };
}

export type SearchJobsInput = {
  boards?: BoardId[];
  extraKeywords?: string[];
  cities?: string[];
  titles?: string[];
  attemptFetch?: boolean;
};

export async function searchJobs(ctx: ActionContext, input: SearchJobsInput) {
  const { boards, extraKeywords, cities, titles, attemptFetch } = input;
  const stored = (await ctx.store.get(resumeProfileKey(ctx.sessionId))) as
    | ResumeProfile
    | undefined;

  const profile: ResumeProfile | undefined = stored
    ? stored
    : titles?.length || extraKeywords?.length
      ? {
          summary: "inline search criteria",
          targetTitles: titles ?? [],
          skills: extraKeywords ?? [],
          cities: cities ?? ["全国"],
          industries: [],
          strengths: [],
          gaps: [],
          keywords: extraKeywords ?? titles ?? [],
          updatedAt: new Date().toISOString(),
        }
      : undefined;

  if (!profile) {
    return {
      ok: false,
      message:
        "No resume profile yet. Save a resume, analyze it, then call save_resume_profile.",
    };
  }

  const selected = (boards ?? ["zhilian", "liepin", "job51", "boss"]) as BoardId[];
  const criteria = criteriaFromProfile(profile);
  if (extraKeywords?.length) {
    criteria.keywords = [...new Set([...extraKeywords, ...criteria.keywords])];
  }
  if (cities?.length) criteria.cities = cities;
  if (titles?.length) criteria.titles = titles;

  const searchPacks = buildSearchPacks(criteria, selected);
  const skipFetch = attemptFetch === false || (attemptFetch !== true && ctx.offline);

  if (skipFetch) {
    return {
      ok: true,
      criteria,
      searchPacks,
      listings: [] as JobListing[],
      fetches: selected.map((board) => ({
        board,
        ok: false,
        reason: "skipped" as const,
        message:
          "这次没有访问招聘网站。把 JD 文本或岗位 URL 交给 score_job；要现场抓取请把 attemptFetch 设为 true。",
        listingCount: 0,
        detailErrors: [] as string[],
      })),
      applyHint:
        "搜索链接可以直接打开。抓到的岗位或用户贴的 JD 用 score_job 打分，再 queue_apply。",
    };
  }

  const reports = await Promise.all(selected.map((board) => fetchBoard(board, criteria)));
  const listings = reports.flatMap((report) =>
    report.listings.flatMap((posting) => {
      try {
        return [listingFromPosting(posting, profile)];
      } catch {
        return [];
      }
    }),
  );
  if (listings.length > 0) {
    const existing =
      ((await ctx.store.get(scoredJobsKey(ctx.sessionId))) as JobListing[] | undefined) ?? [];
    await ctx.store.put(scoredJobsKey(ctx.sessionId), upsertJobs(existing, listings));
  }

  return {
    ok: true,
    criteria,
    searchPacks,
    listings,
    fetches: reports.map((report) => ({
      board: report.board,
      ok: report.ok,
      reason: report.reason,
      message: report.message,
      listingCount: report.listings.length,
      detailErrors: report.detailErrors,
    })),
    applyHint:
      "只使用 listings 里的真实岗位。抓取失败看 fetches[].message，不要编造 JD。选定后写打招呼语并 queue_apply。",
  };
}

export type ScoreJobInput = {
  text?: string;
  html?: string;
  url?: string;
  board?: BoardId;
  title?: string;
  company?: string;
  city?: string;
  salary?: string;
  experience?: string;
  education?: string;
};

export async function scoreJob(ctx: ActionContext, input: ScoreJobInput) {
  const profile = (await ctx.store.get(resumeProfileKey(ctx.sessionId))) as
    | ResumeProfile
    | undefined;
  if (!profile) {
    return {
      ok: false as const,
      message: "No resume profile yet. Call save_resume_profile before scoring.",
    };
  }

  const url = input.url?.trim();
  const html = input.html?.trim();
  const fromHost = url ? boardFromUrl(url) : undefined;
  const board = (fromHost ?? input.board) as BoardId | undefined;
  if ((url || html) && url && !allowedJobUrl(url)) {
    return {
      ok: false as const,
      reason: "skipped" as const,
      message: "只抓取智联、猎聘、51job、BOSS 的 https 岗位页。其它链接请把 JD 正文贴到 text。",
    };
  }
  if (html && !url) {
    return {
      ok: false as const,
      message: "解析 HTML 时请同时提供该岗位的 https 链接，且域名要和 board 一致。",
    };
  }
  if (!board) {
    return {
      ok: false as const,
      message: "贴 JD 文本时请指定 board：zhilian、liepin、job51 或 boss。",
    };
  }

  if (html && url) {
    if (!jobUrlAllowed(url, board)) {
      return {
        ok: false as const,
        message: "岗位链接必须是该 board 对应站点的 https 地址。",
      };
    }
    const posting = parseDetailHtml(board, html, url);
    if (!posting) {
      return {
        ok: false as const,
        message: "这份 HTML 里没有解析出完整岗位（标题、正文或合规链接缺失）。",
      };
    }
    const job = listingFromPosting(
      {
        ...posting,
        title: input.title?.trim() || posting.title,
        company: input.company?.trim() || posting.company,
        city: input.city?.trim() || posting.city,
        salary: input.salary?.trim() || posting.salary,
        experience: input.experience?.trim() || posting.experience,
        education: input.education?.trim() || posting.education,
      },
      profile,
    );
    await remember(ctx, job);
    return {
      ok: true as const,
      job,
      score: job.score,
      next: "按 job-hunt skill 写 150 字内打招呼语和求职信，调用 save_cover_letter，再 queue_apply。",
    };
  }

  let fetchError: string | undefined;
  if (url && !ctx.offline) {
    const fetched = await fetchJobUrl(url, board);
    if (fetched.ok) {
      const job = listingFromPosting(
        {
          ...fetched.job,
          title: input.title?.trim() || fetched.job.title,
          company: input.company?.trim() || fetched.job.company,
          city: input.city?.trim() || fetched.job.city,
          salary: input.salary?.trim() || fetched.job.salary,
          experience: input.experience?.trim() || fetched.job.experience,
          education: input.education?.trim() || fetched.job.education,
        },
        profile,
      );
      await remember(ctx, job);
      return {
        ok: true as const,
        job,
        score: job.score,
        next: "按 job-hunt skill 写 150 字内打招呼语和求职信，调用 save_cover_letter，再 queue_apply。",
      };
    }
    fetchError = fetched.message;
    if (!input.text?.trim()) {
      return { ok: false as const, reason: fetched.reason, message: fetched.message };
    }
  } else if (url && ctx.offline && !input.text?.trim()) {
    return {
      ok: false as const,
      reason: "skipped" as const,
      message: "当前会话不访问招聘网站。请改贴 JD 文本。",
    };
  }

  const parsed = parsePastedJd({
    text: input.text ?? "",
    board,
    url,
    title: input.title,
    company: input.company,
    city: input.city,
    salary: input.salary,
    experience: input.experience,
    education: input.education,
  });
  if (!parsed.ok) return { ok: false as const, message: parsed.message };
  if (!parsed.job.url) {
    return {
      ok: true as const,
      stored: false as const,
      score: scoreAgainstProfile(profile, parsed.job),
      message: "已打分。没有岗位链接，未写入可投递记录。",
    };
  }
  if (!jobUrlAllowed(parsed.job.url, parsed.job.board)) {
    return {
      ok: false as const,
      message: "岗位链接必须是该 board 对应站点的 https 地址。",
    };
  }
  const job = listingFromPosting(parsed.job, profile);
  await remember(ctx, job);
  return {
    ok: true as const,
    job,
    score: job.score,
    fetchError,
    next: "按 job-hunt skill 写 150 字内打招呼语和求职信，调用 save_cover_letter，再 queue_apply。",
  };
}

async function remember(ctx: ActionContext, job: JobListing): Promise<void> {
  const existing =
    ((await ctx.store.get(scoredJobsKey(ctx.sessionId))) as JobListing[] | undefined) ?? [];
  await ctx.store.put(scoredJobsKey(ctx.sessionId), upsertJobs(existing, [job]));
}

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
  const existing =
    ((await ctx.store.get(coverLettersKey(ctx.sessionId))) as CoverLetterRecord[] | undefined) ??
    [];
  await ctx.store.put(coverLettersKey(ctx.sessionId), upsertLetter(existing, record));

  const apps =
    ((await ctx.store.get(applicationsKey(ctx.sessionId))) as ApplicationRecord[] | undefined) ??
    [];
  const updated = applyLetter(apps, record, now);
  const rejectedApproved = apps
    .filter(
      (app, index) =>
        updated[index] === app &&
        (app.id === input.jobId || app.job.id === input.jobId) &&
        (app.status === "approved" || app.status === "submitted_manual"),
    )
    .map((app) => app.id);
  if (updated.some((app, index) => app !== apps[index])) {
    await ctx.store.put(applicationsKey(ctx.sessionId), updated);
  }
  return {
    saved: true as const,
    jobId: input.jobId,
    greetingChars,
    warning:
      greetingChars > 150 ? `打招呼语 ${greetingChars} 字，建议再压到 150 字以内。` : undefined,
    rejectedApproved,
    message:
      rejectedApproved.length > 0
        ? "已批准或已投递的申请不会改话术。再次 queue_apply 也只返回原记录，不会改回 queued。"
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

export async function queueApply(
  ctx: ActionContext,
  input: { jobs: QueueJobInput[]; coverNote?: string },
) {
  for (const job of input.jobs) {
    if (!jobUrlAllowed(job.url, job.board)) {
      throw new Error(
        "url 必须是该 board 的 https 链接（zhaopin.com、liepin.com、51job.com、zhipin.com），且域名与 board 一致。",
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
      const found = next.find((item) => samePosting(item.job.url, job.url));
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
      ? "同一岗位（规范化 URL）已存在，返回原记录及其当前状态，不新增，也不改话术。"
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
      "重复入队不会新增记录，也不会把已批准或已投递的申请改回 queued。请看每条申请自己的 status。",
      "新排队的申请状态是 queued，还没有批准。",
      "向用户展示岗位、链接、打招呼语和求职信，得到明确同意后再调用 approve_apply。",
      "approve_apply 会用 MCP elicitation 向用户确认。客户端不支持时，先取回 snapshotHash，用户同意后再带 confirm: true 和这个哈希；只传 confirm 不会批准。",
      "只有已批准的岗位才能 export_apply_pack。不要打开浏览器。",
    ],
    note: [
      "MCP 没有 BDK 审批卡片。queue_apply 不会把申请标成已批准，也不会打开浏览器。",
      reusedNote,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

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
  const apps =
    ((await ctx.store.get(applicationsKey(ctx.sessionId))) as ApplicationRecord[] | undefined) ??
    [];
  const ids = [...new Set(input.ids.map((id) => id.trim()).filter((id) => id.length > 0))];
  if (ids.length === 0) {
    return {
      approved: false as const,
      count: 0,
      mismatched: [] as string[],
      message: "没有要批准的申请。请先 queue_apply。",
    };
  }
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
    return {
      approved: false as const,
      count: 0,
      mismatched,
      message: SNAPSHOT_MISMATCH,
    };
  }
  const now = new Date().toISOString();
  const approvedIds = new Set(queued.map((app) => app.id));
  const updated = apps.map((app) =>
    approvedIds.has(app.id) ? { ...app, status: "approved" as const, updatedAt: now } : app,
  );
  await ctx.store.put(applicationsKey(ctx.sessionId), updated);
  return {
    approved: true as const,
    count: queued.length,
    mismatched,
    applications: updated
      .filter((app) => approvedIds.has(app.id))
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
    next: "调用 export_apply_pack。真正投递仍是用户本机执行 localCommand，逐条确认。不要打开浏览器。",
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
      updatedAt: app.updatedAt,
    })),
  };
}

export async function exportApplyPack(ctx: ActionContext, input: { onlyApproved?: boolean }) {
  const apps =
    ((await ctx.store.get(applicationsKey(ctx.sessionId))) as ApplicationRecord[] | undefined) ??
    [];
  const onlyApproved = ctx.exportOnlyApproved || input.onlyApproved !== false;
  const pack = applicationsToPack(ctx.sessionId, apps, onlyApproved);
  if (pack.items.length === 0) {
    const queued = apps.filter((app) => app.status === "queued").length;
    return {
      exported: false as const,
      count: 0,
      message:
        queued > 0
          ? `有 ${queued} 条申请还在排队，尚未批准。请先让用户确认并调用 approve_apply，再导出。`
          : "No applications to export. Approve jobs via queue_apply first.",
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const durablePath = applyPackPath(ctx.sessionId, stamp);
  const body = JSON.stringify(pack, null, 2);
  await ctx.store.writeBytes(durablePath, body);

  const workspaceRel = path.join("apply-packs", `pack-${stamp}.json`);
  const workspaceAbs = path.join(ctx.workspaceDir, workspaceRel);
  await mkdir(path.dirname(workspaceAbs), { recursive: true });
  await writeFile(workspaceAbs, body, "utf8");

  return {
    exported: true as const,
    count: pack.items.length,
    durablePath,
    workspacePath: workspaceRel,
    workspaceAbs,
    pack,
    localCommand: `npm run apply:local -- --pack ${ctx.absolutePackCommand ? workspaceAbs : workspaceRel}`,
    nextSteps: [
      "在本机项目目录执行 localCommand（需已 npm install && npx playwright install chromium）",
      "首次打开浏览器后，请手动登录智联/猎聘/51job/BOSS直聘；登录态会保存在 ~/.botjob/browser-profile",
      "每个岗位会打印打招呼语和求职信。按 p 复制打招呼语，l 复制求职信，f 填进输入框（不发送）",
      "按 a=已投递 / s=跳过 / c=尝试点击申请或立即沟通(仍需确认) / q=退出。BOSS 发送前必须再人工确认",
      "跑完后把 results JSON 告诉 agent，或调用 mark_applied 回写状态",
    ],
  };
}

export async function markApplied(
  ctx: ActionContext,
  input: { results: { id: string; outcome: "applied" | "skipped" | "failed"; note?: string }[] },
) {
  const apps =
    ((await ctx.store.get(applicationsKey(ctx.sessionId))) as ApplicationRecord[] | undefined) ??
    [];
  if (apps.length === 0) {
    return {
      updated: false as const,
      message: "No applications in this session to update.",
    };
  }

  const now = new Date().toISOString();
  const byId = new Map(input.results.map((result) => [result.id, result]));
  let changed = 0;
  const ignored: string[] = [];
  const updated = apps.map((app) => {
    const result = byId.get(app.id);
    if (!result) return app;
    if (app.status !== "approved") {
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
    return {
      updated: false as const,
      changed: 0,
      ignored,
      message: ignored.length
        ? "只有已批准的申请可以回写。这些记录不是已批准，已忽略。"
        : "没有匹配到已批准的申请。",
    };
  }

  await ctx.store.put(applicationsKey(ctx.sessionId), updated);
  return {
    updated: true as const,
    changed,
    ignored,
    applications: updated
      .filter((app) => byId.has(app.id) && !ignored.includes(app.id))
      .map((app) => ({
        id: app.id,
        status: app.status,
        title: app.job.title,
        company: app.job.company,
        lastNote: app.lastNote,
      })),
  };
}
