import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { botjobHome } from "../state-store.js";
import { jobUrlAllowed } from "../jd.js";
import { SUPPORTED_BOARDS, type BoardId } from "./types.js";
import type { PageReader } from "./fetch.js";
import { readRenderedJobs } from "./rendered.js";

const homes = { zhilian: "https://www.zhaopin.com/", liepin: "https://www.liepin.com/" };

/** Cookies remain in a dedicated local browser profile; never returned to the AI. */
export function createBrowserAccess(launch: (board: BoardId) => Promise<BrowserContext>, render = readRenderedJobs) {
  const sessions = new Map<BoardId, Promise<BrowserContext>>();
  async function open(board: BoardId, url = homes[board]) {
    if (!SUPPORTED_BOARDS.includes(board) || !jobUrlAllowed(url, board)) throw new Error("登录链接必须属于所选招聘站。");
    let pending = sessions.get(board);
    if (!pending) {
      pending = launch(board);
      sessions.set(board, pending);
      pending.then(context => context.on("close", () => sessions.delete(board)), () => sessions.delete(board));
    }
    const context = await pending;
    const page = context.pages()[0] ?? await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.bringToFront();
    return { ok: true as const, board, status: "awaiting_login" as const, url,
      message: `请在 botjob 刚打开的${board === "liepin" ? "猎聘" : "智联"}专用窗口中登录自己的账号；日常 Chrome/Edge 窗口的登录不会同步到这里，两站也需要分别登录。完成后保持窗口打开，告诉 AI 已登录，再继续搜索。不要在聊天里发送密码、验证码或 Cookie。` };
  }
  function reader(board: BoardId): PageReader {
    return async url => {
      if (!jobUrlAllowed(url, board)) return { error: "只读取当前招聘站的页面。" };
      const pending = sessions.get(board);
      if (!pending) return { status: 401, finalUrl: homes[board], body: "请先打开登录窗口", contentType: "text/html" };
      const context = await pending;
      const page = await context.newPage();
      try {
        // Browser-managed cookies never enter fetch headers or model-visible results.
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (!jobUrlAllowed(page.url(), board)) return { error: "页面跳转离开当前招聘站，请在登录窗口手动完成验证。" };
        const rendered = await render(page, board);
        if (!jobUrlAllowed(page.url(), board)) return { error: "页面跳转离开当前招聘站，请在登录窗口手动完成验证。" };
        const body = await page.content();
        if (Buffer.byteLength(body) > 2_000_000) return { error: "响应体超过 2MB。" };
        return { status: response?.status() ?? 200, finalUrl: page.url(), body, contentType: "text/html", rendered };
      } catch {
        return { error: "浏览器读取失败。请检查登录窗口是否仍然打开，再重试。" };
      } finally { await page.close().catch(() => undefined); }
    };
  }
  return { open, reader, async applicationPage(board: BoardId) {
    const pending = sessions.get(board);
    return pending ? (await pending).newPage() : undefined;
  }, async close() {
    await Promise.allSettled([...sessions.values()].map(async p => (await p).close()));
    sessions.clear();
  } };
}

export const browserAccess = createBrowserAccess(async board => {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error("当前云环境没有可交互的浏览器窗口。请在自己的电脑运行 botjob MCP，再调用 open_job_login；在电脑浏览器登录不会自动登录云端。");
  }
  try {
    const { chromium } = await import("playwright");
    const profile = path.join(botjobHome(), "search-browser", board);
    await mkdir(profile, { recursive: true, mode: 0o700 });
    return await chromium.launchPersistentContext(profile, { headless: false, locale: "zh-CN" });
  } catch {
    throw new Error("无法打开登录浏览器。请在本机仓库执行 npm install 和 npx playwright install chromium，关闭占用同一配置目录的实例后重试。");
  }
});
