import type { BoardId } from "./types.js";
import { jobUrlAllowed, type JobPosting } from "../jd.js";

export type ApiParse =
  | { ok: true; jobs: JobPosting[] }
  | { ok: false; reason: "blocked" | "empty" | "parse_error"; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = decodeEntities(value).trim();
  return text || undefined;
}

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .trim();
}

function plain(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n"),
  );
}

function absUrl(href: string, base: string): string {
  try {
    const url = new URL(decodeEntities(href), base);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.href;
  } catch {
    return href;
  }
}

function tagAttr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function anchorFields(tag: string | undefined): { href?: string; text?: string } {
  if (!tag) return {};
  const href = tagAttr(tag, "href");
  const text = plain(tag.replace(/^<a\b[^>]*>/i, "").replace(/<\/a>$/i, ""));
  return { href, text: text || undefined };
}

function textByClass(html: string, className: string): string | undefined {
  const slice = html.match(
    new RegExp(`class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]{0,600})`),
  )?.[1];
  if (!slice) return undefined;
  const direct = slice.match(/^\s*([^<]{1,80})/);
  if (direct?.[1]?.trim()) return decodeEntities(direct[1]);
  const span = slice.match(/<span[^>]*>([^<]+)<\/span>/);
  return span?.[1]?.trim() ? decodeEntities(span[1]) : undefined;
}

function visibleSalary(text: string | undefined): string | undefined {
  if (!text || /\*/.test(text)) return undefined;
  return text;
}

function pickExpEdu(labels: string[]): { experience?: string; education?: string } {
  let experience: string | undefined;
  let education: string | undefined;
  for (const label of labels.map((item) => item.trim()).filter(Boolean)) {
    if (!education && /学历|本科|大专|专科|硕士|博士|高中|中专|MBA/.test(label)) {
      education = label;
      continue;
    }
    if (
      !experience &&
      /经验|应届|在校|实习|\d+\s*[-~到至]\s*\d+\s*年|\d+\s*年以上|\d+\s*年以内/.test(label)
    ) {
      experience = label;
    }
  }
  return { experience, education };
}

function posting(input: {
  board: BoardId;
  title?: string;
  company?: string;
  city?: string;
  salary?: string;
  experience?: string;
  education?: string;
  description?: string;
  url?: string;
  jdStatus?: JobPosting["jdStatus"];
}): JobPosting | undefined {
  if (!input.title || !input.url || !jobUrlAllowed(input.url, input.board)) return undefined;
  const description = (input.description ?? "").trim();
  return {
    board: input.board,
    title: input.title,
    company: input.company || "（未提供）",
    city: input.city || "",
    salary: input.salary,
    experience: input.experience,
    education: input.education,
    description,
    url: input.url,
    jdStatus: input.jdStatus ?? (description.length >= 20 ? "detail" : "list_only"),
  };
}

export function parseSearchHtml(
  board: BoardId,
  html: string,
  pageUrl: string,
): JobPosting[] {
  switch (board) {
    case "zhilian":
      return parseZhilianSearch(html, pageUrl);
    case "liepin":
      return parseLiepinSearch(html, pageUrl);
    case "job51":
      return parseJob51Search(html, pageUrl);
    case "boss":
      return parseBossSearch(html, pageUrl);
  }
}

export function parseDetailHtml(
  board: BoardId,
  html: string,
  pageUrl: string,
): JobPosting | undefined {
  const fromLd = jobPostingsFromJsonLd(html, pageUrl, board).find(
    (job) => job.description.length >= 20,
  );
  if (fromLd) return fromLd;
  switch (board) {
    case "zhilian":
      return parseZhilianDetail(html, pageUrl);
    case "liepin":
      return parseLiepinDetail(html, pageUrl);
    case "job51":
      return parseJob51Detail(html, pageUrl);
    case "boss":
      return parseBossDetail(html, pageUrl);
  }
}

function splitChunks(html: string, marker: string): string[] {
  const parts = html.split(marker);
  return parts.slice(1).map((part) => marker + part);
}

function parseLiepinSearch(html: string, pageUrl: string): JobPosting[] {
  const jobs: JobPosting[] = [];
  for (const chunk of splitChunks(html, "job-card-pc-container")) {
    const title = chunk.match(/<div title="([^"]+)" class="ellipsis-1">/)?.[1];
    const city = chunk.match(
      /class="job-dq-box"[\s\S]*?<span class="ellipsis-1">([^<]+)<\/span>/,
    )?.[1];
    const salary = chunk.match(/<span class="job-salary">([^<]+)<\/span>/)?.[1];
    const company = chunk.match(/<span class="company-name[^"]*">([^<]+)<\/span>/)?.[1];
    const href = chunk.match(/href="(https:\/\/www\.liepin\.com\/job\/[^"]+\.shtml)"/)?.[1];
    const labels = [...chunk.matchAll(/<span class="labels-tag"[^>]*>([^<]*)<\/span>/g)].map(
      (m) => m[1],
    );
    const expEdu = pickExpEdu(labels);
    const job = posting({
      board: "liepin",
      title: title ? decodeEntities(title) : undefined,
      company: company ? decodeEntities(company) : undefined,
      city: city ? decodeEntities(city) : undefined,
      salary: salary ? decodeEntities(salary) : undefined,
      ...expEdu,
      url: href ? absUrl(href, pageUrl) : undefined,
      jdStatus: "list_only",
    });
    if (job) jobs.push(job);
  }
  return jobs;
}

function parseZhilianSearch(html: string, pageUrl: string): JobPosting[] {
  const jobs: JobPosting[] = [];
  // "joblist-box__item" is also a prefix of iteminfo / item-tag, so split on the card class only.
  const parts = html.split(/class="joblist-box__item(?:\s|")/);
  for (const chunk of parts.slice(1)) {
    const name = anchorFields(
      chunk.match(/<a\b[^>]*class="jobinfo__name"[^>]*>[\s\S]*?<\/a>/)?.[0],
    );
    const company = anchorFields(
      chunk.match(/<a\b[^>]*class="companyinfo__name"[^>]*>[\s\S]*?<\/a>/)?.[0],
    );
    const salary = chunk.match(/class="jobinfo__salary"[^>]*>([\s\S]*?)<\/p>/)?.[1];
    const extras = [
      ...chunk.matchAll(/class="jobinfo__other-info-item"[^>]*>([\s\S]*?)<\/div>/g),
    ]
      .map((m) => plain(m[1]))
      .filter(Boolean);
    const expEdu = pickExpEdu(extras);
    const city = extras.find(
      (item) => item !== expEdu.experience && item !== expEdu.education,
    );
    const job = posting({
      board: "zhilian",
      title: name.text,
      company: company.text,
      city,
      salary: salary ? plain(salary) : undefined,
      ...expEdu,
      url: name.href ? absUrl(name.href, pageUrl) : undefined,
      jdStatus: "list_only",
    });
    if (job) jobs.push(job);
  }
  return jobs;
}

function parseJob51Search(html: string, pageUrl: string): JobPosting[] {
  const jobs: JobPosting[] = [];
  for (const chunk of splitChunks(html, "joblist-item")) {
    const link = chunk.match(/class="jname[^"]*"[^>]*href="([^"]+)"[^>]*>([^<]+)</);
    const company = chunk.match(/class="cname[^"]*"[^>]*>([^<]+)</)?.[1];
    const salary = chunk.match(/class="sal[^"]*"[^>]*>([^<]+)</)?.[1];
    const city = chunk.match(/class="area[^"]*"[^>]*>([^<]+)</)?.[1];
    const experience = chunk.match(/class="exp[^"]*"[^>]*>([^<]+)</)?.[1];
    const education = chunk.match(/class="edu[^"]*"[^>]*>([^<]+)</)?.[1];
    const job = posting({
      board: "job51",
      title: link ? decodeEntities(link[2]) : undefined,
      company: company ? decodeEntities(company) : undefined,
      city: city ? decodeEntities(city) : undefined,
      salary: salary ? decodeEntities(salary) : undefined,
      experience: experience ? decodeEntities(experience) : undefined,
      education: education ? decodeEntities(education) : undefined,
      url: link ? absUrl(link[1], pageUrl) : undefined,
      jdStatus: "list_only",
    });
    if (job) jobs.push(job);
  }
  return jobs;
}

function parseBossSearch(html: string, pageUrl: string): JobPosting[] {
  const jobs: JobPosting[] = [];
  for (const chunk of splitChunks(html, "job-card-wrapper")) {
    const title = chunk.match(/class="job-name"[^>]*>([^<]+)</)?.[1];
    const salary = chunk.match(/class="salary"[^>]*>([^<]+)</)?.[1];
    const city = chunk.match(/class="job-area"[^>]*>([^<]+)</)?.[1];
    const company = chunk.match(
      /class="company-name"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/,
    )?.[1];
    const href = chunk.match(/href="([^"]*job_detail[^"]+)"/)?.[1];
    const tags = [...chunk.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]);
    const expEdu = pickExpEdu(tags);
    const job = posting({
      board: "boss",
      title: title ? decodeEntities(title) : undefined,
      company: company ? decodeEntities(company) : undefined,
      city: city ? decodeEntities(city) : undefined,
      salary: salary ? decodeEntities(salary) : undefined,
      ...expEdu,
      url: href ? absUrl(href, pageUrl) : undefined,
      jdStatus: "list_only",
    });
    if (job) jobs.push(job);
  }
  return jobs;
}

function parseZhilianDetail(html: string, pageUrl: string): JobPosting | undefined {
  const title =
    textByClass(html, "summary-planes__title") || textByClass(html, "summary-plane__title");
  const salary = visibleSalary(
    textByClass(html, "summary-planes__salary") || textByClass(html, "summary-plane__salary"),
  );
  const company =
    textByClass(html, "company-info__name") || textByClass(html, "company__title");
  const description = html.match(
    /class="[^"]*describtion(?:-card)?__detail-content[^"]*"[^>]*>([\s\S]*?)<\/div>/,
  )?.[1];
  const info = ["summary-planes__info", "summary-plane__info"].flatMap((className) => {
    const block = html.match(
      new RegExp(`class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/ul>`),
    )?.[1];
    if (!block) return [];
    return [...block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)]
      .map((m) => plain(m[1]))
      .filter((item) => item && !item.startsWith("客户公司"));
  });
  const expEdu = pickExpEdu(info);
  const city = info.find((item) => item !== expEdu.experience && item !== expEdu.education);
  return posting({
    board: "zhilian",
    title,
    company,
    city,
    salary,
    ...expEdu,
    description: description ? plain(description) : undefined,
    url: pageUrl,
  });
}

function parseLiepinDetail(html: string, pageUrl: string): JobPosting | undefined {
  const title = html.match(/<span class="name[^"]*">([^<]+)<\/span>/)?.[1];
  const salary = html.match(/<span class="salary">([^<]+)<\/span>/)?.[1];
  const description = html.match(
    /data-selector="job-intro-content">([\s\S]*?)<\/dd>/,
  )?.[1];
  const props = [...html.matchAll(/class="job-properties"[\s\S]*?<\/div>/g)].flatMap(
    (block) => [...block[0].matchAll(/<span(?![^>]*class="split")[^>]*>([^<]+)<\/span>/g)].map((m) => decodeEntities(m[1])),
  );
  const expEdu = pickExpEdu(props);
  const city = props.find((item) => item !== expEdu.experience && item !== expEdu.education && !/招\d+人|更新|学生/.test(item));
  return posting({
    board: "liepin",
    title: title ? decodeEntities(title) : undefined,
    company: "（未提供）",
    city,
    salary: salary ? decodeEntities(salary) : undefined,
    ...expEdu,
    description: description ? plain(description) : undefined,
    url: pageUrl,
  });
}

function parseJob51Detail(html: string, pageUrl: string): JobPosting | undefined {
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1];
  const salary = html.match(/<strong>([^<]+)<\/strong>/)?.[1];
  const company = html.match(/class="catn"[^>]*>([^<]+)</)?.[1];
  const city = html.match(/class="msg[^"]*"[^>]*>([^<]+)</)?.[1];
  const spans = [...html.matchAll(/class="sp4"[^>]*>([^<]+)</g)].map((m) => decodeEntities(m[1]));
  const expEdu = pickExpEdu(spans);
  const description = html.match(/class="[^"]*\bjob_msg\b[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  return posting({
    board: "job51",
    title: title ? decodeEntities(title) : undefined,
    company: company ? decodeEntities(company) : undefined,
    city: city ? decodeEntities(city) : undefined,
    salary: salary ? decodeEntities(salary) : undefined,
    ...expEdu,
    description: description ? plain(description) : undefined,
    url: pageUrl,
  });
}

function parseBossDetail(html: string, pageUrl: string): JobPosting | undefined {
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1];
  const salary = html.match(/class="salary"[^>]*>([^<]+)</)?.[1];
  const company =
    html.match(/class="company-name"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/)?.[1] ??
    html.match(/class="company-name"[^>]*>([^<]+)</)?.[1];
  const req = [...html.matchAll(/class="job-req"[\s\S]*?<\/p>/g)].flatMap((block) =>
    [...block[0].matchAll(/<span>([^<]+)<\/span>/g)].map((m) => decodeEntities(m[1])),
  );
  const expEdu = pickExpEdu(req);
  const city = req.find((item) => item !== expEdu.experience && item !== expEdu.education);
  const description = html.match(/class="job-sec-text"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  return posting({
    board: "boss",
    title: title ? decodeEntities(title) : undefined,
    company: company ? decodeEntities(company) : undefined,
    city,
    salary: salary ? decodeEntities(salary) : undefined,
    ...expEdu,
    description: description ? plain(description) : undefined,
    url: pageUrl,
  });
}

function jobPostingsFromJsonLd(
  html: string,
  pageUrl: string,
  board: BoardId,
): JobPosting[] {
  const jobs: JobPosting[] = [];
  for (const match of html.matchAll(
    /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    let data: unknown;
    try {
      data = JSON.parse(match[1]);
    } catch {
      continue;
    }
    const nodes = Array.isArray(data) ? data : [data];
    for (const node of nodes) {
      if (!isRecord(node) || node["@type"] !== "JobPosting") continue;
      const job = fromJobPostingLd(node, pageUrl, board);
      if (job) jobs.push(job);
    }
  }
  return jobs;
}

function fromJobPostingLd(
  node: Record<string, unknown>,
  pageUrl: string,
  board: BoardId,
): JobPosting | undefined {
  const org = isRecord(node.hiringOrganization) ? node.hiringOrganization : undefined;
  const location = isRecord(node.jobLocation) ? node.jobLocation : undefined;
  const address = location && isRecord(location.address) ? location.address : undefined;
  const city =
    asString(address?.addressLocality) || asString(address?.addressRegion) || "";
  return posting({
    board,
    title: asString(node.title),
    company: asString(org?.name),
    city,
    salary: salaryFromLd(node.baseSalary),
    experience: asString(node.experienceRequirements),
    education: asString(node.educationRequirements),
    description: asString(node.description),
    url: jobUrlAllowed(asString(node.url) ?? "", board)
      ? asString(node.url)
      : jobUrlAllowed(pageUrl, board)
        ? pageUrl
        : undefined,
  });
}

function salaryFromLd(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.value)) return undefined;
  const min = Number(value.value.minValue);
  const max = Number(value.value.maxValue);
  const unit = asString(value.value.unitText) ?? "MONTH";
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  if (unit === "MONTH" && min >= 1000 && max >= 1000) {
    return `${Math.round(min / 1000)}-${Math.round(max / 1000)}k`;
  }
  if (unit === "YEAR" && min >= 10000 && max >= 10000) {
    return `${Math.round(min / 10000)}-${Math.round(max / 10000)}万/年`;
  }
  return `${min}-${max}`;
}

export function parseBossApi(payload: unknown): ApiParse {
  if (!isRecord(payload)) {
    return { ok: false, reason: "parse_error", message: "BOSS 接口不是 JSON 对象。" };
  }
  const code = Number(payload.code);
  const message = asString(payload.message) ?? "";
  if (code === 37 || /异常|登录|安全/.test(message)) {
    return {
      ok: false,
      reason: "blocked",
      message: message
        ? `BOSS 接口拒绝公开读取：${message} 不会代为通过安全校验。`
        : "BOSS 接口拒绝公开读取。不会代为通过安全校验。",
    };
  }
  if (code !== 0) {
    return {
      ok: false,
      reason: "parse_error",
      message: `BOSS 接口返回 code=${String(payload.code)} ${message}`.trim(),
    };
  }
  const data = isRecord(payload.zpData) ? payload.zpData : undefined;
  const list = data && Array.isArray(data.jobList) ? data.jobList : [];
  const jobs = list.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = asString(item.encryptJobId);
    const job = posting({
      board: "boss",
      title: asString(item.jobName),
      company: asString(item.brandName),
      city: asString(item.cityName),
      salary: asString(item.salaryDesc),
      experience: asString(item.jobExperience),
      education: asString(item.jobDegree),
      description: asString(item.postDescription),
      url: id ? `https://www.zhipin.com/job_detail/${id}.html` : undefined,
    });
    return job ? [job] : [];
  });
  if (jobs.length === 0) {
    return { ok: false, reason: "empty", message: "BOSS 接口没有返回岗位列表。" };
  }
  return { ok: true, jobs };
}

export function parseZhilianApi(payload: unknown): ApiParse {
  if (!isRecord(payload)) {
    return { ok: false, reason: "parse_error", message: "智联接口不是 JSON 对象。" };
  }
  const data = isRecord(payload.data) ? payload.data : payload;
  const results = Array.isArray(data.results) ? data.results : undefined;
  if (!results) {
    return { ok: false, reason: "parse_error", message: "智联接口没有 results 字段。" };
  }
  if (results.length === 0) {
    return {
      ok: false,
      reason: "empty",
      message: "智联搜索接口返回空列表，没有可展示的岗位。",
    };
  }
  const jobs = results.flatMap((item) => {
    if (!isRecord(item)) return [];
    const city = isRecord(item.city) ? asString(item.city.display) : asString(item.city);
    const exp = isRecord(item.workingExp) ? asString(item.workingExp.name) : asString(item.workingExp);
    const edu = isRecord(item.eduLevel) ? asString(item.eduLevel.name) : asString(item.eduLevel);
    const job = posting({
      board: "zhilian",
      title: asString(item.jobName) || asString(item.name),
      company: asString(item.companyName),
      city,
      salary: asString(item.salary),
      experience: exp,
      education: edu,
      description: asString(item.jobSummary),
      url: [asString(item.positionURL), asString(item.positionUrl)].find((value) =>
        value ? jobUrlAllowed(value, "zhilian") : false,
      ),
    });
    return job ? [job] : [];
  });
  if (jobs.length === 0) {
    return { ok: false, reason: "parse_error", message: "智联 results 里没有可解析的岗位字段。" };
  }
  return { ok: true, jobs };
}
