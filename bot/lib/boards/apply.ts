import type { Page } from "playwright";
import type { ApplicationRecord } from "../store.js";
import type { DeliveryDriver, DeliveryResult } from "../actions/delivery.js";
import { canonicalJobUrl, jobUrlAllowed } from "../jd.js";
import { browserAccess } from "./browser.js";
import { classifyFetch } from "./fetch.js";
import { parseDetailHtml } from "./parse.js";
import { excludedEmployer, employerReview } from "./employers.js";
import { freshness } from "./freshness.js";

const APPLY = /^\s*(立即申请|申请职位|投递简历|立即投递)\s*$/;
const DONE = /^\s*(投递成功|申请成功|已投递|已申请)\s*[！!。]?\s*$/;
const paused = (message: string): DeliveryResult => ({ outcome: "paused", message });
const compact = (value: string) => value.replace(/\s/g, "");

/** One irreversible click at most. Follow-up forms/chat require the user. */
export async function deliverOnPage(page: Page, app: ApplicationRecord, beforeClick: () => Promise<void>, waitMs = 8_000): Promise<DeliveryResult> {
  const job = app.job;
  if (!jobUrlAllowed(job.url, job.board)) return paused("岗位链接不合法。");
  const response = await page.goto(job.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.bringToFront();
  await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);
  const html = await page.content();
  const gate = classifyFetch({ body: html, finalUrl: page.url(), status: response?.status() ?? 200 });
  if (gate.blocked) return paused(`${gate.message} 请在浏览器中完成操作后继续。`);
  if (!jobUrlAllowed(page.url(), job.board) || canonicalJobUrl(page.url()) !== canonicalJobUrl(job.url)) return paused("页面跳转到其他岗位或站点，未点击。");
  const current = parseDetailHtml(job.board, html, page.url());
  if (!current || compact(current.title) !== compact(job.title) || compact(current.company) !== compact(job.company)) return paused("页面职位或公司与确认内容不一致，未点击。请重新搜索核实。");
  const evidence = { ...current, companyIndustry: current.companyIndustry || job.companyIndustry };
  if (excludedEmployer(evidence) || employerReview(evidence) === "needs_review" || freshness(current) !== "recent") return paused("当前岗位的公司或最近72小时条件未通过核验，未点击。");
  const header = page.locator(job.board === "liepin" ? ".job-apply-container" : ".summary-planes, .summary-plane");
  if (await header.count() !== 1) return paused("无法确认当前岗位的操作区域，未点击，请手动处理。");
  const scope = header;
  const buttons = scope.locator('button:visible, a:visible, [role="button"]:visible');
  const doneButton = buttons.filter({ hasText: DONE });
  if (await doneButton.count() === 1) return { outcome: "already_submitted", message: "该岗位页面显示已投递，未重复点击。", evidence: (await doneButton.innerText()).trim() };
  const dialogs = page.locator('[role="dialog"]:visible, .ant-modal:visible, .el-dialog:visible');
  if (await dialogs.count()) return paused("页面有待处理的弹窗，请先确认简历、登录或补填信息。");
  const required = page.locator('input:required:invalid:visible, textarea:required:invalid:visible, select:required:invalid:visible');
  if (await required.count()) return paused("页面有必填信息，需你填写后继续。");
  const alerts = page.locator('[role="alert"]:visible, .ant-message-notice-content:visible, .el-message:visible').filter({ hasText: DONE });
  if (await alerts.count()) return paused("页面存在未关联的成功提示，请先核对当前岗位的投递状态。");
  const button = buttons.filter({ hasText: APPLY });
  if (await button.count() !== 1 || !await button.isEnabled()) return paused("没有唯一可用的申请按钮。该岗位可能只支持聊一聊或需要手动操作，未点击。");
  // Trial validates actionability without sending anything. Then journal intent BEFORE the click.
  await button.click({ trial: true, timeout: 3_000 });
  if (canonicalJobUrl(page.url()) !== canonicalJobUrl(job.url)) return paused("页面在准备过程中跳转，未点击。");
  await beforeClick();
  await button.click({ timeout: 5_000 });
  const success = scope.locator('button:visible, a:visible, [role="button"]:visible').filter({ hasText: DONE })
    .or(page.locator('[role="alert"]:visible, .ant-message-notice-content:visible, .el-message:visible').filter({ hasText: DONE }));
  await success.first().waitFor({ state: "visible", timeout: waitMs }).catch(() => undefined);
  if (jobUrlAllowed(page.url(), job.board) && canonicalJobUrl(page.url()) === canonicalJobUrl(job.url) && await success.count()) {
    return { outcome: "submitted", message: "网站显示投递成功。", evidence: (await success.first().innerText()).trim() };
  }
  return { outcome: "unknown", message: "已点击一次，但网站未显示明确成功。可能要求登录、选择简历或补填信息；请在此窗口核对，完成后回写结果，不自动重试。" };
}

export const browserDelivery: DeliveryDriver = async (app, beforeClick) => {
  const page = await browserAccess.applicationPage(app.job.board);
  if (!page) {
    try { await browserAccess.open(app.job.board, app.job.url); }
    catch (error) { return paused(error instanceof Error ? error.message : "登录浏览器不可用。"); }
    return paused("已打开登录窗口。请登录自己的账号并核对网站简历，确认完成后重新启动未投递的申请。");
  }
  const result = await deliverOnPage(page, app, beforeClick);
  if (result.outcome === "submitted" || result.outcome === "already_submitted") await page.close();
  return result;
};
