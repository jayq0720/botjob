import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  applicationsToPack,
  boardApplyHints,
  parseApplyPack,
} from "../bot/lib/apply-pack.js";
import type { ApplicationRecord } from "../bot/lib/store.js";

test("apply pack keeps greeting, letter, and liepin jobs", () => {
  const raw = readFileSync(new URL("../fixtures/sample-apply-pack-liepin.json", import.meta.url), "utf8");
  const pack = parseApplyPack(raw);
  assert.equal(pack.items[0]?.board, "liepin");
  assert.ok(pack.items[0]?.greeting);
  assert.ok((pack.items[0]?.greeting?.length ?? 0) <= 200);
  assert.match(boardApplyHints.liepin.selectors.join(" "), /立即沟通/);

  const app: ApplicationRecord = {
    id: "app-1",
    status: "approved",
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    greeting: "您好，想沟通一下这个前端岗位。",
    coverLetter: "我有 6 年前端经验，熟悉 React 和 TypeScript，希望进一步沟通。",
    job: {
      id: "liepin-abc",
      board: "liepin",
      title: "资深前端工程师",
      company: "云桥网络",
      city: "上海",
      salary: "30-50K",
      url: "https://www.liepin.com/job/abc123.html",
      matchReason: "综合 90 分",
      matchScore: 90,
    },
  };
  const exported = applicationsToPack("s1", [app]);
  const again = parseApplyPack(JSON.stringify(exported));
  assert.equal(again.items[0]?.greeting, app.greeting);
  assert.equal(again.items[0]?.coverLetter, app.coverLetter);
  assert.equal(again.items[0]?.matchScore, 90);
  assert.throws(() => parseApplyPack("{}"), /version 1/);
});
