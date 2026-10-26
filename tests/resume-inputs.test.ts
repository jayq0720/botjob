import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getResume, saveResume } from "../bot/lib/actions.js";
import { mcpActionContext } from "../bot/lib/state-store.js";
import { resumePdfPath } from "../bot/lib/store.js";

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

test("file and base64 PDFs use the same extraction and preserve original bytes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-resume-input-"));
  const ctx = mcpActionContext(home);
  try {
    const filePath = fixture("sample-resume.pdf");
    const bytes = await readFile(filePath);
    const fileResult = await saveResume(ctx, { filePath, filename: "resume.pdf" });
    const fileResume = await getResume(ctx, {});
    const base64Result = await saveResume(ctx, {
      pdfBase64: `data:application/pdf;base64,${bytes.toString("base64")}`,
      filename: "resume.pdf",
    });
    const base64Resume = await getResume(ctx, {});
    assert.deepEqual(base64Result, fileResult);
    assert.equal(base64Resume.text, fileResume.text);
    assert.equal(base64Resume.meta?.hasPdf, true);
    const persisted = await readFile(path.join(home, "data/files", resumePdfPath(ctx.sessionId)));
    assert.deepEqual(persisted, bytes);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("base64 image uses OCR and rejects ambiguous inputs before replacing the resume", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-image-input-"));
  const ctx = mcpActionContext(home);
  try {
    const imageBase64 = (await readFile(fixture("sample-resume-scan.png"))).toString("base64");
    const result = await saveResume(ctx, { imageBase64 });
    assert.equal(result.ocr, true);
    assert.equal(result.filename, "resume.png");
    const saved = await getResume(ctx, {});
    assert.match(saved.text!, /李明/);
    assert.equal(saved.meta?.source, "image");
    await assert.rejects(() => saveResume(ctx, { imageBase64, text: "ambiguous" }), /exactly one/);
    assert.deepEqual(await getResume(ctx, {}), saved);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
