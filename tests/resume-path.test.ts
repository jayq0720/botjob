import assert from "node:assert/strict";
import { mkdtemp, mkdir, open, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { getResume, MAX_LOCAL_RESUME_BYTES, saveResume } from "../bot/lib/actions.js";
import { mcpActionContext } from "../bot/lib/state-store.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const samplePdf = path.join(root, "fixtures/sample-resume.pdf");
const sentinel = "PRIVATE-KEY-SENTINEL";

test("save_resume filePath rejects hidden files, oversized files, and bad bytes", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-home-"));
  const dir = await mkdtemp(path.join(tmpdir(), "botjob-files-"));
  const ctx = mcpActionContext(home);
  try {
    await mkdir(path.join(dir, ".ssh"));
    await writeFile(path.join(dir, ".ssh", "id_rsa"), sentinel);
    await writeFile(path.join(dir, ".env"), `API_KEY=${sentinel}\n`);
    await mkdir(path.join(dir, "docs", ".private"), { recursive: true });
    await writeFile(path.join(dir, "docs", ".private", "resume.txt"), sentinel);
    await mkdir(path.join(dir, ".secret"));
    await writeFile(path.join(dir, ".secret", "key.txt"), sentinel);
    await symlink(path.join(dir, ".secret", "key.txt"), path.join(dir, "resume.txt"));
    const huge = path.join(dir, "huge.pdf");
    const handle = await open(huge, "w");
    await handle.truncate(MAX_LOCAL_RESUME_BYTES + 1);
    await handle.close();
    await writeFile(path.join(dir, "notes.pdf"), "this is not a pdf");
    await writeFile(path.join(dir, "bad.txt"), Buffer.from([0xff, 0xfe, 0xfd]));
    await writeFile(path.join(dir, "nul.txt"), Buffer.from("hello\0world"));

    const rejected: Array<[string, RegExp]> = [
      [path.join(dir, ".ssh", "id_rsa"), /隐藏/],
      [path.join(dir, ".env"), /隐藏/],
      [path.join(dir, "docs", ".private", "resume.txt"), /隐藏/],
      [`${path.join(dir, "nope")}${path.sep}..${path.sep}.ssh${path.sep}id_rsa`, /隐藏/],
      [path.join(dir, "resume.txt"), /隐藏/],
      [huge, /字节上限/],
      [path.join(dir, "notes.pdf"), /扩展名/],
      [path.join(dir, "bad.txt"), /UTF-8/],
      [path.join(dir, "nul.txt"), /UTF-8/],
    ];
    for (const [filePath, pattern] of rejected) {
      await assert.rejects(
        () => saveResume(ctx, { filePath }),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, pattern);
          assert.equal(err.message.includes(sentinel), false);
          return true;
        },
      );
    }

    const empty = await getResume(ctx, {});
    assert.equal(empty.found, false);
    assert.equal(JSON.stringify(empty).includes(sentinel), false);

    const visible = path.join(dir, "cv.txt");
    const text = "姓名：张三\n求职意向：高级前端工程师\n技能：React 与 TypeScript\n";
    await writeFile(visible, text);
    const alias = path.join(dir, "alias.txt");
    await symlink(visible, alias);
    const viaLink = await saveResume(ctx, { filePath: alias });
    assert.equal(viaLink.saved, true);
    const loaded = await getResume(ctx, {});
    assert.equal(loaded.found, true);
    assert.match(String(loaded.text), /张三/);

    const pdf = await saveResume(ctx, { filePath: samplePdf });
    assert.equal(pdf.saved, true);
    assert.equal(pdf.ocr, false);
  } finally {
    await rm(home, { recursive: true, force: true });
    await rm(dir, { recursive: true, force: true });
  }
});
