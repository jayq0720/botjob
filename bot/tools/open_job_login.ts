import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { browserAccess } from "../lib/boards/browser.js";

export default defineTool({
  description: "搜索需要登录时打开本机招聘网站浏览器。用户自行登录后在聊天中确认，再以 search_jobs accessMode=browser 继续；无桌面的云端不可用。不会返回账号凭据。",
  effect: "write",
  inputSchema: z.object({ board: z.enum(["zhilian", "liepin"]), url: z.string().optional() }),
  async execute(input) { return browserAccess.open(input.board, input.url); },
});
