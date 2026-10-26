import path from "node:path";
import { mkdir } from "node:fs/promises";
import type { BrowserContext } from "playwright";
import { botjobHome } from "../state-store.js";
import { jobUrlAllowed } from "../jd.js";
import { SUPPORTED_BOARDS, type BoardId } from "./types.js";
import type { PageReader } from "./fetch.js";
import { readRenderedJobs } from "./rendered.js";
import { resolveLoginBrowser } from "./system-browser.js";

const homes = { zhilian: "https://www.zhaopin.com/", liepin: "https://www.liepin.com/", job51: "https://login.51job.com/login.php" };
const names = { zhilian: "智联", liepin: "猎聘", job51: "前程无忧" };

/** Cookies remain in a dedicated local browser profile; never returned to the AI. */
export function createBrowserAccess(launch: () => Promise<BrowserContext>, render = readRenderedJobs, describe: () => LaunchInfo | undefined = () => launched) {
  // One window for every board, so the user never has to guess which window to log in to.
  let session: Promise<BrowserContext> | undefined;
  function context() {
    if (!session) {
      const pending = session = launch();
      pending.then(ctx => ctx.on("close", () => { if (session === pending) session = undefined; }), () => { if (session === pending) session = undefined; });
    }
    return session;
  }
  async function open(board: BoardId, url = homes[board]) {
    if (!SUPPORTED_BOARDS.includes(board) || !jobUrlAllowed(url, board)) throw new Error("登录链接必须属于所选招聘站。");
    const ctx = await context();
    const existing = ctx.pages().find(page => jobUrlAllowed(page.url(), board)) ?? ctx.pages().find(page => page.url() === "about:blank");
    const page = existing ?? await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.bringToFront();
    const info = describe();
    const where = info ? `${info.name}中的 botjob 窗口` : "botjob 打开的浏览器窗口";
    return { ok: true as const, board, status: "awaiting_login" as const, url, ...(info ? { browser: info.name } : {}),
      message: `${info?.note ? info.note + " " : ""}请在${where}里登录${names[board]}账号（该窗口使用独立的登录记录，平时浏览器里的登录不会带过来，但登录一次后会被记住）。各招聘站在同一个窗口的不同标签页。完成后告诉 AI 已登录，再继续搜索。不要在聊天里发送密码、验证码或 Cookie。` };
  }
  function reader(board: BoardId): PageReader {
    return async url => {
      if (!jobUrlAllowed(url, board)) return { error: "只读取当前招聘站的页面。" };
      let ctx: BrowserContext;
      // The profile keeps earlier logins, so a restarted MCP server can read without a new login window.
      try { ctx = await context(); }
      catch (error) { return { error: error instanceof Error ? error.message : "无法打开浏览器。" }; }
      const page = await ctx.newPage();
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
  return { open, reader, async applicationPage(_board: BoardId) {
    return session ? (await session).newPage() : undefined;
  }, async close() {
    const pending = session;
    session = undefined;
    await pending?.then(ctx => ctx.close()).catch(() => undefined);
  } };
}

type LaunchInfo = { name: string; note?: string };
let launched: LaunchInfo | undefined;

export const browserAccess = createBrowserAccess(async () => {
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error("当前云环境没有可交互的浏览器窗口。请在自己的电脑运行 botjob MCP，再调用 open_job_login；在电脑浏览器登录不会自动登录云端。");
  }
  const { chromium } = await import("playwright");
  const profile = path.join(botjobHome(), "search-browser", "shared");
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const { browser, note } = await resolveLoginBrowser();
  const options = { headless: false, locale: "zh-CN", viewport: null } as const;
  if (browser) {
    try {
      const context = await chromium.launchPersistentContext(profile, { ...options, executablePath: browser.executablePath, channel: browser.channel });
      launched = { name: browser.name, note };
      return context;
    } catch { /* Fall through to the bundled Chromium below. */ }
  }
  try {
    const context = await chromium.launchPersistentContext(profile, options);
    launched = { name: "botjob 自带的 Chromium", note: browser ? `无法启动 ${browser.name}（可能版本过旧或正被占用），已改用 botjob 自带的 Chromium。` : note };
    return context;
  } catch {
    throw new Error(`无法打开登录浏览器${browser ? `（${browser.name}）` : ""}。请关闭占用 botjob 窗口的浏览器后重试；若电脑没有 Chrome/Edge，请在仓库执行 npx playwright install chromium。`);
  }
});
