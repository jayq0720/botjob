import { defineEval } from "@cursor/bdk/evals";

const resume = [
  "姓名：张三",
  "求职意向：高级前端工程师 / 上海",
  "学历：本科",
  "工作经验：6年，熟悉 React、TypeScript、Node.js、性能优化。",
  "曾任职某互联网公司前端负责人，带过 5 人小组。",
  "期望薪资：40-50K。",
].join("\n");

const jd = [
  "职位：资深前端工程师",
  "公司：云桥网络",
  "城市：上海",
  "薪资：30-50K",
  "经验：5-10年",
  "学历：本科",
  "岗位职责：负责核心前端架构，要求 React、TypeScript、工程化与性能优化。工作城市上海。",
].join("\n");

export default defineEval({
  tags: ["apply-flow"],
  cases: [
    {
      id: "score-and-queue",
      description: "Resume, profile, search links, score a pasted JD, save copy, queue for approval.",
      async test(t) {
        await t.send(
          [
            "请按顺序处理，不要访问招聘网站（search_jobs 不要把 attemptFetch 设为 true）。",
            "1. 保存下面的简历并分析画像。",
            "2. 调用 search_jobs。",
            "3. 用我贴的 JD 调用 score_job（board=boss）。",
            "4. 为这个岗位写约 150 字打招呼语和一封求职信，调用 save_cover_letter。",
            "5. 调用 queue_apply 排队，等我批准。",
            "",
            "简历：",
            resume,
            "",
            "JD：",
            jd,
          ].join("\n"),
        );
        t.calledTool("save_resume");
        t.calledTool("save_resume_profile");
        t.calledTool("search_jobs");
        t.calledTool("score_job");
        t.calledTool("save_cover_letter");
        t.calledTool("queue_apply");
        t.parked();
      },
    },
    {
      id: "search-without-apply",
      description: "Analyze and search, but do not queue an application.",
      async test(t) {
        await t.send(
          [
            "请只保存简历、分析画像，并调用 search_jobs。不要打分，不要写求职信，不要 queue_apply。",
            "",
            resume,
          ].join("\n"),
        );
        t.succeeded();
        t.calledTool("save_resume");
        t.calledTool("save_resume_profile");
        t.calledTool("search_jobs");
        t.notCalledTool("queue_apply");
      },
    },
  ],
});
