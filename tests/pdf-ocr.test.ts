import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { extractTextFromPdf, MAX_OCR_PAGES, MAX_PDF_BYTES } from "../bot/lib/pdf.js";

function read(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
}

function blankPdf(pageCount: number): Uint8Array {
  const chunks: Buffer[] = [];
  let offset = 0;
  const offsets: number[] = [];
  const add = (part: string | Buffer) => {
    const buf = Buffer.isBuffer(part) ? part : Buffer.from(part);
    chunks.push(buf);
    offset += buf.length;
  };
  add("%PDF-1.4\n");
  const pageIds = Array.from({ length: pageCount }, (_, index) => index + 4);
  const objects = new Map<number, string>();
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(
    2,
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`,
  );
  objects.set(3, "<< /Length 0 >>\nstream\nendstream");
  for (const id of pageIds) {
    objects.set(
      id,
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 3 0 R >>",
    );
  }
  for (let id = 1; id <= 3 + pageCount; id += 1) {
    offsets[id] = offset;
    add(`${id} 0 obj\n${objects.get(id)}\nendobj\n`);
  }
  const xrefPos = offset;
  const max = 3 + pageCount;
  let xref = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= max; id += 1) {
    xref += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  add(xref);
  add(`trailer\n<< /Size ${max + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);
  return new Uint8Array(Buffer.concat(chunks));
}

test("text-layer PDF extracts 张三 without OCR", async () => {
  const result = await extractTextFromPdf(read("sample-resume.pdf"));
  assert.equal(result.ocr, false);
  assert.match(result.text, /张三/);
  assert.match(result.text, /React/);
  console.log("sample-resume.pdf preview:\n" + result.text.slice(0, 400));
});

test("scanned PDF and png OCR Chinese", async () => {
  const pdf = await extractTextFromPdf(read("sample-resume-scan.pdf"));
  assert.equal(pdf.ocr, true);
  assert.match(pdf.text, /李明/);
  assert.match(pdf.text, /后端/);
  console.log("sample-resume-scan.pdf preview:\n" + pdf.text.slice(0, 400));

  const { ocrImage, assertOcrText } = await import("../bot/lib/ocr.js");
  const imageText = assertOcrText(await ocrImage(read("sample-resume-scan.png")));
  assert.match(imageText, /李明/);
  assert.match(imageText, /上海/);
  console.log("sample-resume-scan.png preview:\n" + imageText.slice(0, 400));
});

test("OCR page cap and byte cap fail clearly", async () => {
  await assert.rejects(
    () => extractTextFromPdf(blankPdf(MAX_OCR_PAGES + 1)),
    /超过 OCR 上限/,
  );
  const huge = new Uint8Array(MAX_PDF_BYTES + 1);
  huge.set(Buffer.from("%PDF"));
  await assert.rejects(() => extractTextFromPdf(huge), /byte limit/);
});
