import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("console log/info/debug/dir/table/trace stay off stdout", async () => {
  const script = `
    await import("./mcp/silence-stdout.ts");
    console.log("LOG-MARK");
    console.info("INFO-MARK");
    console.debug("DEBUG-MARK");
    console.dir("DIR-MARK");
    console.table([{ k: "TABLE-MARK" }]);
    console.trace("TRACE-MARK");
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const code = await new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (status) => resolve(status ?? 1));
  });
  assert.equal(code, 0);
  assert.equal(Buffer.concat(stdout).toString(), "");
  const err = Buffer.concat(stderr).toString();
  for (const mark of ["LOG-MARK", "INFO-MARK", "DEBUG-MARK", "DIR-MARK", "TABLE-MARK", "TRACE-MARK"]) {
    assert.match(err, new RegExp(mark));
  }
  const bin = await readFile(path.join(root, "bin/botjob-mcp.js"), "utf8");
  assert.match(bin, /\["log", "info", "debug", "dir", "table", "trace"\]/);
});
