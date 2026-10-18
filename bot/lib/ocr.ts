import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MIN_OCR_CHARS = 20;

const require = createRequire(import.meta.url);
const LANGS = ["chi_sim", "eng"] as const;

let workerPromise: Promise<Worker> | undefined;

export function collapseCjkSpaces(text: string): string {
  let current = text;
  let next = current.replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, "$1");
  while (next !== current) {
    current = next;
    next = current.replace(/([\u4e00-\u9fff])[ \t]+(?=[\u4e00-\u9fff])/g, "$1");
  }
  return current;
}

function normalizeOcr(raw: string): string {
  return collapseCjkSpaces(raw)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function ensureLangDir(): Promise<string> {
  const dir = path.join(tmpdir(), "botjob-tessdata");
  await mkdir(dir, { recursive: true });
  for (const code of LANGS) {
    let pkgJson: string;
    try {
      pkgJson = require.resolve(`@tesseract.js-data/${code}/package.json`);
    } catch {
      throw new Error(
        `OCR 语言包缺失：需要安装 @tesseract.js-data/${code}（以及 tesseract.js）。`,
      );
    }
    const src = path.join(
      path.dirname(pkgJson),
      "4.0.0_best_int",
      `${code}.traineddata.gz`,
    );
    await copyFile(src, path.join(dir, `${code}.traineddata.gz`));
  }
  return dir;
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const langPath = await ensureLangDir();
      return createWorker("chi_sim+eng", 1, {
        langPath,
        cachePath: langPath,
        gzip: true,
        cacheMethod: "none",
      });
    })().catch((err: unknown) => {
      workerPromise = undefined;
      throw err;
    });
  }
  return workerPromise;
}

export async function shutdownOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = undefined;
  if (!pending) return;
  const worker = await pending.catch(() => undefined);
  await worker?.terminate();
}

export function sniffImage(bytes: Uint8Array): "png" | "jpeg" | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpeg";
  }
  return undefined;
}

export function decodeImageBase64(input: string): Uint8Array {
  const trimmed = input.trim();
  const base64 = trimmed.startsWith("data:")
    ? (trimmed.split(",", 2)[1] ?? "")
    : trimmed.replace(/\s+/g, "");
  if (!base64) throw new Error("图片 base64 是空的");
  const buf = Buffer.from(base64, "base64");
  if (buf.length === 0) throw new Error("图片 base64 无法解码");
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 ${MAX_IMAGE_BYTES} 字节上限`);
  }
  if (!sniffImage(buf)) {
    throw new Error("只支持 png / jpg 简历图片");
  }
  return new Uint8Array(buf);
}

/** OCR a png or jpeg. Returns normalized text; caller checks the length. */
export async function ocrImage(bytes: Uint8Array): Promise<string> {
  if (bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 ${MAX_IMAGE_BYTES} 字节上限`);
  }
  if (!sniffImage(bytes)) {
    throw new Error("OCR 只接受 png / jpg");
  }
  const worker = await getWorker();
  try {
    const result = await worker.recognize(Buffer.from(bytes));
    return normalizeOcr(result.data.text ?? "");
  } catch (err) {
    workerPromise = undefined;
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`OCR 失败：${message}`);
  }
}

export function assertOcrText(text: string): string {
  if (text.length < MIN_OCR_CHARS) {
    throw new Error(
      `OCR 未识别出足够文本（${text.length} 字，至少需要 ${MIN_OCR_CHARS}）。请换一张更清晰的扫描件，或直接粘贴简历文本。`,
    );
  }
  return text;
}
