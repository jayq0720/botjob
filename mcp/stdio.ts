import "./silence-stdout.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBotjobServer } from "./server.js";

const server = createBotjobServer();
const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("botjob-mcp stdio 已启动。日志只写 stderr。\n");
