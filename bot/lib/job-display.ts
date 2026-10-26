import type { JobListing } from "./store.js";

// The client model writes summaries from source evidence; host code only exposes the action contract.
export const JOB_DISPLAY_HINT = "逐岗展示编号、岗位/公司、薪资地点、岗位简介（据 description 概括职责和要求）、公司简介（据 companyDescription、companyIndustry、companySize）、来源链接与更新时间。未获取的介绍明确标注，不猜测。展示后提示用户可说‘一键投递第1、3个岗位’；按对应 id 调用 apply_jobs(jobIds) 预览，用户确认后执行。";

export function selectionAction(jobs: JobListing[]) {
  return jobs.length ? { tool: "apply_jobs", label: "一键投递选中岗位", requiresSelection: true,
    inputField: "jobIds", maxSelection: 10, availableJobIds: jobs.filter(job => job.employerReview !== "needs_review").map(job => job.id) } : undefined;
}
