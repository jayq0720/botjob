import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyBrowser, commandExecutable, resolveLoginBrowser } from "../bot/lib/boards/system-browser.js";

const reg = (progId: string, command: string) => async (_: string, args: string[]) =>
  args.includes("ProgId") ? `    ProgId    REG_SZ    ${progId}\r\n` : `    (Default)    REG_SZ    ${command}\r\n`;

test("command lines resolve to the browser executable", () => {
  assert.equal(commandExecutable('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --single-argument %1'), "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  assert.equal(commandExecutable("/usr/bin/google-chrome-stable %U"), "/usr/bin/google-chrome-stable");
  assert.equal(classifyBrowser("MSEdgeHTM", "C:/msedge.exe").name, "Microsoft Edge");
  assert.equal(classifyBrowser("FirefoxURL-308046B0AF4A39CB", "C:/firefox.exe").drivable, false);
});

test("Windows default Chrome is launched from its registered executable", async () => {
  const exe = process.execPath; // any existing file stands in for chrome.exe
  const result = await resolveLoginBrowser({ platform: "win32", env: {}, exec: reg("ChromeHTML", `"${exe}" --single-argument %1`) });
  assert.equal(result.browser?.name, "Google Chrome");
  assert.equal(result.browser?.executablePath, exe);
  assert.equal(result.note, undefined);
});

test("a Firefox default falls back to Edge on Windows and says why", async () => {
  const result = await resolveLoginBrowser({ platform: "win32", env: {}, exec: reg("FirefoxURL-308046B0AF4A39CB", `"${process.execPath}" -osint -url "%1"`) });
  assert.equal(result.browser?.channel, "msedge");
  assert.match(result.note ?? "", /Firefox.*Microsoft Edge/);
});

test("BOTJOB_BROWSER overrides detection", async () => {
  const exec = async () => { throw new Error("not called"); };
  assert.equal((await resolveLoginBrowser({ env: { BOTJOB_BROWSER: "bundled" }, exec })).browser, undefined);
  assert.equal((await resolveLoginBrowser({ env: { BOTJOB_BROWSER: "msedge" }, exec })).browser?.channel, "msedge");
});
