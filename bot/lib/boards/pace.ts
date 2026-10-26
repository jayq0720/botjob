import { createHash } from "node:crypto";
import { canonicalJobUrl, type JobPosting } from "../jd.js";
import type { StateStore } from "../state-store.js";
import type { PageReader } from "./fetch.js";
import type { BoardId } from "./types.js";

/** Random gap between two page loads on one site. Tests set both to 0. */
export const readPacing = { minGapMs: 3_000, maxGapMs: 6_000 };

type Lane = { tail: Promise<unknown>; last: number };
const lanes = new Map<BoardId, Lane>();

/** One page at a time per site, and a 3–6 s random pause after the previous load finished. */
export function paced(board: BoardId, read: PageReader, sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): PageReader {
  return url => {
    const lane = lanes.get(board) ?? { tail: Promise.resolve(), last: 0 };
    lanes.set(board, lane);
    const run = lane.tail.then(async () => {
      const gap = readPacing.minGapMs + Math.random() * (readPacing.maxGapMs - readPacing.minGapMs);
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
