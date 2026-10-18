import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "bin/botjob-mcp.js");
const resumePdf = path.join(root, "fixtures/sample-resume.pdf");
const resumeScan = path.join(root, "fixtures/sample-resume-scan.png");

test("child stdout is JSON-RPC on the PDF and OCR paths", { timeout: 60_000 }, async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-stdout-"));
  const child = spawn(process.execPath, [bin], {
    cwd: root,
    env: { ...process.env, BOTJOB_HOME: home, BOTJOB_OFFLINE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buf = "";
  let stderr = "";
  const lines: string[] = [];
  const waiters = new Map<number, (message: Record<string, unknown>) => void>();
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buf += chunk;
    let nl = buf.indexOf("\n");
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      nl = buf.indexOf("\n");
      if (!line.trim()) continue;
      lines.push(line);
      const message = JSON.parse(line) as Record<string, unknown>;
      assert.equal(message.jsonrpc, "2.0");
      const id = message.id;
      if (typeof id === "number" && waiters.has(id)) {
        waiters.get(id)!(message);
        waiters.delete(id);
      }
    }
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  function request(id: number, method: string, params: unknown) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timeout ${method}\nstderr:\n${stderr}`));
      }, 50_000);
      waiters.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  try {
    const init = await request(1, "initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "stdout-test", version: "0.0.0" },
    });
    assert.equal(init.id, 1);
    assert.ok(init.result);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );

    const pdf = await request(2, "tools/call", {
      name: "save_resume",
      arguments: { filePath: resumePdf },
    });
    const pdfBody = toolJson(pdf);
    assert.equal(pdfBody.saved, true);
    assert.equal(pdfBody.ocr, false);

    const scan = await request(3, "tools/call", {
      name: "save_resume",
      arguments: { filePath: resumeScan },
    });
    const scanBody = toolJson(scan);
    assert.equal(scanBody.saved, true);
    assert.equal(scanBody.ocr, true);

    assert.equal(buf.trim(), "");
    assert.ok(lines.length >= 3);
    for (const line of lines) {
      const message = JSON.parse(line) as { jsonrpc?: string };
      assert.equal(message.jsonrpc, "2.0");
      assert.doesNotMatch(line, /traineddata|PRIVATE|console/);
    }
  } finally {
    child.kill();
    await rm(home, { recursive: true, force: true });
  }
});

function toolJson(message: Record<string, unknown>): Record<string, unknown> {
  const result = message.result as {
    isError?: boolean;
    content?: Array<{ type?: string; text?: string }>;
  };
  assert.notEqual(result.isError, true);
  const text = result.content?.find((item) => item.type === "text")?.text;
  assert.ok(text);
  return JSON.parse(text) as Record<string, unknown>;
}
