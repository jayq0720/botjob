import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const exec = promisify(execFile);
const entry = fileURLToPath(new URL("../bin/botjob-mcp.js", import.meta.url));

test("generated client configurations start a real MCP connection from another directory", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-client-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, BOTJOB_HOME: home, BOTJOB_OFFLINE: "1" };
    delete env.CURSOR_API_KEY;
    for (const name of ["cursor", "claude-code", "claude-desktop"]) {
      const { stdout } = await exec(process.execPath, [entry, "--config", name], { env });
      const config = JSON.parse(stdout).mcpServers.botjob;
      assert.equal(config.env.BOTJOB_HOME, home);
      const transport = new StdioClientTransport({ ...config, cwd: tmpdir(), stderr: "pipe" });
      const client = new Client({ name: `test-${name}`, version: "1" });
      try {
        await client.connect(transport);
        assert.equal((await client.listTools()).tools.length, 15);
        const result = await client.callTool({ name: "get_workspace", arguments: {} });
        assert.equal(result.isError, undefined);
        assert.equal((result.structuredContent as Record<string, unknown>)?.savedJobs, 0);
      } finally { await client.close(); }
    }
    const { stdout } = await exec(process.execPath, [entry, "--config", "codex"], { env });
    assert.match(stdout, /^\[mcp_servers.botjob\]/);
    const command = JSON.parse(stdout.match(/^command = (.+)$/m)![1]);
    const args = JSON.parse(stdout.match(/^args = (.+)$/m)![1]);
    const transport = new StdioClientTransport({ command, args, cwd: tmpdir(), env: { BOTJOB_HOME: home }, stderr: "pipe" });
    const client = new Client({ name: "test-codex", version: "1" });
    try {
      await client.connect(transport);
      assert.equal((await client.listTools()).tools.length, 15);
    } finally { await client.close(); }
  } finally { await rm(home, { recursive: true, force: true }); }
});

test("CLI diagnostics finish without model authentication and bad commands fail", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "botjob-check-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, BOTJOB_HOME: home };
    delete env.CURSOR_API_KEY;
    const { stdout } = await exec(process.execPath, [entry, "--check"], { env });
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.equal(result.modelCredentialsRequired, false);
    assert.equal(result.dataHome, home);
    await assert.rejects(exec(process.execPath, [entry, "--config", "unknown"], { env }), { code: 1 });
    await assert.rejects(exec(process.execPath, [entry, "--unknown"], { env }), { code: 1 });
  } finally { await rm(home, { recursive: true, force: true }); }
});
