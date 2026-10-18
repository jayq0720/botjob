import assert from "node:assert/strict";
import { test } from "node:test";
import { isToolEffect } from "@cursor/bdk";
import scoreJob from "../bot/tools/score_job.js";
import searchJobs from "../bot/tools/search_jobs.js";

test("BDK effect stays read because the package has no network effect", () => {
  assert.equal(isToolEffect("read"), true);
  assert.equal(isToolEffect("write"), true);
  assert.equal(isToolEffect("network"), false);
  assert.equal(searchJobs.effect, "read");
  assert.equal(scoreJob.effect, "read");
});
