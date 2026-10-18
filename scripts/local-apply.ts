#!/usr/bin/env npx tsx
/**
 * Local semi-automatic job apply runner.
 *
 * Opens each URL in a persistent Chromium profile. You confirm every action.
 * Never bypasses CAPTCHA / never submits without a keypress.
 *
 *   npm run apply:local -- --pack apply-packs/pack-….json
 *   npm run apply:local -- --pack fixtures/sample-apply-pack.json --dry-run
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { homedir } from "node:os";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import {
  assertApplyTarget,
  boardApplyHints,
  parseApplyPack,
  type ApplyPackItem,
  type ApplyRunReport,
  type ApplyRunResult,
} from "../bot/lib/apply-pack.js";

type Args = {
  pack: string;
  dryRun: boolean;
  headed: boolean;
  profile: string;
  limit?: number;
};

function parseArgs(argv: string[]): Args {
  const out: Args = {
    pack: "",
    dryRun: false,
    headed: true,
    profile: path.join(homedir(), ".botjob", "browser-profile"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--pack") out.pack = argv[++i] ?? "";
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--headless") out.headed = false;
    else if (a === "--profile") out.profile = argv[++i] ?? out.profile;
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  if (!out.pack) {
    printHelp();
    process.exit(1);
  }
  return out;
}

function printHelp() {
  console.log(`botjob local apply (semi-automatic)

Usage:
  npm run apply:local -- --pack <apply-pack.json> [--dry-run] [--profile DIR] [--limit N]

Keys per job (headed mode):
  a  mark applied (you already clicked apply / send in the browser)
  c  try to click 申请 or 立即沟通 (asks again; BOSS may send the site's default greeting)
  f  fill the greeting into a visible input (asks again; does not press send)
  p  copy the greeting to the clipboard
  l  copy the cover letter to the clipboard
  s  skip
  q  quit remaining
`);
}

async function prompt(rl: ReturnType<typeof createInterface>, q: string) {
  const ans = (await rl.question(q)).trim().toLowerCase();
  return ans;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const packAbs = path.resolve(args.pack);
  const pack = parseApplyPack(await readFile(packAbs, "utf8"));
  if (pack.version !== 1 || !Array.isArray(pack.items)) {
    throw new Error("Invalid apply pack: expected version 1 with items[]");
  }
  const items = pack.items.slice(0, args.limit ?? pack.items.length);
  console.log(
    `Loaded pack session=${pack.sessionId} items=${items.length}/${pack.items.length}`,
  );

  if (args.dryRun) {
    for (const [i, item] of items.entries()) {
      console.log(
        `[dry-run ${i + 1}/${items.length}] ${item.board} | ${item.company} | ${item.title}`,
      );
      console.log(`  url: ${item.url}`);
      if (item.matchScore !== undefined) console.log(`  score: ${item.matchScore}`);
      printCopy(item);
    }
    console.log("Dry run complete — no browser launched.");
    return;
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error(
      "playwright is not installed. Run: npm install && npx playwright install chromium",
    );
    process.exit(1);
  }

  await mkdir(args.profile, { recursive: true });
  const context = await chromium.launchPersistentContext(args.profile, {
    headless: !args.headed,
    viewport: { width: 1280, height: 900 },
    locale: "zh-CN",
  });
  const page = context.pages()[0] ?? (await context.newPage());
  const rl = createInterface({ input, output });
  const results: ApplyRunResult[] = [];

  console.log(
    `\nBrowser profile: ${args.profile}\n首次使用请在打开的窗口中登录智联/猎聘/51job/BOSS直聘，登录态会保留。\n只打开智联、猎聘、51job、BOSS 的 https 链接。\nBOSS 点「立即沟通」可能会立即发送平台默认招呼语，点击前会再确认。填入打招呼语不会按发送键。\n`,
  );

  let quit = false;
  try {
    for (const [i, item] of items.entries()) {
      if (quit) {
        results.push({
          id: item.id,
          outcome: "skipped",
          note: "quit",
          at: new Date().toISOString(),
        });
        continue;
      }

      const hint = boardApplyHints[item.board] ?? {
        label: item.board,
        selectors: [] as string[],
      };
      console.log(
        `\n==== ${i + 1}/${items.length} ${hint.label} ====\n${item.company} · ${item.title}\n${item.url}`,
      );
      printCopy(item);

      try {
        assertApplyTarget(item, "goto");
        await page.goto(item.url, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
      } catch (err) {
        const note = err instanceof Error ? err.message : String(err);
        console.log(`导航失败: ${note}`);
        results.push({
          id: item.id,
          outcome: "failed",
          note,
          at: new Date().toISOString(),
        });
        continue;
      }

      let done = false;
      while (!done) {
        const key = await prompt(
          rl,
          "选择: [a]已投递  [c]尝试点击  [f]填入打招呼语  [p]复制打招呼语  [l]复制求职信  [s]跳过  [q]退出 > ",
        );
        if (key === "a" || key === "applied") {
          results.push({
            id: item.id,
            outcome: "applied",
            note: "user confirmed in local runner",
            at: new Date().toISOString(),
          });
          done = true;
        } else if (key === "s" || key === "skip") {
          results.push({
            id: item.id,
            outcome: "skipped",
            at: new Date().toISOString(),
          });
          done = true;
        } else if (key === "q" || key === "quit") {
          results.push({
            id: item.id,
            outcome: "skipped",
            note: "quit",
            at: new Date().toISOString(),
          });
          done = true;
          quit = true;
        } else if (key === "c" || key === "click") {
          let clicked = false;
          for (const sel of hint.selectors) {
            const loc = page.locator(sel).first();
            if ((await loc.count()) === 0) continue;
            const visible = await loc.isVisible().catch(() => false);
            if (!visible) continue;
            const bossNotice =
              item.board === "boss" ? "可能会立即发送平台默认招呼语。" : "";
            const confirm = await prompt(
              rl,
              `检测到「${sel}」。${bossNotice}确认点击？[y/N] > `,
            );
            if (confirm === "y" || confirm === "yes") {
              await loc.click({ timeout: 5000 }).catch((e: unknown) => {
                console.log(`点击失败: ${e}`);
              });
              clicked = true;
              console.log(
                "已尝试点击。请在页面确认是否投递成功，然后按 a 或 s。",
              );
              break;
            }
          }
          if (!clicked) {
            console.log("未找到可点的申请/沟通按钮，请在浏览器中手动操作后按 a/s。");
          }
        } else if (key === "p" || key === "l") {
          const text = key === "p" ? item.greeting ?? item.coverNote : item.coverLetter;
          if (!text) {
            console.log(key === "p" ? "这个岗位没有打招呼语。" : "这个岗位没有求职信。");
          } else {
            const copied = copyToClipboard(text);
            console.log(copied ? "已复制到剪贴板。脚本没有发送。" : "当前环境没有剪贴板工具，请从上面的文本手动复制。");
          }
        } else if (key === "f" || key === "fill") {
          const text = item.greeting ?? item.coverNote;
          if (!text) {
            console.log("这个岗位没有打招呼语。");
            continue;
          }
          try {
            assertApplyTarget(item, "fill");
          } catch (err) {
            console.log(err instanceof Error ? err.message : String(err));
            continue;
          }
          const confirm = await prompt(
            rl,
            "把打招呼语填进可见输入框？不会按发送键。[y/N] > ",
          );
          if (confirm !== "y" && confirm !== "yes") continue;
          const filled = await fillGreeting(page, text);
          console.log(
            filled
              ? `已填入（${filled}）。请你在页面上确认后再发送，然后按 a 或 s。`
              : "没找到可见的输入框。可按 p 复制后手动粘贴。",
          );
        } else {
          console.log("无效输入，请重试。");
        }
      }
    }
  } finally {
    rl.close();
    await context.close();
  }

  const report: ApplyRunReport = {
    version: 1,
    packExportedAt: pack.exportedAt,
    finishedAt: new Date().toISOString(),
    results,
  };
  const outPath = packAbs.replace(/\.json$/i, "") + ".results.json";
  await writeFile(outPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nWrote results → ${outPath}`);
  console.log(
    "把该文件内容交给 botjob，或调用 mark_applied 回写会话状态。",
  );
}

function printCopy(item: ApplyPackItem) {
  if (item.greeting) {
    console.log("  打招呼语:");
    console.log(item.greeting);
  } else if (item.coverNote) {
    console.log(`  附言: ${item.coverNote}`);
  }
  if (item.coverLetter) {
    console.log("  求职信:");
    console.log(item.coverLetter);
  }
}

function copyToClipboard(text: string): boolean {
  const commands: Array<{ cmd: string; args: string[] }> = [
    { cmd: "xclip", args: ["-selection", "clipboard"] },
    { cmd: "wl-copy", args: [] },
    { cmd: "pbcopy", args: [] },
  ];
  for (const { cmd, args } of commands) {
    const result = spawnSync(cmd, args, { input: text, encoding: "utf8" });
    if (result.status === 0) return true;
  }
  return false;
}

async function fillGreeting(
  page: { locator: (sel: string) => { last: () => { count: () => Promise<number>; isVisible: () => Promise<boolean>; fill: (text: string) => Promise<void> } } },
  text: string,
): Promise<string> {
  for (const sel of ["textarea", "[contenteditable='true']"]) {
    const loc = page.locator(sel).last();
    if ((await loc.count()) === 0) continue;
    const visible = await loc.isVisible().catch(() => false);
    if (!visible) continue;
    try {
      await loc.fill(text);
      return sel;
    } catch (err) {
      console.log(`填入失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return "";
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
