import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const raw = execFileSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
});
const start = raw.indexOf("[");
const parsed = JSON.parse(raw.slice(start));
const files = parsed[0].files.map((file) => file.path);

const required = [
  "package.json",
  "README.md",
  "npm-shrinkwrap.json",
  "bin/botjob-mcp.js",
  "mcp/stdio.ts",
  "mcp/server.ts",
  "extension/manifest.json",
  "extension/background.js",
  "extension/page.js",
  "extension/popup.html",
  "extension/popup.js",
  "bot/lib/actions.ts",
  "bot/lib/jd.ts",
  "bot/skills/job-hunt/SKILL.md",
  "skills/botjob/SKILL.md",
];
for (const file of required) {
  assert.ok(files.includes(file), `pack is missing ${file}`);
}

const banned = files.filter(
  (file) =>
    file.startsWith("tests/") ||
    file.startsWith("fixtures/") ||
    file.startsWith("evals/") ||
    file.startsWith("node_modules/") ||
    file.startsWith(".git/") ||
    file === ".git",
);
assert.deepEqual(banned, []);
console.log(`pack ok: ${files.length} files`);
