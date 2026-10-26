import { captureJobDom } from "./page-dom.js";
import type { BoardId } from "./types.js";
export { captureJobDom };

/** Deliberately narrow DOM actions: no arbitrary script, text entry or credential access. */
export function applicationDom(board: BoardId, action: "inspect" | "click" | "result", expectedFingerprint?: string) {
  const helpers = {
    visible(element: Element) { return !!element.getClientRects().length && getComputedStyle(element).visibility !== "hidden"; },
    label(element: Element) { return element.textContent?.trim() ?? ""; },
  };
  const headers = Array.from(document.querySelectorAll(board === "liepin" ? ".job-apply-container" : ".summary-planes, .summary-plane"));
  const header = headers.length === 1 ? headers[0] : undefined;
  const buttons = header ? Array.from(header.querySelectorAll('button, a, [role="button"]')).filter(helpers.visible) : [];
  const done = buttons.filter(node => /^(投递成功|申请成功|已投递|已申请)\s*[！!。]?$/.test(helpers.label(node)));
  const alerts = Array.from(document.querySelectorAll('[role="alert"], .ant-message-notice-content, .el-message')).filter(helpers.visible)
    .filter(node => /^(投递成功|申请成功|已投递|已申请)\s*[！!。]?$/.test(helpers.label(node)));
  if (action === "result") return { done: !!(done.length || alerts.length), evidence: helpers.label(done[0] ?? alerts[0] ?? document.createElement('span')) };
  const candidates = buttons.filter(node => /^(立即申请|申请职位|投递简历|立即投递)$/.test(helpers.label(node)));
  const dialog = Array.from(document.querySelectorAll('[role="dialog"], .ant-modal, .el-dialog')).some(helpers.visible);
  const required = Array.from(document.querySelectorAll('input:required:invalid, textarea:required:invalid, select:required:invalid')).some(helpers.visible);
  const candidate = candidates[0] as HTMLElement | undefined;
  const disabled = candidate?.matches(':disabled, [aria-disabled="true"]');
  const raw = captureJobDom({ board, detail: true });
  const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(node => node.textContent ?? "");
  const fingerprint = JSON.stringify({ url: location.href, jobs: raw.jobs, ld, labels: candidates.map(helpers.label) });
  let reason = !header ? "无法确认岗位操作区域" : dialog ? "页面有待处理弹窗" : required ? "页面有必填信息" : alerts.length ? "页面存在未关联的成功提示" : candidates.length !== 1 || disabled ? "没有唯一可用的申请按钮，可能仅支持聊一聊" : "";
  if (action === "click") {
    if (fingerprint !== expectedFingerprint) reason = "岗位页面在确认后发生变化";
    if (done.length) reason = "页面已经显示投递，不重复点击";
    if (reason || !candidate) return { clicked: false, reason };
    candidate.scrollIntoView({ block: "center" });
    const rect = candidate.getBoundingClientRect();
    const top = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    if (!top || !(top === candidate || candidate.contains(top))) return { clicked: false, reason: "申请按钮被遮挡" };
    candidate.click();
    return { clicked: true };
  }
  return { raw, fingerprint, reason, alreadySubmitted: done.length === 1, evidence: done[0] ? helpers.label(done[0]) : undefined };
}
