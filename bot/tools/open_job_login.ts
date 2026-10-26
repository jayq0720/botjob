import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { browserAccess } from "../lib/boards/browser.js";

export default defineTool({
  description: "通过扩展连接用户日常 Chrome/Edge 并复用已有登录态。首次返回 awaiting_browser_connection 时请先加载 extensionDirectory 并配对，再调用本工具。用户自行登录后在聊天中确认，再以 search_jobs accessMode=browser 继续；无桌面的云端不可用。不会返回账号凭据。",
  effect: "write",
  inputSchema: z.object({ board: z.enum(["zhilian", "liepin"]), url: z.string().optional() }),
  async execute(input) { return browserAccess.open(input.board, input.url); },
});
