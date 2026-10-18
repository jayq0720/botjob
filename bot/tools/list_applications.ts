import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  applicationsKey,
  type ApplicationRecord,
} from "../lib/store.js";

export default defineTool({
  description: "List queued / approved job applications for this session.",
  effect: "read",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const sessionId = ctx.session.id;
    const apps =
      ((await ctx.host.kv.get(applicationsKey(sessionId))) as
        | ApplicationRecord[]
        | undefined) ?? [];
    return {
      count: apps.length,
      applications: apps.map((a) => ({
        id: a.id,
        status: a.status,
        board: a.job.board,
        title: a.job.title,
        company: a.job.company,
        city: a.job.city,
        url: a.job.url,
        salary: a.job.salary,
        experience: a.job.experience,
        education: a.job.education,
        matchScore: a.job.matchScore,
        matchReason: a.job.matchReason,
        score: a.job.score,
        coverNote: a.coverNote,
        greeting: a.greeting,
        coverLetter: a.coverLetter,
        lastNote: a.lastNote,
        updatedAt: a.updatedAt,
      })),
    };
  },
});
