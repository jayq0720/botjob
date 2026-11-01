import { createHash } from "node:crypto";
import { canonicalJobUrl, type JobPosting } from "../jd.js";
import type { StateStore } from "../state-store.js";
import type { PageReader } from "./fetch.js";
import type { BoardId } from "./types.js";
import { logNormalMs, realSleep, type Random } from "./humanize.js";

/**
 * Gap between two page loads on one site: log-normal around the median, clamped to [min, max],
 * with an occasional longer pause as if the user stopped to read. Tests set min = max.
 * pagesPerHour caps loads per site in any rolling hour, across searches and MCP restarts.
 */
export const readPacing = { minGapMs: 3_000, medianGapMs: 4_500, maxGapMs: 15_000, longPauseChance: 0.1, pagesPerHour: 40 };

export function nextGapMs(random: Random = Math.random): number {
  const { minGapMs, medianGapMs, maxGapMs, longPauseChance } = readPacing;
  if (maxGapMs <= minGapMs) return Math.max(0, minGapMs);
  const median = Math.min(maxGapMs, Math.max(minGapMs, medianGapMs)) * (random() < longPauseChance ? 2.2 : 1);
  return logNormalMs({ medianMs: median, minMs: minGapMs, maxMs: maxGapMs }, random);
}

type Lane = { tail: Promise<unknown>; last: number };
const lanes = new Map<BoardId, Lane>();

/** One page at a time per site, and a human-like pause (usually 3–8 s) after the previous load finished. */
export function paced(board: BoardId, read: PageReader, sleep = realSleep): PageReader {
  return url => {
    const lane = lanes.get(board) ?? { tail: Promise.resolve(), last: 0 };
    lanes.set(board, lane);
    const run = lane.tail.then(async () => {
      const gap = nextGapMs();
      const wait = lane.last + gap - Date.now();
      if (lane.last && wait > 0) await sleep(wait);
      try { return await read(url); }
      finally { lane.last = Date.now(); }
    });
    lane.tail = run.catch(() => undefined);
    return run;
  };
}

export const DETAIL_CACHE_MS = 24 * 3600_000;

/** Parsed detail pages by canonical URL, kept 24 h so repeat searches do not reload them. Only job fields, never cookies or HTML. */
export function detailCache(store: StateStore) {
  const file = (url: string) => `cache/details/${createHash("sha256").update(canonicalJobUrl(url)).digest("hex").slice(0, 32)}.json`;
  return {
    async get(url: string, now = Date.now()): Promise<JobPosting | undefined> {
      try {
        const entry = JSON.parse(await store.readText(file(url)) ?? "null") as { url?: string; savedAt?: number; job?: JobPosting } | null;
        return entry?.job && entry.url === canonicalJobUrl(url) && typeof entry.savedAt === "number" && now - entry.savedAt < DETAIL_CACHE_MS ? entry.job : undefined;
      } catch { return undefined; }
    },
    async put(url: string, job: JobPosting, now = Date.now()) {
      await store.writeBytes(file(url), JSON.stringify({ url: canonicalJobUrl(url), savedAt: now, job }));
    },
  };
}
export type DetailCache = ReturnType<typeof detailCache>;

export const COOLDOWN_MS = 30 * 60_000;
export type SiteCooldown = { until: number; reason: "captcha" | "blocked"; url: string };

export function siteCooldownKey(sessionId: string): string {
  return `boards:${sessionId}:cooldown`;
}

/** Active cool-downs; expired entries are dropped. */
export async function activeCooldowns(store: StateStore, sessionId: string, now = Date.now()): Promise<Partial<Record<BoardId, SiteCooldown>>> {
  const saved = (await store.get(siteCooldownKey(sessionId)) ?? {}) as Partial<Record<BoardId, SiteCooldown>>;
  return Object.fromEntries(Object.entries(saved).filter(([, entry]) => entry && entry.until > now));
}

/** Start a cool-down for boards that hit a captcha or block; clear it for boards that read fine. */
export async function recordCooldowns(store: StateStore, sessionId: string, changes: Partial<Record<BoardId, SiteCooldown | null>>, now = Date.now()) {
  await store.update(siteCooldownKey(sessionId), current => {
    const next = { ...(current ?? {}) as Partial<Record<BoardId, SiteCooldown>> };
    for (const [board, entry] of Object.entries(changes) as [BoardId, SiteCooldown | null][]) {
      if (entry) next[board] = entry; else delete next[board];
    }
    for (const [board, entry] of Object.entries(next) as [BoardId, SiteCooldown][]) if (entry.until <= now) delete next[board];
    return { value: next, result: undefined };
  });
}

const HOUR_MS = 3600_000;

export function pageLoadsKey(sessionId: string): string {
  return `boards:${sessionId}:pageloads`;
}

/** Rolling one-hour page-load budget per site, persisted so a restarted MCP server still remembers it. */
export function pageBudget(store: StateStore, sessionId: string) {
  const key = pageLoadsKey(sessionId);
  const recent = (saved: unknown, board: BoardId, now: number) =>
    ((saved as Partial<Record<BoardId, number[]>> | undefined)?.[board] ?? []).filter(time => typeof time === "number" && now - time < HOUR_MS);
  return {
    /** Loads left this hour, and when the oldest counted load drops out of the window. */
    async status(board: BoardId, now = Date.now()) {
      const times = recent(await store.get(key), board, now);
      return { remaining: Math.max(0, readPacing.pagesPerHour - times.length), resetsAt: times.length ? Math.min(...times) + HOUR_MS : now };
    },
    /** Count one load if the budget allows it; false means do not load. */
    async take(board: BoardId, now = Date.now()): Promise<boolean> {
      return store.update(key, current => {
        const next = { ...(current ?? {}) as Partial<Record<BoardId, number[]>> };
        for (const site of Object.keys(next) as BoardId[]) next[site] = recent(next, site, now);
        const times = next[board] ?? [];
        if (times.length >= readPacing.pagesPerHour) return { value: next, result: false };
        next[board] = [...times, now];
        return { value: next, result: true };
      });
    },
  };
}
export type PageBudget = ReturnType<typeof pageBudget>;

export function budgetMessage(siteName: string, resetsAt: number, now = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((resetsAt - now) / 60_000));
  return `${siteName}在过去一小时内已读取 ${readPacing.pagesPerHour} 个页面，达到 botjob 为避免触发反爬设置的上限，约 ${minutes} 分钟后再搜索。已缓存的岗位详情不受影响。`;
}

/** A reader that refuses to load once the site's hourly budget is spent. Wrap inside paced(). */
export function budgeted(board: BoardId, siteName: string, read: PageReader, budget: PageBudget): PageReader {
  return async url => {
    if (await budget.take(board)) return read(url);
    return { error: budgetMessage(siteName, (await budget.status(board)).resetsAt) };
  };
}
