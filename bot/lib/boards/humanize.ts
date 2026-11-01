import type { Page } from "playwright";

/**
 * Human-like timing and pointer movement for the botjob reading window.
 * Ideas follow xiaohongshu-mcp's humanize package (log-normal delays, Bezier mouse paths),
 * re-implemented here for Playwright. Nothing here solves captchas or hides automation;
 * it only makes page loads and scrolling less machine-regular.
 */

export type Random = () => number;
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Standard normal sample (Box-Muller). */
function normal(random: Random): number {
  const u = Math.max(random(), 1e-9);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Log-normal delay: most gaps sit near the median, a few run long, none below min or above max.
 * People pause like this; a uniform 3-6 s range is a flat, recognisable rhythm.
 */
export function logNormalMs(options: { medianMs: number; minMs: number; maxMs: number; sigma?: number }, random: Random = Math.random): number {
  const { medianMs, minMs, maxMs, sigma = 0.45 } = options;
  if (maxMs <= minMs) return Math.max(0, minMs);
  const value = medianMs * Math.exp(sigma * normal(random));
  return Math.round(Math.min(maxMs, Math.max(minMs, value)));
}

export type Point = { x: number; y: number };

/** Points on a cubic Bezier curve from `from` to `to`, with eased speed (slow start and end). */
export function bezierPath(from: Point, to: Point, steps: number, random: Random = Math.random): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  // Control points sit off the straight line, on a random side, so the path bows like a wrist movement.
  const spread = Math.min(200, distance * 0.35);
  const control = (t: number): Point => ({
    x: from.x + dx * t + (random() - 0.5) * 2 * spread,
    y: from.y + dy * t + (random() - 0.5) * 2 * spread,
  });
  const c1 = control(0.25 + random() * 0.15);
  const c2 = control(0.6 + random() * 0.15);
  const count = Math.max(2, Math.round(steps));
  const points: Point[] = [];
  for (let i = 1; i <= count; i++) {
    const linear = i / count;
    const t = linear < 0.5 ? 2 * linear * linear : 1 - Math.pow(-2 * linear + 2, 2) / 2;
    const k = 1 - t;
    points.push({
      x: k * k * k * from.x + 3 * k * k * t * c1.x + 3 * k * t * t * c2.x + t * t * t * to.x,
      y: k * k * k * from.y + 3 * k * k * t * c1.y + 3 * k * t * t * c2.y + t * t * t * to.y,
    });
  }
  points[points.length - 1] = { ...to };
  return points;
}

const pointers = new WeakMap<Page, Point>();

async function windowSize(page: Page): Promise<{ width: number; height: number }> {
  const fixed = page.viewportSize();
  if (fixed) return fixed;
  // viewport: null (the real window size) leaves viewportSize() empty.
  return page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
}

/** Move the pointer along a curved path instead of jumping straight to the target. */
export async function humanMove(page: Page, to: Point, random: Random = Math.random) {
  const from = pointers.get(page) ?? { x: 40 + random() * 200, y: 40 + random() * 120 };
  const steps = 12 + Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 40);
  for (const point of bezierPath(from, to, Math.min(steps, 40), random)) {
    await page.mouse.move(point.x, point.y);
  }
  pointers.set(page, to);
}

/**
 * After a page loads: drift the pointer into the content and wheel down a few screens with
 * uneven pauses, sometimes nudging back up. Also triggers lazy-loaded job cards.
 * Bounded to a few seconds; any failure is ignored because reading must not depend on it.
 */
export async function browseLikeHuman(page: Page, options: { random?: Random; sleep?: Sleep; scrolls?: number } = {}) {
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? realSleep;
  try {
    const { width, height } = await windowSize(page);
    if (!width || !height) return;
    await humanMove(page, { x: width * (0.3 + random() * 0.4), y: height * (0.35 + random() * 0.3) }, random);
    const scrolls = options.scrolls ?? 2 + Math.floor(random() * 3);
    for (let i = 0; i < scrolls; i++) {
      await sleep(logNormalMs({ medianMs: 650, minMs: 250, maxMs: 1_800 }, random));
      const down = Math.round(height * (0.45 + random() * 0.4));
      // Wheel in a few small ticks, the way a mouse wheel or trackpad reports it.
      const ticks = 3 + Math.floor(random() * 3);
      for (let t = 0; t < ticks; t++) {
        await page.mouse.wheel(0, Math.round(down / ticks));
        await sleep(30 + Math.round(random() * 60));
      }
      if (random() < 0.2) {
        await sleep(logNormalMs({ medianMs: 500, minMs: 200, maxMs: 1_200 }, random));
        await page.mouse.wheel(0, -Math.round(height * (0.1 + random() * 0.2)));
      }
    }
  } catch { /* Page closed or navigated away; reading carries on without it. */ }
}

/** Errors worth one more try: timeouts and dropped connections, never a page the site actually served. */
export function transientNavigationError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /TimeoutError|Timeout \d+ms exceeded|net::ERR_(?:TIMED_OUT|CONNECTION_(?:RESET|CLOSED|REFUSED|TIMED_OUT)|NETWORK_CHANGED|INTERNET_DISCONNECTED|EMPTY_RESPONSE|SOCKET_NOT_CONNECTED|NAME_NOT_RESOLVED|PROXY_CONNECTION_FAILED)/.test(text);
}

/** Retry with growing, jittered back-off (like retry-go). Only `retryable` errors are retried. */
export async function withRetry<T>(run: (attempt: number) => Promise<T>, options: {
  attempts?: number; baseDelayMs?: number; retryable?: (error: unknown) => boolean; sleep?: Sleep; random?: Random;
} = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 2);
  const base = options.baseDelayMs ?? 2_000;
  const retryable = options.retryable ?? transientNavigationError;
  const sleep = options.sleep ?? realSleep;
  const random = options.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try { return await run(attempt); }
    catch (error) {
      if (attempt >= attempts || !retryable(error)) throw error;
      await sleep(Math.round(base * 2 ** (attempt - 1) * (0.75 + random() * 0.5)));
    }
  }
}
