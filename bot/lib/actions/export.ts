import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPackPath, applicationsToPack } from "../apply-pack.js";
import type { ActionContext } from "../state-store.js";
import { applicationsKey, type ApplicationRecord } from "../store.js";

export async function exportApplyPack(ctx: ActionContext, input: { onlyApproved?: boolean }) {
  const apps =
    ((await ctx.store.get(applicationsKey(ctx.sessionId))) as ApplicationRecord[] | undefined) ??
    [];
  const onlyApproved = ctx.exportOnlyApproved || input.onlyApproved !== false;
  const pack = applicationsToPack(ctx.sessionId, apps, onlyApproved);
  if (pack.items.length === 0) {
    const queued = apps.filter((app) => app.status === "queued").length;
    return {
      exported: false as const,
      count: 0,
      message:
        queued > 0
          ? `有 ${queued} 条申请还在排队，尚未批准。请先让用户确认并调用 approve_apply，再导出。`
          : "No applications to export. Approve jobs via queue_apply first.",
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const durablePath = applyPackPath(ctx.sessionId, stamp);
  const body = JSON.stringify(pack, null, 2);
  await ctx.store.writeBytes(durablePath, body);

  const workspaceRel = path.join("apply-packs", `pack-${stamp}.json`);
  const workspaceAbs = path.join(ctx.workspaceDir, workspaceRel);
  await mkdir(path.dirname(workspaceAbs), { recursive: true });
  await writeFile(workspaceAbs, body, "utf8");

  return {
    exported: true as const,
    count: pack.items.length,
    durablePath,
    workspacePath: workspaceRel,
    workspaceAbs,
    pack,
    localCommand: `npm run apply:local -- --pack ${ctx.absolutePackCommand ? workspaceAbs : workspaceRel}`,
    nextSteps: [
      "在本机项目目录执行 localCommand（需已 npm install && npx playwright install chromium）",
      "首次打开浏览器后，请手动登录智联/猎聘；登录态会保存在 ~/.botjob/browser-profile",
      "每个岗位会打印打招呼语和求职信。按 p 复制打招呼语，l 复制求职信，f 填进输入框（不发送）",
      "按 a=已投递 / s=跳过 / c=尝试点击申请或立即沟通(仍需确认) / q=退出。发送前必须再人工确认",
      "跑完后把 results JSON 告诉 agent，或调用 mark_applied 回写状态",
    ],
  };
}
