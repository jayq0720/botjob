import type { ToolContext } from "@cursor/bdk/tools";
import type { ActionContext, StateStore } from "./state-store.js";

export function actionContextFromTool(ctx: ToolContext): ActionContext {
  return {
    sessionId: ctx.session.id,
    store: storeFromTool(ctx),
    workspaceDir: ctx.workspaceDir,
    offline: ctx.session.purpose === "eval" || ctx.session.dryRun === true,
    queueStatus: "approved",
    allowAbsoluteResumePath: false,
    absolutePackCommand: false,
    exportOnlyApproved: false,
  };
}

function storeFromTool(ctx: ToolContext): StateStore {
  const files = ctx.host.files.forSession(ctx.session.id);
  return {
    get: (key) => ctx.host.kv.get(key),
    put: (key, value) => ctx.host.kv.put(key, value as never),
    readText: (relPath) => files.read(relPath),
    writeBytes: (relPath, data) => files.write(relPath, data),
  };
}
