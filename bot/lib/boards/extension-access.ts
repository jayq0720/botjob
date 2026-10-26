import path from "node:path";
import { fileURLToPath } from "node:url";
import { extensionBridge, openDefaultBrowser } from "./extension-bridge.js";
import { jobUrlAllowed, canonicalJobUrl } from "../jd.js";
import { postingsFromDom, type RenderDiagnostics } from "./rendered.js";
import type { captureJobDom } from "./page-dom.js";
import { classifyFetch, mergeRendered, type Fetched, type PageReader } from "./fetch.js";
import { parseDetailHtml } from "./parse.js";
import type { BoardId } from "./types.js";
import type { DeliveryDriver } from "../actions/delivery.js";
import { excludedEmployer, employerReview } from "./employers.js";
import { freshness } from "./freshness.js";

type Snapshot = { body: string; finalUrl: string; raw: ReturnType<typeof captureJobDom>; state: RenderDiagnostics["state"]; elapsedMs: number };
const homes = { zhilian: "https://www.zhaopin.com/", liepin: "https://www.liepin.com/" };

function fetched(snapshot: Snapshot, board: BoardId): Fetched {
  if (!jobUrlAllowed(snapshot.finalUrl, board) || Buffer.byteLength(snapshot.body) > 2_000_000) throw new Error("浏览器页面离开当前招聘站或超过读取上限。");
  const jobs = postingsFromDom(snapshot.raw, board, Date.now());
  const detail = /\/(?:job|jobdetail)\//.test(new URL(snapshot.finalUrl).pathname);
  return { status: 200, finalUrl: snapshot.finalUrl, body: snapshot.body, contentType: "text/html", rendered: { jobs,
    diagnostics: { mode: "browser", state: snapshot.state, pageKind: detail ? "detail" : "search", elapsedMs: snapshot.elapsedMs,
      cardCount: detail ? 0 : snapshot.raw.cardCount, parsedCount: jobs.length } } };
}

export function createExtensionAccess(getBridge = extensionBridge, opener = openDefaultBrowser) {
  const access = {
    async open(board: BoardId, url = homes[board]) {
      if (!jobUrlAllowed(url, board)) throw new Error("登录链接必须属于所选招聘站。");
      const bridge = await getBridge();
      if (!bridge.connected()) {
        await opener(bridge.pairingUrl);
        return { ok: true as const, board, status: "awaiting_browser_connection" as const, url,
          extensionDirectory: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../extension"),
          message: "已在系统默认浏览器打开本机连接页。首次请在 Chrome/Edge 扩展管理中加载返回的 extensionDirectory 文件夹，再回到连接页点击 botjob 扩展的‘连接当前 botjob’。完成后再次调用 open_job_login。连接后复用此浏览器已有登录态；不会读取或返回 Cookie。" };
      }
      await bridge.command({ type: "open", board, url });
      return { ok: true as const, board, status: "awaiting_login" as const, url,
        message: "已在已连接的日常浏览器打开招聘站，复用该浏览器当前登录态。若已登录，确认账号和网站简历即可继续；如需登录，请在此页面自行完成。两站账号分别核对，不要发送密码、验证码或 Cookie。" };
    },
    reader(board: BoardId): PageReader {
      return async url => {
        if (!jobUrlAllowed(url, board)) return { error: "只读取当前招聘站。" };
        try {
          const bridge = await getBridge();
          if (!bridge.connected()) return { error: "浏览器扩展尚未连接，请调用 open_job_login 完成本机配对；这不代表招聘网站账号未登录。", reason: "browser_connection_required" as const };
          return fetched(await bridge.command<Snapshot>({ type: "read", board, url }), board);
        } catch (error) { return { error: error instanceof Error ? error.message : "浏览器读取失败" }; }
      };
    },
  };

  const deliver: DeliveryDriver = async (app, beforeClick) => {
    const bridge = await getBridge();
    if (!bridge.connected()) return { outcome: "paused", message: "请先调用 open_job_login 连接日常浏览器，再预览并确认投递。" };
    const snapshot = await bridge.command<Snapshot & { token: string; inspection: { reason: string; alreadySubmitted: boolean; evidence?: string } }>({ type: "prepare_apply", board: app.job.board, url: app.job.url });
    const page = fetched(snapshot, app.job.board);
    const gate = classifyFetch(page);
    if (gate.blocked) return { outcome: "paused", message: gate.message };
    if (canonicalJobUrl(page.finalUrl) !== canonicalJobUrl(app.job.url)) return { outcome: "paused", message: "页面跳转到其他岗位，未点击。" };
    const parsed = parseDetailHtml(app.job.board, page.body, page.finalUrl);
    const current = mergeRendered(parsed ? [parsed] : [], page.rendered?.jobs).find(job => canonicalJobUrl(job.url) === canonicalJobUrl(app.job.url));
    const compact = (text: string) => text.replace(/\s/g, "");
    if (!current || compact(current.title) !== compact(app.job.title) || compact(current.company) !== compact(app.job.company)) return { outcome: "paused", message: "岗位或公司与确认内容不一致，未点击。" };
    const evidence = { ...current, companyIndustry: current.companyIndustry || app.job.companyIndustry };
    if (excludedEmployer(evidence) || employerReview(evidence) === "needs_review" || freshness(current) !== "recent") return { outcome: "paused", message: "公司或最近72小时条件未通过核验，未点击。" };
    if (snapshot.inspection.alreadySubmitted && snapshot.inspection.evidence) return { outcome: "already_submitted", message: "页面显示已投递，未重复点击。", evidence: snapshot.inspection.evidence };
    if (snapshot.inspection.reason) return { outcome: "paused", message: snapshot.inspection.reason + "，请在该标签页处理。" };
    await beforeClick();
    return bridge.command({ type: "click_apply", board: app.job.board, token: snapshot.token });
  };

  return { ...access, deliver };
}

export const extensionAccess = createExtensionAccess();
export const extensionDelivery = extensionAccess.deliver;
