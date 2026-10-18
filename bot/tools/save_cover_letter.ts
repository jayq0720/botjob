import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { applyLetter, upsertLetter } from "../lib/job-state.js";
import {
  applicationsKey,
  coverLettersKey,
  type ApplicationRecord,
  type CoverLetterRecord,
} from "../lib/store.js";

function chars(value: string): number {
  return Array.from(value).length;
}

export default defineTool({
  description:
    "Store a greeting (about 150 Chinese characters) and a cover letter you wrote for one job. Does not compose the text. The apply pack and local runner will show it. Sending on BOSS still needs a human confirm.",
  effect: "write",
  inputSchema: z.object({
    jobId: z.string().describe("Job id from score_job / search_jobs, or an application id"),
    greeting: z.string().min(1),
    coverLetter: z.string().min(20),
  }),
  dryRunResult: ({ jobId }) => ({
    saved: false,
    dryRun: true,
    jobId,
  }),
  async execute({ jobId, greeting, coverLetter }, ctx) {
    const hello = greeting.trim();
    const letter = coverLetter.trim();
    const greetingChars = chars(hello);
    if (greetingChars > 200) {
      return {
        saved: false,
        message: `打招呼语有 ${greetingChars} 字，请压到 150 字左右（最多 200）。`,
      };
    }
    if (chars(letter) > 4000) {
      return { saved: false, message: "求职信超过 4000 字，请缩短后再保存。" };
    }
    const sessionId = ctx.session.id;
    const now = new Date().toISOString();
    const record: CoverLetterRecord = {
      jobId,
      greeting: hello,
      coverLetter: letter,
      updatedAt: now,
    };
    const existing =
      ((await ctx.host.kv.get(coverLettersKey(sessionId))) as
        | CoverLetterRecord[]
        | undefined) ?? [];
    await ctx.host.kv.put(coverLettersKey(sessionId), upsertLetter(existing, record));

    const apps =
      ((await ctx.host.kv.get(applicationsKey(sessionId))) as
        | ApplicationRecord[]
        | undefined) ?? [];
    const updated = applyLetter(apps, record, now);
    if (updated.some((app, index) => app !== apps[index])) {
      await ctx.host.kv.put(applicationsKey(sessionId), updated);
    }
    return {
      saved: true,
      jobId,
      greetingChars,
      warning:
        greetingChars > 150
          ? `打招呼语 ${greetingChars} 字，建议再压到 150 字以内。`
          : undefined,
      attachedTo: updated
        .filter((app) => app.job.id === jobId || app.id === jobId)
        .map((app) => app.id),
      next: "queue_apply 批准后 export_apply_pack。本机 apply:local 会显示这段文字；BOSS 发送前必须人工确认。",
    };
  },
});
