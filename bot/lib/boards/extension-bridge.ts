import { createServer, type ServerResponse } from "node:http";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { botjobHome } from "../state-store.js";

export type BrowserCommand = { type: "open" | "read" | "prepare_apply" | "click_apply"; board: "liepin" | "zhilian"; url?: string; token?: string };

type Pending = { command: BrowserCommand & { id: string }; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

/** Loopback-only, token-paired bridge. No arbitrary URL or script execution interface. */
export async function createExtensionBridge(token: string, port = 19873) {
  const pending = new Map<string, Pending>();
  const queue: string[] = [];
  let poll: ServerResponse | undefined;
  let lastSeen = 0;
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value));
  };
  const flush = () => {
    while (poll && queue.length) {
      const next = pending.get(queue.shift()!);
      if (!next) continue;
      const response = poll; poll = undefined; send(response, 200, next.command);
    }
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.headers.host !== `127.0.0.1:${(server.address() as { port: number }).port}`) { send(res, 403, { error: "host" }); return; }
      const origin = req.headers.origin;
      if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) { send(res, 403, { error: "origin" }); return; }
      if (req.url === "/" && req.method === "GET" && !origin) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Referrer-Policy": "no-referrer" });
        res.end('<!doctype html><meta charset="utf-8"><title>连接 botjob</title><body style="font:18px system-ui;max-width:760px;margin:64px auto;line-height:1.8"><h1>连接你的日常浏览器</h1><p>在 Chrome 或 Edge 的扩展管理页面启用开发者模式，加载 botjob 项目中的 extension 文件夹。然后回到本页，点击 botjob 扩展图标，再点“连接当前 botjob”。</p><p>连接完成后告诉 AI 继续登录或搜索。之后的招聘网站页面会复用这个浏览器的登录态。保持 MCP 服务运行。</p><p>首次加载需要你本人操作。不要分享本页地址，其中包含仅用于本机配对的密钥。</p>'); return;
      }
      const supplied = Buffer.from(req.headers.authorization?.replace(/^Bearer /, "") ?? "");
      const expected = Buffer.from(token);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { send(res, 401, { error: "pairing required" }); return; }
      if (req.method === "GET" && req.url === "/poll") {
        lastSeen = Date.now();
        if (poll) send(poll, 200, { type: "idle" });
        poll = res;
        const timer = setTimeout(() => { if (poll === res) { poll = undefined; send(res, 200, { type: "idle" }); } }, 20_000);
        res.on("close", () => { clearTimeout(timer); if (poll === res) poll = undefined; });
        flush(); return;
      }
      if (req.method === "POST" && req.url === "/result") {
        let size = 0; const chunks: Buffer[] = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 3_000_000) { send(res, 413, { error: "too large" }); req.destroy(); return; }
          chunks.push(chunk);
        }
        const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const task = pending.get(result.id);
        if (!task) { send(res, 409, { error: "expired" }); return; }
        pending.delete(result.id); clearTimeout(task.timer);
        if (result.error) task.reject(new Error(String(result.error).slice(0, 500)));
        else task.resolve(result.value);
        lastSeen = Date.now(); send(res, 200, { ok: true }); return;
      }
      send(res, 404, { error: "not found" });
    } catch { if (!res.headersSent) send(res, 400, { error: "invalid request" }); else res.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  server.unref();
  const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    address,
    connected: () => lastSeen > Date.now() - 45_000,
    command<T>(command: BrowserCommand, timeoutMs = 75_000): Promise<T> {
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const timer = setTimeout(() => { pending.delete(id); const index = queue.indexOf(id); if (index >= 0) queue.splice(index, 1); reject(new Error("浏览器扩展未及时响应，请检查浏览器、扩展连接和网站页面。")); }, timeoutMs);
        pending.set(id, { command: { ...command, id }, resolve: value => resolve(value as T), reject, timer }); queue.push(id); flush();
      });
    },
    async close() {
      if (poll) { send(poll, 200, { type: "idle" }); poll = undefined; }
      for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error("浏览器连接关闭")); }
      pending.clear(); queue.length = 0;
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}

let shared: Promise<Awaited<ReturnType<typeof createExtensionBridge>> & { pairingUrl: string }> | undefined;
export function extensionBridge() {
  if (!shared) shared = (async () => {
    const directory = path.join(botjobHome(), "browser-extension");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const tokenPath = path.join(directory, "pairing-token");
    let token: string;
    try { token = (await readFile(tokenPath, "utf8")).trim(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      token = randomBytes(32).toString("hex"); await writeFile(tokenPath, token, { mode: 0o600, flag: "wx" });
    }
    if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("本机浏览器配对文件无效，请检查 BOTJOB_HOME。");
    const configured = process.env.BOTJOB_EXTENSION_PORT ?? "19873";
    if (!/^\d+$/.test(configured) || +configured < 1024 || +configured > 65535) throw new Error("BOTJOB_EXTENSION_PORT 必须是 1024–65535 的本机端口。");
    const bridge = await createExtensionBridge(token, +configured);
    return { ...bridge, pairingUrl: `${bridge.address}/#${token}` };
  })().catch(error => { shared = undefined; throw error; });
  return shared;
}

export async function openDefaultBrowser(url: string) {
  // URL is generated by this module, never supplied by an untrusted page.
  if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) throw new Error("当前云环境没有交互桌面。请在自己的电脑运行 botjob MCP，以连接本机默认浏览器。");
  const command = process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", shell: false });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? resolve() : reject(new Error("无法打开默认浏览器，请在有桌面的电脑运行 MCP。")));
  });
}

export async function closeExtensionBridge() {
  const current = shared; shared = undefined;
  if (current) await (await current).close();
}
