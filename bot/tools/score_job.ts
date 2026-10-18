import { defineTool } from "@cursor/bdk/tools";
import * as z from "zod/v4";
import { scoreJob } from "../lib/actions.js";
import { actionContextFromTool } from "../lib/bdk-context.js";

const boardSchema = z.enum(["zhilian", "liepin", "job51", "boss"]);

export default defineTool({
  description:
    "Score one job against the saved resume profile. Pass JD text and/or an https URL on 智联/猎聘/51job/BOSS. Stores the score in session state. Does not invent fields the page did not contain, and does not bypass captcha or login.",
  effect: "read",
  inputSchema: z
    .object({
      text: z.string().optional().describe("Pasted JD text"),
      url: z.string().optional().describe("Public job detail URL"),
      board: boardSchema.optional(),
      title: z.string().optional(),
      company: z.string().optional(),
      city: z.string().optional(),
      salary: z.string().optional(),
      experience: z.string().optional(),
      education: z.string().optional(),
    })
    .refine((v) => Boolean(v.text?.trim() || v.url?.trim()), {
      message: "Provide JD text or a job URL",
    }),
  async execute(input, ctx) {
    return scoreJob(actionContextFromTool(ctx), input);
  },
});
