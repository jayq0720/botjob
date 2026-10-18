import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSearchPacks } from "../bot/lib/boards/index.js";

test("search URLs for four boards", () => {
  const packs = buildSearchPacks({
    titles: ["高级前端工程师"],
    keywords: ["React"],
    cities: ["上海"],
  });
  const byBoard = Object.fromEntries(packs.map((pack) => [pack.board, pack.searchUrl]));
  assert.equal(packs.length, 4);
  assert.match(byBoard.zhilian, /^https:\/\/sou\.zhaopin\.com\/\?/);
  assert.match(byBoard.zhilian, /kw=/);
  assert.match(byBoard.zhilian, /jl=538/);
  assert.doesNotMatch(byBoard.zhilian, /jl=%E4%B8%8A%E6%B5%B7/);
  assert.match(byBoard.liepin, /^https:\/\/www\.liepin\.com\/city-sh\/zhaopin\/\?/);
  assert.match(byBoard.job51, /^https:\/\/we\.51job\.com\/pc\/search\?/);
  assert.match(byBoard.boss, /^https:\/\/www\.zhipin\.com\/web\/geek\/job\?/);
  assert.match(byBoard.boss, /city=101020100/);
  assert.match(byBoard.boss, /query=/);
});
