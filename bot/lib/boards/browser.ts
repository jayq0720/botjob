import path from "node:path";
import { readlinkSync } from "node:fs";
import { hostname } from "node:os";
import { mkdir } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright";
import { botjobHome } from "../state-store.js";
import { jobUrlAllowed } from "../jd.js";
import { SUPPORTED_BOARDS, type BoardId } from "./types.js";
import { MAX_BODY_BYTES, type PageReader } from "./fetch.js";
import { readRenderedJobs } from "./rendered.js";
import { resolveLoginBrowser } from "./system-browser.js";

const homes = { zhilian: "https://www.zhaopin.com/", liepin: "https://www.liepin.com/", job51: "https://login.51job.com/login.php" };
const names = { zhilian: "智联", liepin: "猎聘", job51: "前程无忧" };

/** Cookies remain in a dedicated local browser profile; never returned to the AI. */
export function createBrowserAccess(launch: () => Promise<BrowserContext>, render = readRenderedJobs, describe: () => LaunchInfo | undefined = () => launched) {
  // One window for every board, so the user never has to guess which window to log in to.
  let session: Promise<BrowserContext> | undefined;
  const tabs = new Map<BoardId, Page>();
  const claimed = new WeakSet<Page>();
  let picking: Promise<unknown> = Promise.resolve();
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
    // Tab choice is serialized: concurrent opens would otherwise grab the same blank tab before navigation commits.
    const picked = picking.then(async () => {
      const known = tabs.get(board);
      if (known && !known.isClosed()) return known;
      const page = ctx.pages().find(item => !claimed.has(item) && (jobUrlAllowed(item.url(), board) || item.url() === "about:blank")) ?? await ctx.newPage();
      claimed.add(page);
      tabs.set(board, page);
      return page;
    });
    picking = picked.catch(() => undefined);
    const page = await picked;
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
        if (Buffer.byteLength(body) > MAX_BODY_BYTES) return { error: "响应体超过 8MB。" };
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

/** PID of a live browser on this machine holding the profile's Chromium SingletonLock ("host-pid"), if any. */
export function profileLockOwner(profile: string, host = hostname()): number | undefined {
  let target: string;
  try { target = readlinkSync(path.join(profile, "SingletonLock")); } catch { return undefined; }
  const match = target.match(/^(.*)-(\d+)$/);
  if (!match || match[1] !== host) return undefined;
  const pid = Number(match[2]);
  try { process.kill(pid, 0); return pid; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM" ? pid : undefined; }
}

export function profileLockedMessage(pid: number): string {
  return `botjob 的登录浏览器窗口已经在运行（浏览器进程 ${pid}），可能是另一个 AI 客户端里的 botjob 或之前没有退出的 botjob 打开的。同一份登录记录一次只能被一个窗口使用：请关闭那个 botjob 浏览器窗口（或退出占用它的 AI 客户端）后重试。登录状态保存在 botjob 自己的配置里，关闭窗口不会丢失。`;
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
  // Another botjob window already holds this profile; a second launch would fail, and bundled Chromium cannot share it either.
  const owner = profileLockOwner(profile);
  if (owner) throw new Error(profileLockedMessage(owner));
  const { browser, note } = await resolveLoginBrowser();
  const options = { headless: false, locale: "zh-CN", viewport: null } as const;
  if (browser) {
    try {
      const context = await chromium.launchPersistentContext(profile, { ...options, executablePath: browser.executablePath, channel: browser.channel });
      launched = { name: browser.name, note };
      return context;
    } catch {
      const holder = profileLockOwner(profile);
      if (holder) throw new Error(profileLockedMessage(holder));
      /* Fall through to the bundled Chromium below. */
    }
  }
  try {
    const context = await chromium.launchPersistentContext(profile, options);
    launched = { name: "botjob 自带的 Chromium", note: browser ? `无法启动 ${browser.name}（可能版本过旧或正被占用），已改用 botjob 自带的 Chromium。` : note };
    return context;
  } catch {
    throw new Error(`无法打开登录浏览器${browser ? `（${browser.name}）` : ""}。请关闭占用 botjob 窗口的浏览器后重试；若电脑没有 Chrome/Edge，请在仓库执行 npx playwright install chromium。`);
  }
});
