import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext, Cookie } from "playwright";

/**
 * Chromium drops session cookies (no Expires) when the window closes, and an MCP client that kills
 * botjob can stop the browser before its cookie database is flushed. Several job sites keep their
 * login in exactly those cookies, so a restarted botjob looked logged out. We keep a local copy of
 * the job sites' cookies (never other sites, never returned to the AI) and put back the missing ones
 * when the window opens again.
 */
const JOB_SITE = /(?:^|\.)(?:zhaopin\.com|liepin\.com|51job\.com)$/i;
/** A copy older than this is ignored; the user simply logs in again. */
export const SESSION_KEEP_MS = 14 * 24 * 3600_000;

type Saved = { version: 1; savedAt: number; cookies: Cookie[] };

const key = (cookie: Pick<Cookie, "name" | "domain" | "path">) => `${cookie.name}\u0000${cookie.domain.replace(/^\./, "")}\u0000${cookie.path}`;

export function jobSiteCookies(cookies: Cookie[]): Cookie[] {
  return cookies.filter(cookie => JOB_SITE.test(cookie.domain.replace(/^\./, "")));
}

export async function saveSessionCookies(context: BrowserContext, file: string, now = Date.now()): Promise<number> {
  const cookies = jobSiteCookies(await context.cookies());
  const body: Saved = { version: 1, savedAt: now, cookies };
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(body), { mode: 0o600 });
  await rename(temp, file);
  return cookies.length;
}

async function readSaved(file: string): Promise<Saved | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Saved;
    return parsed?.version === 1 && Array.isArray(parsed.cookies) ? parsed : undefined;
  } catch { return undefined; }
}

/** Adds saved job-site cookies the browser lost. Cookies the browser still has always win. */
export async function restoreSessionCookies(context: BrowserContext, file: string, now = Date.now()): Promise<number> {
  const saved = await readSaved(file);
  if (!saved || now - saved.savedAt > SESSION_KEEP_MS) return 0;
  const present = new Set((await context.cookies()).map(key));
  const missing = jobSiteCookies(saved.cookies)
    .filter(cookie => !present.has(key(cookie)))
    .filter(cookie => cookie.expires === -1 || cookie.expires * 1000 > now);
  if (!missing.length) return 0;
  try { await context.addCookies(missing); return missing.length; }
  catch {
    // One malformed cookie must not cost the others.
    let added = 0;
    for (const cookie of missing) { try { await context.addCookies([cookie]); added++; } catch { /* skip */ } }
    return added;
  }
}

/** True when an earlier botjob window left job-site cookies that are still fresh enough to reuse. */
export async function hasSavedSession(file: string, now = Date.now()): Promise<boolean> {
  const saved = await readSaved(file);
  return !!saved && now - saved.savedAt <= SESSION_KEEP_MS && jobSiteCookies(saved.cookies).length > 0;
}

/** Saves now and then while the window is open, so an abrupt exit loses at most a few seconds of login. */
export function keepSessionCookies(context: BrowserContext, file: string, intervalMs = 10_000) {
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<unknown> = Promise.resolve();
  let closed = false;
  const save = () => {
    if (closed) return pending;
    pending = pending.then(() => saveSessionCookies(context, file)).catch(() => undefined);
    return pending;
  };
  const soon = () => { if (timer || closed) return; timer = setTimeout(() => { timer = undefined; void save(); }, 1_500); timer.unref?.(); };
  const isJobSiteUrl = (raw: string) => {
    try { return JOB_SITE.test(new URL(raw).hostname); } catch { return false; }
  };
  const watch = (page: PageLike) => {
    page.on("load", soon);
    page.on("framenavigated", frame => { if (frame === page.mainFrame() && isJobSiteUrl(frame.url())) soon(); });
    page.on("response", res => { if (isJobSiteUrl(res.url())) soon(); });
  };
  context.pages().forEach(watch);
  context.on("page", watch);
  const interval = setInterval(() => { void save(); }, intervalMs);
  interval.unref?.();
  context.on("close", () => { closed = true; clearInterval(interval); if (timer) clearTimeout(timer); });
  return {
    save,
    stop() { closed = true; clearInterval(interval); if (timer) clearTimeout(timer); },
  };
}

type PageLike = {
  mainFrame(): unknown;
  on(event: "load", fn: () => void): unknown;
  on(event: "framenavigated", fn: (frame: { url(): string }) => void): unknown;
  on(event: "response", fn: (res: { url(): string }) => void): unknown;
};
