import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  applicationsKey,
  type ApplicationRecord,
} from "../lib/store.js";

const outcomeSchema = z.enum(["applied", "skipped", "failed"]);

export default defineTool({
  description:
    "Update application statuses after the local semi-auto runner finishes (or after the user applied manually). Map applied→submitted_manual, skipped→skipped, failed→failed.",
  effect: "write",
  inputSchema: z.object({
    results: z
      .array(
        z.object({
          id: z.string(),
          outcome: outcomeSchema,
          note: z.string().optional(),
        }),
      )
      .min(1),
  }),
  dryRunResult: ({ results }) => ({
    updated: false,
    dryRun: true,
    count: results.length,
  }),
  async execute({ results }, ctx) {
    const sessionId = ctx.session.id;
    const apps =
      ((await ctx.host.kv.get(applicationsKey(sessionId))) as
        | ApplicationRecord[]
        | undefined) ?? [];
    if (apps.length === 0) {
      return {
        updated: false,
        message: "No applications in this session to update.",
      };
    }

    const now = new Date().toISOString();
    const byId = new Map(results.map((r) => [r.id, r]));
    let changed = 0;
    const updated = apps.map((app) => {
      const r = byId.get(app.id);
      if (!r) return app;
      changed += 1;
      const status: ApplicationRecord["status"] =
        r.outcome === "applied"
          ? "submitted_manual"
          : r.outcome === "skipped"
            ? "skipped"
            : "failed";
      return {
        ...app,
        status,
        lastNote: r.note,
        updatedAt: now,
      };
    });

    await ctx.host.kv.put(applicationsKey(sessionId), updated);
    return {
      updated: true,
      changed,
      applications: updated
        .filter((a) => byId.has(a.id))
        .map((a) => ({
          id: a.id,
          status: a.status,
          title: a.job.title,
          company: a.job.company,
          lastNote: a.lastNote,
        })),
    };
  },
});
