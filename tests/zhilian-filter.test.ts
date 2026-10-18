import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { filterZhilianListings, keywordTokens } from "../bot/lib/boards/zhilian.js";

test("高级前端工程师 keeps 前端 and drops other cities and roles", () => {
  assert.deepEqual(keywordTokens("高级前端工程师"), ["前端"]);
  const listings = JSON.parse(
    readFileSync(new URL("../fixtures/zhilian-mixed-listings.json", import.meta.url), "utf8"),
  ) as { title: string; city: string; description: string }[];
  const kept = filterZhilianListings(listings, {
    titles: ["高级前端工程师"],
    keywords: ["React", "TypeScript"],
    cities: ["上海"],
  });
  assert.deepEqual(
    kept.map((job) => job.title),
    ["前端高级UI设计", "高级前端工程师"],
  );
  assert.ok(kept.every((job) => job.city.includes("上海")));
});
