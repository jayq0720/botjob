import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fetchText } from "../bot/lib/boards/fetch.js";

const START = "https://www.zhaopin.com/jobdetail/start.htm";

describe("fetchText allowlist and body cap", { concurrency: 1 }, () => {
  test("follows several allowlisted redirects", async () => {
    const urls = [
      START,
      "https://sou.zhaopin.com/sou/1",
      "https://jobs.zhaopin.com/2",
      "https://fe-api.zhaopin.com/3",
      "https://www.zhaopin.com/4",
      "https://www.zhaopin.com/jobdetail/final.htm",
    ];
    const seen: string[] = [];
    await withFetch(async (input, init) => {
      assert.equal(init?.redirect, "manual");
      const url = String(input);
      seen.push(url);
      const index = urls.indexOf(url);
      assert.notEqual(index, -1);
      if (index < urls.length - 1) {
        return new Response(null, { status: 302, headers: { location: urls[index + 1]! } });
      }
      return new Response("<html>allowlisted-final</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }, async () => {
      const result = await fetchText(START);
      assert.ok(!("error" in result));
      if ("error" in result) return;
      assert.equal(result.finalUrl, urls.at(-1));
      assert.match(result.body, /allowlisted-final/);
      assert.deepEqual(seen, urls);
    });
  });

  test("rejects a redirect that leaves the allowlist", async () => {
    const seen: string[] = [];
    await withFetch(async (input, init) => {
      assert.equal(init?.redirect, "manual");
      const url = String(input);
      seen.push(url);
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/phish" },
      });
    }, async () => {
      const result = await fetchText(START);
      assert.ok("error" in result);
      if (!("error" in result)) return;
      assert.match(result.error, /离开了招聘站/);
      assert.match(result.error, /evil\.example/);
      assert.deepEqual(seen, [START]);
    });
  });

  test("rejects a sixth redirect", async () => {
    const seen: string[] = [];
    await withFetch(async (input, init) => {
      assert.equal(init?.redirect, "manual");
      const url = String(input);
      seen.push(url);
      const hop = seen.length;
      return new Response(null, {
        status: 302,
        headers: { location: `https://www.zhaopin.com/hop/${hop}` },
      });
    }, async () => {
      const result = await fetchText(START);
      assert.ok("error" in result);
      if (!("error" in result)) return;
      assert.match(result.error, /超过 5 跳/);
      assert.equal(seen.length, 6);
      assert.equal(seen[0], START);
      assert.equal(seen[5], "https://www.zhaopin.com/hop/5");
    });
  });

  test("stops a chunked body just past 2MB when Content-Length is absent", async () => {
    const chunk = 64 * 1024;
    const total = 5_000_000;
    let pulled = 0;
    let cancelled = false;
    await withFetch(async (_input, init) => {
      assert.equal(init?.redirect, "manual");
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled >= total) {
            controller.close();
            return;
          }
          const size = Math.min(chunk, total - pulled);
          pulled += size;
          controller.enqueue(new Uint8Array(size));
        },
        cancel() {
          cancelled = true;
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/html" } });
    }, async () => {
      const result = await fetchText(START);
      assert.ok("error" in result);
      if (!("error" in result)) return;
      assert.match(result.error, /2MB/);
      assert.equal(cancelled, true);
      assert.ok(pulled > 2_000_000, `pulled ${pulled}`);
      assert.ok(pulled < 2_000_000 + chunk * 2, `pulled ${pulled}`);
    });
  });

  test("rejects Content-Length over 2MB before reading the body", async () => {
    let read = false;
    await withFetch(async (_input, init) => {
      assert.equal(init?.redirect, "manual");
      return {
        status: 200,
        headers: new Headers({
          "content-type": "text/html",
          "content-length": String(3_000_000),
        }),
        body: {
          getReader() {
            read = true;
            throw new Error("body was read");
          },
          cancel() {
            return Promise.resolve();
          },
        },
      } as unknown as Response;
    }, async () => {
      const result = await fetchText(START);
      assert.ok("error" in result);
      if (!("error" in result)) return;
      assert.match(result.error, /Content-Length/);
      assert.equal(read, false);
    });

    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(32));
      },
    });
    const response = new Response(stream, {
      status: 200,
      headers: { "content-type": "text/html", "content-length": String(3_000_000) },
    });
    await Promise.resolve();
    const baseline = pulls;
    await withFetch(async () => response, async () => {
      const result = await fetchText(START);
      assert.ok("error" in result);
      if (!("error" in result)) return;
      assert.match(result.error, /Content-Length/);
      assert.equal(pulls, baseline);
    });
  });
});

async function withFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
}
