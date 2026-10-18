import assert from "node:assert/strict";
import { createInterface } from "node:readline/promises";
import { Readable, Writable } from "node:stream";
import { test } from "node:test";
import {
  armReadline,
  askOrQuit,
  planAfterClosedStdin,
  safeCloseReadline,
} from "../scripts/local-apply.js";

function closedInterface() {
  const rl = createInterface({
    input: Readable.from([]),
    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
  rl.close();
  return rl;
}

test("closed stdin is a quit, not ERR_USE_AFTER_CLOSE", async () => {
  const rl = closedInterface();
  assert.equal(await askOrQuit(rl, "选择 > "), null);
  assert.doesNotThrow(() => safeCloseReadline(rl));
});

test("a piped q is kept when stdin ends before the prompt", async () => {
  const rl = createInterface({
    input: Readable.from(["q\n"]),
    output: new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
  });
  const keys = armReadline(rl);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(await askOrQuit(rl, "选择 > ", keys), "q");
  assert.equal(await askOrQuit(rl, "选择 > ", keys), null);
  safeCloseReadline(rl);
});

test("stdin close marks the current job and the rest skipped", () => {
  const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const planned = planAfterClosedStdin(items, [], 0, "2026-01-01T00:00:00.000Z");
  assert.equal(planned.length, 3);
  assert.ok(planned.every((row) => row.outcome === "skipped" && row.note === "stdin closed"));
  const afterOne = planAfterClosedStdin(
    items,
    [{ id: "a", outcome: "applied", at: "2026-01-01T00:00:00.000Z" }],
    1,
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(afterOne[0]?.outcome, "applied");
  assert.deepEqual(
    afterOne.slice(1).map((row) => row.id),
    ["b", "c"],
  );
});
