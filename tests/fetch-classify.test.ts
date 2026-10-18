import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  BOSS_RISK_MESSAGE,
  classifyFetch,
  JOB51_RISK_MESSAGE,
  riskShellMessage,
} from "../bot/lib/boards/fetch.js";

function read(name: string): string {
  return readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
}

test("recorded block pages classify without fetching", () => {
  const zhilian = classifyFetch({
    status: 200,
    finalUrl: "https://sou.zhaopin.com/?kw=%E5%89%8D%E7%AB%AF",
    body: read("blocked/zhilian-captcha.html"),
  });
  assert.equal(zhilian.blocked, true);
  if (zhilian.blocked) assert.equal(zhilian.reason, "captcha");

  const job51 = classifyFetch({
    status: 200,
    finalUrl: "https://jobs.51job.com/shanghai/",
    body: read("blocked/job51-waf.html"),
  });
  assert.equal(job51.blocked, true);
  if (job51.blocked) {
    assert.equal(job51.reason, "captcha");
    assert.equal(job51.message, JOB51_RISK_MESSAGE);
  }

  const shell = read("blocked/job51-shell.html");
  const shellGate = classifyFetch({
    status: 200,
    finalUrl: "https://we.51job.com/pc/search?keyword=frontend",
    body: shell,
  });
  assert.equal(shellGate.blocked, false);
  assert.deepEqual(riskShellMessage("job51", shell), {
    reason: "blocked",
    message: JOB51_RISK_MESSAGE,
  });

  const boss = classifyFetch({
    status: 200,
    finalUrl: "https://www.zhipin.com/web/passport/zp/security.html?callbackUrl=%2Fc101020100%2F",
    body: '<html><head><title>请稍候 - BOSS直聘</title></head><body><div class="page-security"></div></body></html>',
  });
  assert.equal(boss.blocked, true);
  if (boss.blocked) {
    assert.equal(boss.reason, "blocked");
    assert.equal(boss.message, BOSS_RISK_MESSAGE);
  }
});
