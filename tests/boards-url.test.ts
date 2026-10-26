import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSearchPacks } from "../bot/lib/boards/index.js";

test("search URLs for two boards", () => {
  const packs = buildSearchPacks({
    titles: ["高级前端工程师"],
    keywords: ["React"],
    cities: ["上海"],
  });
  const byBoard = Object.fromEntries(packs.map((pack) => [pack.board, pack.searchUrl]));
  assert.equal(packs.length, 2);
  assert.match(byBoard.zhilian, /^https:\/\/sou\.zhaopin\.com\/\?/);
  assert.match(byBoard.zhilian, /kw=/);
  assert.equal(new URL(byBoard.zhilian).searchParams.get("jl"), "538");
  assert.equal(new URL(byBoard.liepin).searchParams.get("pubTime"), "3");
  assert.match(byBoard.liepin, /^https:\/\/www\.liepin\.com\/city-sh\/zhaopin\/\?/);
});

test("Zhilian city filters use shared numeric IDs instead of silently searching nationwide", () => {
  for (const city of ["杭州", "杭州市"]) {
    const [pack] = buildSearchPacks({ titles: ["HR经理"], keywords: [], cities: [city] }, ["zhilian"]);
    assert.equal(new URL(pack.searchUrl).searchParams.get("jl"), "653");
  }
  const [unknown] = buildSearchPacks({ titles: ["HR经理"], keywords: [], cities: ["未映射城市"] }, ["zhilian"]);
  assert.equal(new URL(unknown.searchUrl).searchParams.has("jl"), false);
  assert.match(unknown.notes, /城市编码未配置/);
});
