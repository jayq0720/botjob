import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { assertOcrText, decodeImageBase64, MAX_IMAGE_BYTES, ocrImage, sniffImage } from "../ocr.js";
import { decodePdfBase64, extractTextFromPdf, isPdfBytes } from "../pdf.js";
import { persistResumeText } from "../resume.js";
import type { ActionContext } from "../state-store.js";
import { resumeMetaKey, resumeProfileKey, resumeTextPath, type ResumeMeta, type ResumeProfile } from "../store.js";

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

  if (pdfBase64 || imageBase64) {
    const kind = pdfBase64 ? "pdf" : "png";
    const bytes = pdfBase64 ? decodePdfBase64(pdfBase64) : decodeImageBase64(imageBase64!);
    return saveResumeBytes(ctx, bytes, {
      filename: filename?.trim() || `resume.${kind}`,
      source,
      relHint: "",
      kind: pdfBase64 ? "pdf" : sniffImage(bytes),
    });
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

  return saveText(ctx, text!, filename?.trim() || "resume.txt", source ?? "paste");
}

async function saveText(
  ctx: ActionContext,
  text: string,
  filename: string,
  source: ResumeMeta["source"],
) {
  const saved = await persistResumeText(ctx.store, ctx.sessionId, { text, filename, source });
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
    return saveText(ctx, asText, args.filename, args.source ?? "upload");
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
  return saveText(ctx, Buffer.from(bytes).toString("utf8"), args.filename, args.source ?? "upload");
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
    next: "Call search_jobs for 智联/猎聘，或把 JD 文本 / 岗位 URL 交给 score_job。",
  };
}
