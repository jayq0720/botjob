import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import {
  resumeMetaKey,
  resumeProfileKey,
  resumeTextPath,
  type ResumeMeta,
  type ResumeProfile,
} from "../lib/store.js";

export default defineTool({
  description:
    "Load the saved resume text, metadata (incl. PDF pageCount/hasPdf), and structured profile for this session.",
  effect: "read",
  inputSchema: z.object({
    includeText: z
      .boolean()
      .optional()
      .describe("When true, include full resume text (default true)"),
  }),
  async execute({ includeText }, ctx) {
    const sessionId = ctx.session.id;
    const meta = (await ctx.host.kv.get(resumeMetaKey(sessionId))) as
      | ResumeMeta
      | undefined;
    const profile = (await ctx.host.kv.get(resumeProfileKey(sessionId))) as
      | ResumeProfile
      | undefined;
    const files = ctx.host.files.forSession(sessionId);
    const text =
      includeText === false
        ? undefined
        : await files.read(resumeTextPath(sessionId));

    if (!meta && !text && !profile) {
      return {
        found: false,
        message: "No resume saved yet. Ask the user to paste or upload one.",
      };
    }

    return {
      found: true,
      meta: meta ?? null,
      profile: profile ?? null,
      text: text ?? null,
      textPreview: text ? text.slice(0, 400) : null,
    };
  },
});
