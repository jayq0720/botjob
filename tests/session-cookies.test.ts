import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { BrowserContext, Cookie } from "playwright";
import {
  hasSavedSession,
  jobSiteCookies,
  keepSessionCookies,
  restoreSessionCookies,
  saveSessionCookies,
  SESSION_KEEP_MS,
} from "../bot/lib/boards/session-cookies.js";

function cookie(partial: Partial<Cookie> & Pick<Cookie, "name" | "domain">): Cookie {
  return {
    value: "v",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    ...partial,
  };
}

function fakeContext(initial: Cookie[]) {
  const store = [...initial];
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const fakePage = () => {
    const pListeners = new Map<string, Array<(...args: unknown[]) => void>>();
    const frame = { url: () => "https://www.zhaopin.com/" };
    return {
      mainFrame: () => frame,
      on(event: string, fn: (...args: unknown[]) => void) {
        const list = pListeners.get(event) ?? [];
        list.push(fn);
        pListeners.set(event, list);
      },
      emit(event: string, ...args: unknown[]) {
        for (const fn of pListeners.get(event) ?? []) fn(...args);
      },
    };
  };
  const page = fakePage();
  const ctx = {
    cookies: async () => [...store],
    addCookies: async (items: Cookie[]) => { store.push(...items); },
    pages: () => [page],
    on(event: string, fn: (...args: unknown[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    },
    emit(event: string, ...args: unknown[]) {
      for (const fn of listeners.get(event) ?? []) fn(...args);
    },
    page,
  };
  return ctx as unknown as BrowserContext & { page: ReturnType<typeof fakePage>; emit(e: string, ...a: unknown[]): void };
}

test("jobSiteCookies keeps only job board domains including session cookies", () => {
  const all = [
    cookie({ name: "at", domain: ".zhaopin.com", expires: -1 }),
    cookie({ name: "lt", domain: "www.liepin.com", expires: 2_000_000_000 }),
    cookie({ name: "51", domain: ".51job.com", expires: -1 }),
    cookie({ name: "other", domain: ".google.com", expires: -1 }),
    cookie({ name: "lookalike", domain: "evil-zhaopin.com", expires: -1 }),
  ];
  assert.deepEqual(jobSiteCookies(all).map(c => c.name), ["at", "lt", "51"]);
});

test("saveSessionCookies and restoreSessionCookies preserve session cookies without overwriting live ones", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "botjob-cookies-"));
  const file = path.join(dir, "job-site-cookies.json");
  const now = 1_750_000_000_000;
  try {
    const first = fakeContext([
      cookie({ name: "sess", value: "from-old", domain: ".zhaopin.com", expires: -1 }),
      cookie({ name: "live", value: "old-val", domain: ".liepin.com", expires: Math.floor((now + 3600_000) / 1000) }),
      cookie({ name: "expired", value: "gone", domain: ".51job.com", expires: Math.floor((now - 1000) / 1000) }),
      cookie({ name: "ignore", value: "x", domain: ".example.com", expires: -1 }),
    ]);
    assert.equal(await hasSavedSession(file, now), false);
    const savedCount = await saveSessionCookies(first, file, now);
    assert.equal(savedCount, 3);
    assert.equal(await hasSavedSession(file, now), true);

    const second = fakeContext([
      cookie({ name: "live", value: "fresh-val", domain: ".liepin.com", expires: Math.floor((now + 7200_000) / 1000) }),
    ]);
    const restored = await restoreSessionCookies(second, file, now);
    assert.equal(restored, 1);
    const after = await second.cookies();
    assert.equal(after.find(c => c.name === "sess")?.value, "from-old");
    assert.equal(after.find(c => c.name === "live")?.value, "fresh-val");
    assert.equal(after.find(c => c.name === "expired"), undefined);

    assert.equal(await hasSavedSession(file, now + SESSION_KEEP_MS + 1), false);
    assert.equal(await restoreSessionCookies(fakeContext([]), file, now + SESSION_KEEP_MS + 1), 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keepSessionCookies saves on load/response and stops cleanly on close", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "botjob-keep-"));
  const file = path.join(dir, "job-site-cookies.json");
  try {
    const ctx = fakeContext([cookie({ name: "zp", domain: ".zhaopin.com", value: "ok", expires: -1 })]);
    const keeper = keepSessionCookies(ctx, file, 60_000);
    await keeper.save();
    assert.equal(await hasSavedSession(file), true);
    ctx.emit("close");
    keeper.stop();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
