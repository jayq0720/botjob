import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  applicationsToPack,
  applyPackPath,
} from "../lib/apply-pack.js";
import {
  applicationsKey,
  type ApplicationRecord,
} from "../lib/store.js";

export default defineTool({
  description:
    "Export approved applications as a local apply pack JSON. User then runs `npm run apply:local -- --pack <path>` on their machine for semi-automatic browser apply (login once, confirm each job).",
  effect: "write",
  inputSchema: z.object({
    onlyApproved: z
      .boolean()
      .optional()
      .describe("Default true — only export status=approved items"),
  }),
  dryRunResult: () => ({
    exported: false,
    dryRun: true,
    count: 0,
  }),
  async execute({ onlyApproved }, ctx) {
    const sessionId = ctx.session.id;
    const apps =
      ((await ctx.host.kv.get(applicationsKey(sessionId))) as
        | ApplicationRecord[]
        | undefined) ?? [];
    const pack = applicationsToPack(
      sessionId,
      apps,
      onlyApproved !== false,
    );
    if (pack.items.length === 0) {
      return {
        exported: false,
        count: 0,
        message:
          "No applications to export. Approve jobs via queue_apply first.",
      };
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const durablePath = applyPackPath(sessionId, stamp);
    const files = ctx.host.files.forSession(sessionId);
    const body = JSON.stringify(pack, null, 2);
    await files.write(durablePath, body);

    const workspaceRel = path.join("apply-packs", `pack-${stamp}.json`);
    const workspaceAbs = path.join(ctx.workspaceDir, workspaceRel);
    await mkdir(path.dirname(workspaceAbs), { recursive: true });
    await writeFile(workspaceAbs, body, "utf8");

    return {
      exported: true,
      count: pack.items.length,
      durablePath,
      workspacePath: workspaceRel,
      workspaceAbs,
      pack,
      localCommand: `npm run apply:local -- --pack ${workspaceRel}`,
      nextSteps: [
        "在本机项目目录执行 localCommand（需已 npm install && npx playwright install chromium）",
        "首次打开浏览器后，请手动登录智联/猎聘/51job/BOSS直聘；登录态会保存在 ~/.botjob/browser-profile",
        "每个岗位会打印打招呼语和求职信。按 p 复制打招呼语，l 复制求职信，f 填进输入框（不发送）",
        "按 a=已投递 / s=跳过 / c=尝试点击申请或立即沟通(仍需确认) / q=退出。BOSS 发送前必须再人工确认",
        "跑完后把 results JSON 告诉 agent，或调用 mark_applied 回写状态",
      ],
    };
  },
});
