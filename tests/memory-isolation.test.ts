import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

test("users do not share a memory journal", () => {
  assert.equal(existsSync(new URL("../bot/hooks/memory.ts", import.meta.url)), false);
  const hooks = readdirSync(new URL("../bot/hooks", import.meta.url)).filter((name) =>
    name.endsWith(".ts"),
  );
  for (const name of hooks) {
    const text = readFileSync(new URL(`../bot/hooks/${name}`, import.meta.url), "utf8");
    assert.doesNotMatch(text, /memoryHook/);
  }
  const bot = readdirSync(new URL("../bot", import.meta.url));
  assert.equal(bot.includes("hooks"), true);
  const instructions = readFileSync(new URL("../bot/instructions.md", import.meta.url), "utf8");
  assert.doesNotMatch(instructions, /journal\.jsonl/);
  assert.doesNotMatch(instructions, /another conversation/);
});
