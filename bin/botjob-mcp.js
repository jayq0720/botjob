#!/usr/bin/env node
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(entry), "..");
const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const [command, client, ...extra] = process.argv.slice(2);
const clients = ["cursor", "claude-desktop", "claude-code", "codex"];

function help() {
  return `botjob ${manifest.version} — 在你常用的 AI 客户端里管理求职\n\n` +
    `用法：\n  node bin/botjob-mcp.js                 启动 stdio MCP 服务\n` +
    `  node bin/botjob-mcp.js --config <客户端>  输出接入配置\n` +
    `  node bin/botjob-mcp.js --check         检查运行环境及数据目录\n` +
    `  node bin/botjob-mcp.js --version       查看版本\n\n` +
    `客户端：${clients.join(", ")}\n` +
    `BOTJOB_HOME 可指定独立求职数据目录。模型由客户端提供，无需 Cursor API key。\n`;
}

try {
  if (extra.length || (client && command !== "--config")) throw new Error("参数不正确。使用 --help 查看用法。");
  if (command === "--help" || command === "-h") {
    process.stdout.write(help());
  } else if (command === "--version") {
    process.stdout.write(`${manifest.version}\n`);
  } else if (command === "--config") {
    if (!clients.includes(client)) throw new Error(`客户端必须是：${clients.join(", ")}`);
    const config = { command: process.execPath, args: [entry] };
    const dataHome = process.env.BOTJOB_HOME?.trim();
    if (dataHome) config.env = { BOTJOB_HOME: path.resolve(dataHome) };
    if (client === "codex") {
      process.stdout.write(`[mcp_servers.botjob]\ncommand = ${JSON.stringify(config.command)}\nargs = ${JSON.stringify(config.args)}\n`);
      if (config.env) process.stdout.write(`\n[mcp_servers.botjob.env]\nBOTJOB_HOME = ${JSON.stringify(config.env.BOTJOB_HOME)}\n`);
    } else {
      if (client !== "claude-desktop") config.type = "stdio";
      process.stdout.write(`${JSON.stringify({ mcpServers: { botjob: config } }, null, 2)}\n`);
    }
  } else if (!command || command === "--check") {
    const [major, minor] = process.versions.node.split(".").map(Number);
    if (major < 22 || (major === 22 && minor < 13)) throw new Error("需要 Node.js >=22.13。");
    // From this point stdout belongs exclusively to the MCP protocol or check result.
    for (const name of ["log", "info", "debug", "dir", "table", "trace"]) {
      console[name] = console.error.bind(console);
    }
    const { register } = await import("tsx/esm/api");
    register();
    if (command === "--check") {
      const require = createRequire(import.meta.url);
      for (const dependency of ["@modelcontextprotocol/sdk/client/index.js", "pdf-parse", "tesseract.js",
        "@tesseract.js-data/chi_sim/package.json", "@tesseract.js-data/eng/package.json"]) require.resolve(dependency);
      const dataHome = path.resolve(process.env.BOTJOB_HOME?.trim() || path.join(homedir(), ".botjob"));
      await mkdir(dataHome, { recursive: true });
      const probe = await mkdtemp(path.join(dataHome, "check-"));
      await rm(probe, { recursive: true });
      const { createBotjobServer } = await import(new URL("../mcp/server.ts", import.meta.url).href);
      const server = createBotjobServer();
      await server.close();
      process.stdout.write(`${JSON.stringify({ ok: true, version: manifest.version, node: process.versions.node,
        transport: "stdio", dataHome, modelCredentialsRequired: false })}\n`);
    } else {
      await import(new URL("../mcp/stdio.ts", import.meta.url).href);
    }
  } else {
    throw new Error(`未知命令：${command}。使用 --help 查看用法。`);
  }
} catch (error) {
  process.stderr.write(`botjob: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
