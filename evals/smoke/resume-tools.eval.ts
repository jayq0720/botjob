import { defineEval } from "@cursor/bdk/evals";

/**
 * Tool-level smoke: no model turn required for `bdk call`, but this eval
 * exercises the agent path when credentials exist. Gates focus on tool use.
 */
export default defineEval({
  tags: ["smoke", "resume"],
  cases: [
    {
      id: "save-and-search",
      description: "Paste resume → profile → search three boards.",
      async test(t) {
        await t.send(
          [
            "这是我的简历，请分析并帮我在智联、猎聘、51job找合适岗位。",
            "",
            "姓名：张三",
            "求职意向：高级前端工程师 / 上海",
            "工作经验：6年，熟悉 React、TypeScript、Node.js、性能优化。",
            "曾任职某互联网公司前端负责人，带过 5 人小组。",
            "期望薪资：40-50K。",
          ].join("\n"),
        );
        t.succeeded();
        t.calledTool("save_resume");
        t.calledTool("save_resume_profile");
        t.calledTool("search_jobs");
      },
    },
  ],
});
