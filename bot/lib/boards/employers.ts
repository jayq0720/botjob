/** Explicit employer evidence only. General industry inference belongs to the AI client. */
export type EmployerEvidence = { company: string; companyIndustry?: string };
export function excludedEmployer(job: EmployerEvidence): "insurance" | "labor_dispatch" | undefined {
  const name = job.company.replace(/\s/g, "");
  const industry = job.companyIndustry?.replace(/\s/g, "") ?? "";
  if (/保险|人寿|财险|寿险|再保险|insurance/i.test(name) || /保险|人寿|财险|寿险|insurance/i.test(industry)) return "insurance";
  if (/劳务派遣|劳动力派遣|labor\s*dispatch/i.test(name) || /劳务派遣|劳动力派遣|labor\s*dispatch/i.test(industry)) return "labor_dispatch";
  return undefined;
}

export function employerReview(job: EmployerEvidence): "needs_review" | "no_exclusion_evidence" {
  return !job.company.trim() || job.company === "（未提供）" || !job.companyIndustry || /人力资源|人才服务|人事服务|劳务/.test(job.company + job.companyIndustry)
    ? "needs_review" : "no_exclusion_evidence";
}
