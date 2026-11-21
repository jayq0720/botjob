import "./silence-stdout.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { browserAccess } from "../bot/lib/boards/browser.js";
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

// AI clients usually stop botjob by closing stdin or sending a signal. Close the login window
// properly first: Chromium then writes its cookies to disk and botjob saves the login copy.
let shuttingDown: Promise<void> | undefined;
function shutdown(exitCode?: number) {
  shuttingDown ??= (async () => {
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5_000).unref());
    await Promise.race([Promise.allSettled([browserAccess.close(), server.closeReview()]), timeout]);
  })();
  if (exitCode !== undefined) void shuttingDown.finally(() => process.exit(exitCode));
  return shuttingDown;
}
server.server.onclose = () => { void shutdown(); };
process.stdin.on("end", () => { void shutdown(0); });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.once(signal, () => { void shutdown(0); });
process.stderr.write("botjob-mcp stdio 已启动。日志只写 stderr。\n");
