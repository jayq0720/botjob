import { DIRECT_TOOL_CALL_CHANNEL_ID } from "@cursor/bdk";
import type { ToolContext } from "@cursor/bdk/tools";
import type { ActionContext, StateStore } from "./state-store.js";

const writeChains = new Map<string, Promise<unknown>>();

function locked<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeChains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  writeChains.set(
    key,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

export function actionContextFromTool(ctx: ToolContext): ActionContext {
  return {
    sessionId: ctx.session.id,
    store: storeFromTool(ctx),
    workspaceDir: ctx.workspaceDir,
    offline: ctx.session.purpose === "eval" || ctx.session.dryRun === true,
    // Direct `bdk call` and POST /v1/tools skip the approval card and leave
    // `approvedBy` unset. Only a parked model-turn approval sets it.
    queueStatus:
      ctx.approvedBy && ctx.session.dryRun !== true ? "approved" : "queued",
    durableSession: ctx.session.channelId !== DIRECT_TOOL_CALL_CHANNEL_ID,
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
    update(key, mutate) {
      return locked(`${ctx.session.id}\n${key}`, async () => {
        const current = await ctx.host.kv.get(key);
        const { value, result } = mutate(current);
        await ctx.host.kv.put(key, value as never);
        return result;
      });
    },
    readText: (relPath) => files.read(relPath),
    writeBytes: (relPath, data) => files.write(relPath, data),
  };
}

/** Scratch `bdk call` has no reusable session. Durable sessions echo `sessionId`. */
export function withDurableSession<T extends object>(
  ctx: ActionContext,
  result: T,
): T & { sessionId?: string } {
  if (!ctx.durableSession) return result;
  return { ...result, sessionId: ctx.sessionId };
}
