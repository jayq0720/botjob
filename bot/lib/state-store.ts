import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** Session kv + durable files. BDK and the local MCP server each have an implementation. */
export type StateStore = {
  get(key: string): Promise<unknown>;
  put(key: string, value: unknown): Promise<void>;
  readText(relPath: string): Promise<string | undefined>;
  writeBytes(relPath: string, data: string | Uint8Array): Promise<void>;
};

export type ActionContext = {
  sessionId: string;
  store: StateStore;
  /** Relative resume paths and exported packs resolve under this directory. */
  workspaceDir: string;
  /** Eval, dry-run, or BOTJOB_OFFLINE. Skips board fetches unless a tool opts in. */
  offline: boolean;
  /**
   * BDK `queue_apply` already passed the approval card, so the record is approved.
   * MCP has no approval card; the record stays queued until `approve_apply`.
   */
  queueStatus: "approved" | "queued";
  /** MCP may read an absolute resume path. BDK only allows a workspace-relative path. */
  allowAbsoluteResumePath: boolean;
  /** MCP pack command uses an absolute path. BDK keeps the workspace-relative path. */
  absolutePackCommand: boolean;
  /** MCP never exports unapproved rows. BDK still honors `onlyApproved: false`. */
  exportOnlyApproved: boolean;
};

/** Stable session for the local MCP process. State survives restarts under BOTJOB_HOME. */
export const MCP_SESSION_ID = "local";

/** `~/.botjob`, or `BOTJOB_HOME` when set. Data lives in `<home>/data`. */
export function botjobHome(): string {
  const fromEnv = process.env.BOTJOB_HOME?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(homedir(), ".botjob");
}

export function botjobDataDir(home = botjobHome()): string {
  return path.join(home, "data");
}

const stores = new Map<string, StateStore>();

export function fileStoreFor(dataDir = botjobDataDir()): StateStore {
  const key = path.resolve(dataDir);
  const existing = stores.get(key);
  if (existing) return existing;
  const created = createFileStore(key);
  stores.set(key, created);
  return created;
}

export function mcpActionContext(home = botjobHome()): ActionContext {
  const dataDir = botjobDataDir(home);
  return {
    sessionId: MCP_SESSION_ID,
    store: fileStoreFor(dataDir),
    workspaceDir: path.join(dataDir, "workspace"),
    offline: process.env.BOTJOB_OFFLINE === "1",
    queueStatus: "queued",
    allowAbsoluteResumePath: true,
    absolutePackCommand: true,
    exportOnlyApproved: true,
  };
}

function createFileStore(dataDir: string): StateStore {
  const kvPath = path.join(dataDir, "kv.json");
  const filesDir = path.join(dataDir, "files");
  let chain = Promise.resolve();

  function lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function readKv(): Promise<Record<string, unknown>> {
    try {
      const raw = await readFile(kvPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return {};
  }

  return {
    get(key) {
      return lock(async () => (await readKv())[key]);
    },
    put(key, value) {
      return lock(async () => {
        await mkdir(dataDir, { recursive: true });
        const kv = await readKv();
        kv[key] = value;
        const tmp = `${kvPath}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(kv), "utf8");
        await rename(tmp, kvPath);
      });
    },
    async readText(relPath) {
      try {
        return await readFile(safeJoin(filesDir, relPath), "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw err;
      }
    },
    async writeBytes(relPath, data) {
      const abs = safeJoin(filesDir, relPath);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, data);
    },
  };
}

function safeJoin(root: string, relPath: string): string {
  if (!relPath || path.isAbsolute(relPath) || relPath.split(/[\\/]/).includes("..")) {
    throw new Error("file path must be relative and must not contain ..");
  }
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, relPath);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error("file path escapes the data directory");
  }
  return abs;
}
