#!/usr/bin/env node
// Same skip as .github/workflows/ci.yml when no Cursor credential is configured.
import { spawnSync } from "node:child_process";

if (!process.env.CURSOR_API_KEY) {
  console.log("CURSOR_API_KEY is unset; skipping evals");
  process.exit(0);
}

const result = spawnSync(
  "npx",
  ["bdk", "eval", "--dir", ".", "--json", "--no-stream"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
