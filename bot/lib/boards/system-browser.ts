import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type SystemBrowser = { name: string; executablePath?: string; channel?: "chrome" | "msedge"; drivable: boolean };
type Run = (file: string, args: string[]) => Promise<string>;

const run: Run = (file, args) => new Promise((resolve, reject) =>
  execFile(file, args, { timeout: 5_000, windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(String(stdout))));

/** Chromium-family browsers accept Playwright's CDP launch; Firefox/Safari builds from the vendor do not. */
const KNOWN: [RegExp, string, boolean][] = [
  [/msedge|microsoft edge|com\.microsoft\.edge/i, "Microsoft Edge", true],
  [/chrome|google-chrome|com\.google\.chrome/i, "Google Chrome", true],
  [/brave/i, "Brave", true],
  [/vivaldi/i, "Vivaldi", true],
  [/opera/i, "Opera", true],
  [/chromium/i, "Chromium", true],
  [/360(?:se|chrome)|360浏览器/i, "360 浏览器", true],
  [/qqbrowser/i, "QQ 浏览器", true],
  [/sogou/i, "搜狗浏览器", true],
  [/firefox|mozilla/i, "Firefox", false],
  [/safari/i, "Safari", false],
];

export function classifyBrowser(id: string, executablePath?: string): SystemBrowser {
  const hit = KNOWN.find(([pattern]) => pattern.test(id) || (executablePath ? pattern.test(path.basename(executablePath)) : false));
  return { name: hit?.[1] ?? (id || "未知浏览器"), executablePath, drivable: !!hit?.[2] && !!executablePath };
}

/** First token of a shell/desktop command line, quoted or not. */
export function commandExecutable(command: string): string | undefined {
  const trimmed = command.trim();
  const quoted = trimmed.match(/^"([^"]+)"/)?.[1];
  if (quoted) return quoted;
  return (trimmed.match(/^(.+?\.exe)\b/i)?.[1] ?? trimmed.split(/\s+/)[0]) || undefined;
}

async function windows(exec: Run): Promise<SystemBrowser | undefined> {
  const choice = await exec("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice", "/v", "ProgId"]);
  const progId = choice.match(/ProgId\s+REG_SZ\s+(\S+)/i)?.[1];
  if (!progId) return undefined;
  const command = await exec("reg", ["query", `HKCR\\${progId}\\shell\\open\\command`, "/ve"]).catch(() => "");
  const line = command.match(/REG_(?:EXPAND_)?SZ\s+(.+)/i)?.[1];
  const executable = line ? commandExecutable(line.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`)) : undefined;
  return classifyBrowser(progId, executable && existsSync(executable) ? executable : undefined);
}

async function mac(exec: Run): Promise<SystemBrowser | undefined> {
  const handlers = await exec("defaults", ["read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"]).catch(() => "");
  const block = handlers.split(/\}\s*,?/).find(item => /LSHandlerURLScheme\s*=\s*https;/.test(item));
  const bundleId = block?.match(/LSHandlerRoleAll\s*=\s*"?([\w.-]+)"?;/)?.[1] ?? "com.apple.safari";
  const app = (await exec("mdfind", [`kMDItemCFBundleIdentifier == '${bundleId}'`]).catch(() => "")).split("\n").find(line => line.endsWith(".app"));
  if (!app) return classifyBrowser(bundleId);
  const binary = (await exec("defaults", ["read", path.join(app, "Contents", "Info"), "CFBundleExecutable"]).catch(() => "")).trim();
  const executable = binary ? path.join(app, "Contents", "MacOS", binary) : undefined;
  return classifyBrowser(bundleId, executable && existsSync(executable) ? executable : undefined);
}

async function linux(exec: Run): Promise<SystemBrowser | undefined> {
  const desktop = (await exec("xdg-settings", ["get", "default-web-browser"]).catch(() => "")).trim();
  if (!desktop) return undefined;
  const dirs = [path.join(os.homedir(), ".local/share/applications"), "/usr/share/applications", "/usr/local/share/applications", "/var/lib/snapd/desktop/applications"];
  const file = dirs.map(dir => path.join(dir, desktop)).find(existsSync);
  const exec_ = file ? readFileSync(file, "utf8").match(/^Exec=(.+)$/m)?.[1] : undefined;
  let executable = exec_ ? commandExecutable(exec_) : undefined;
  if (executable && !path.isAbsolute(executable)) executable = (await exec("which", [executable]).catch(() => "")).trim() || undefined;
  return classifyBrowser(desktop, executable && existsSync(executable) ? executable : undefined);
}

/**
 * The system default browser, falling back to an installed Chrome/Edge when the default
 * cannot be automated (Firefox/Safari). Returns undefined to use Playwright's bundled Chromium.
 */
export async function resolveLoginBrowser(options: { platform?: NodeJS.Platform; exec?: Run; env?: NodeJS.ProcessEnv } = {}):
  Promise<{ browser?: SystemBrowser; defaultName?: string; note?: string }> {
  const platform = options.platform ?? process.platform;
  const exec = options.exec ?? run;
  const override = (options.env ?? process.env).BOTJOB_BROWSER?.trim();
  if (override === "bundled") return {};
  if (override === "chrome" || override === "msedge") return { browser: { name: override === "chrome" ? "Google Chrome" : "Microsoft Edge", channel: override, drivable: true } };
  if (override) return { browser: { ...classifyBrowser(override, override), drivable: true } };
  const detected = await (platform === "win32" ? windows(exec) : platform === "darwin" ? mac(exec) : linux(exec)).catch(() => undefined);
  if (detected?.drivable) return { browser: detected, defaultName: detected.name };
  // Edge ships with Windows, so it is the usual fallback when the default is Firefox.
  const fallback: SystemBrowser = platform === "win32"
    ? { name: "Microsoft Edge", channel: "msedge", drivable: true }
    : { name: "Google Chrome", channel: "chrome", drivable: true };
  return { browser: fallback, defaultName: detected?.name,
    note: detected ? `系统默认浏览器是 ${detected.name}，它不支持自动读取岗位，已改用 ${fallback.name}。` : undefined };
}
