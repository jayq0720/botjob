import "./silence-stdout.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBotjobServer } from "./server.js";

process.on("uncaughtException", (err) => {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`botjob-mcp uncaughtException: ${detail}\n`);
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  const detail = reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  process.stderr.write(`botjob-mcp unhandledRejection: ${detail}\n`);
  process.exit(1);
});

const server = createBotjobServer();
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("botjob-mcp stdio 已启动。日志只写 stderr。\n");
