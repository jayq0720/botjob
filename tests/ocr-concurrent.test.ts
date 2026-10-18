import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { ocrImage } from "../bot/lib/ocr.js";

test("two concurrent OCR calls both return text", async () => {
  const png = new Uint8Array(
    readFileSync(new URL("../fixtures/sample-resume-scan.png", import.meta.url)),
  );
  const [first, second] = await Promise.all([ocrImage(png), ocrImage(png)]);
  assert.match(first, /李明/);
  assert.match(second, /李明/);
  assert.match(first, /后端/);
  assert.match(second, /上海/);
});
