import { companyTagLine, companyTags, introAfterHeading, trimIntro } from "./company.js";
import { job51DetailUrl } from "./job51.js";
import { jobTime, type JobTime } from "./freshness.js";
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

function pageText(html: string): string {
  return plain(html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " "));
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

/** All text inside a class's element, up to its first closing div. */
function blockText(html: string, className: string): string | undefined {
  const block = html.match(new RegExp(`class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]{0,600}?)<\\/div>`))?.[1];
  return block ? plain(block).replace(/\s+/g, " ").trim() || undefined : undefined;
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

function posting(input: JobTime & {
  board: BoardId;
  title?: string;
  company?: string;
  companyIndustry?: string;
  companyIntro?: string;
  companyTagText?: string;
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
    companyIndustry: input.companyIndustry,
    ...companyTags(input.companyTagText ?? input.companyIndustry),
    companyIntro: trimIntro(input.companyIntro),
    city: input.city || "",
    salary: input.salary,
    experience: input.experience,
    education: input.education,
    description,
    url: input.url,
    jdStatus: input.jdStatus ?? (description.length >= 20 ? "detail" : "list_only"),
    sourceUpdatedAt: input.sourceUpdatedAt,
    sourceTimeText: input.sourceTimeText,
    sourceTimeKind: input.sourceTimeKind,
  };
}

export function parseSearchHtml(
  board: BoardId,
  html: string,
  pageUrl: string,
  now = Date.now(),
): JobPosting[] {
  switch (board) {
    case "zhilian":
      return parseZhilianSearch(html, pageUrl, now);
    case "liepin":
      return parseLiepinSearch(html, pageUrl);
    case "job51":
      return parseJob51Search(html, pageUrl, now);
  }
}

export function parseDetailHtml(
  board: BoardId,
  html: string,
  pageUrl: string,
  now = Date.now(),
): JobPosting | undefined {
  const fromLd = jobPostingsFromJsonLd(html, pageUrl, board).find(
    (job) => job.description.length >= 20,
  );
  const job = fromLd ?? (board === "zhilian" ? parseZhilianDetail(html, pageUrl)
    : board === "job51" ? parseJob51Detail(html, pageUrl, now) : parseLiepinDetail(html, pageUrl));
  if (!job) return undefined;
  job.companyIntro ??= introAfterHeading(pageText(html));
  if (board === "job51") return job;
  if (board === "liepin") {
    // Only the job's own update label, never footer SEO dates or recruiter activity.
    const header = html.match(/<section\b[^>]*class="[^"]*\bjob-apply-container\b[^"]*"[^>]*>[\s\S]*?<\/section>/)?.[0];
    const updated = header ? textByClass(header, "update-time") : undefined;
    return updated ? { ...job, ...jobTime(updated, "updated", now) } : job;
  }
  const state = initialState(html);
  const detail = isRecord(state?.jobDetail) ? state.jobDetail : undefined;
  const position = isRecord(detail?.detailedPosition) ? detail.detailedPosition : undefined;
  const number = pageUrl.match(/\/([^/.]+)\.htm(?:[?#]|$)/)?.[1];
  return position && number === position.number ? { ...job, ...positionTime(position, now) } : job;
}

function initialState(html: string): Record<string, unknown> | undefined {
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1].trim();
    if (!body.startsWith("__INITIAL_STATE__=")) continue;
    try {
      const value: unknown = JSON.parse(body.slice("__INITIAL_STATE__=".length).replace(/;\s*$/, ""));
      if (isRecord(value)) return value;
    } catch { /* Unreadable source data is not evidence of a recent update. */ }
  }
  return undefined;
}

function positionTime(position: Record<string, unknown>, now: number): JobTime {
  const updated = asString(position.positionUpdateTime) || asString(position.updateTime);
  if (updated) return jobTime(updated, "updated", now);
  return jobTime(asString(position.positionPublishTime) || asString(position.publishTime), "published", now);
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
      companyIndustry: textByClass(chunk, "company-tags-box"),
      companyTagText: blockText(chunk, "company-tags-box"),
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

function zhilianCompanyTags(chunk: string): string[] {
  const tags = chunk.split('class="companyinfo__tag"')[1]?.split('class="companyinfo__staff"')[0] ?? "";
  return [...tags.matchAll(/class="joblist-box__item-tag"[^>]*>([\s\S]*?)<\/div>/g)].map(match => plain(match[1]).trim());
}

function zhilianCompanyIndustry(chunk: string): string | undefined {
  return zhilianCompanyTags(chunk)
    .filter(text => !/\d.*人|民营|国企|上市|合资|外商/.test(text))
    .join("、") || undefined;
}

function parseZhilianSearch(html: string, pageUrl: string, now: number): JobPosting[] {
  const jobs: JobPosting[] = [];
  const state = initialState(html);
  const positions = Array.isArray(state?.positionList) ? state.positionList.filter(isRecord) : [];
  const byNumber = new Map(positions.map((item) => [item.number, item]));
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
      companyIndustry: zhilianCompanyIndustry(chunk),
      companyTagText: zhilianCompanyTags(chunk).join(" ") || undefined,
      city,
      salary: salary ? plain(salary) : undefined,
      ...expEdu,
      url: name.href ? absUrl(name.href, pageUrl) : undefined,
      jdStatus: "list_only",
    });
    if (job) {
      const number = job.url.match(/\/([^/.]+)\.htm(?:[?#]|$)/)?.[1];
      const position = byNumber.get(number);
      jobs.push(position ? { ...job, ...positionTime(position, now) } : job);
    }
  }
  return jobs.length ? jobs : parseZhilianJobCards(html, positions, now);
}

/** Company facts the positionList record states for this job, as one tag line. */
export function zhilianPositionTags(position: Record<string, unknown>): string {
  return [asString(position.financingStage), asString(position.companySize), asString(position.industryName), asString(position.property)]
    .filter(Boolean).join(" · ");
}

/** Pick the positionList record for a card: same title and company, else the same slot if its title matches. */
export function zhilianPosition(positions: Record<string, unknown>[], index: number, title: string, company?: string): Record<string, unknown> | undefined {
  const same = (item: Record<string, unknown> | undefined) => !!item && asString(item.name)?.trim() === title;
  return positions.find(item => same(item) && (!company || asString(item.companyName)?.trim() === company))
    ?? (same(positions[index]) ? positions[index] : undefined);
}

/** www.zhaopin.com/jobs/ (2026): cards carry no job link, so the URL comes from __INITIAL_STATE__.positionList. */
function parseZhilianJobCards(html: string, positions: Record<string, unknown>[], now: number): JobPosting[] {
  const jobs: JobPosting[] = [];
  for (const [index, chunk] of html.split(/class="job-card(?:\s[^"]*)?"/).slice(1).entries()) {
    const title = chunk.match(/class="vue-clamp__text"[^>]*>([^<]+)</)?.[1] ?? chunk.match(/class="job-card__title-main"[^>]*>([\s\S]*?)<\/div>/)?.[1];
    const company = anchorFields(chunk.match(/<a\b[^>]*class="job-card__company-name[^"]*"[^>]*>[\s\S]*?<\/a>/)?.[0]).text;
    const name = title ? plain(title).trim() : undefined;
    const position = name ? zhilianPosition(positions, index, name, company) : undefined;
    const url = asString(position?.positionURL) ?? asString(position?.positionUrl);
    const labels = [...chunk.matchAll(/class="job-card__skill-tag"[^>]*>([^<]*)</g)].map(match => decodeEntities(match[1]).trim());
    const tagLine = position ? zhilianPositionTags(position) : "";
    const job = posting({
      board: "zhilian",
      title: name,
      company: company || asString(position?.companyName),
      companyIndustry: asString(position?.industryName),
      companyTagText: tagLine || undefined,
      city: chunk.match(/class="job-card__location"[\s\S]*?<span title="([^"]+)"/)?.[1],
      salary: visibleSalary(textByClass(chunk, "job-card__salary")),
      ...pickExpEdu(labels),
      url,
      jdStatus: "list_only",
    });
    if (job) jobs.push(position ? { ...job, ...positionTime(position, now) } : job);
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
  // company-info__desc is the "A轮 · 1000-9999人 · 行业" tag line; the intro has its own paragraph.
  const tagLine = textByClass(html, "company-info__desc");
  const intro = html.match(/class="[^"]*\bcompany-info__intro\b[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1];
  return posting({
    board: "zhilian",
    title,
    company,
    companyIndustry: companyTagLine(tagLine).companyIndustry,
    companyTagText: tagLine,
    city,
    salary,
    ...expEdu,
    description: description ? plain(description) : undefined,
    companyIntro: intro ? plain(intro) : introAfterHeading(pageText(html)),
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
    companyIntro: introAfterHeading(pageText(html)),
    url: pageUrl,
  });
}

/** 51job cards keep the job record as entity-encoded JSON in a sensorsdata attribute. */
function sensorsData(chunk: string): Record<string, unknown> {
  const raw = chunk.match(/sensorsdata="([^"]*)"/)?.[1];
  if (!raw) return {};
  try {
    const data = JSON.parse(decodeEntities(raw)) as unknown;
    return isRecord(data) ? data : {};
  } catch {
    return {};
  }
}

function parseJob51Search(html: string, pageUrl: string, now: number): JobPosting[] {
  const jobs: JobPosting[] = [];
  for (const chunk of splitChunks(html, 'class="joblist-item"')) {
    const data = sensorsData(chunk);
    // The last chunk runs to the end of the page, so a link counts only when it carries this card's jobId.
    const links = [...chunk.matchAll(/href="((?:https:)?\/\/jobs\.51job\.com\/[a-z0-9-]+\/(\d+)\.html)[^"]*"/g)];
    const id = asString(data.jobId) ?? (typeof data.jobId === "number" ? String(data.jobId) : undefined);
    const href = (id ? links.find(link => link[2] === id)?.[1] : links[0]?.[1]) ?? job51DetailUrl(data.jobId, data.jobArea);
    if (!href) continue;
    const labels = [textByClass(chunk, "exp"), textByClass(chunk, "edu"), asString(data.jobYear), asString(data.jobDegree)].filter((item): item is string => !!item);
    const tags = [...chunk.matchAll(/class="[^"]*\bdc\b[^"]*"[^>]*>([^<]+)</g)].map(match => decodeEntities(match[1]).trim());
    const job = posting({
      board: "job51",
      title: textByClass(chunk, "jname") || asString(data.jobTitle),
      company: textByClass(chunk, "cname") || asString(data.companyName),
      companyIndustry: tags.find(tag => !/\d.*人|公司$|企业$/.test(tag)),
      companyTagText: tags.join(" ") || undefined,
      city: asString(data.jobArea) || blockText(chunk, "area"),
      salary: visibleSalary(textByClass(chunk, "sal") || asString(data.jobSalary)),
      ...pickExpEdu(labels),
      url: absUrl(href, pageUrl),
      ...jobTime(asString(data.jobTime), "published", now),
    });
    if (job) jobs.push(job);
  }
  return jobs;
}

function parseJob51Detail(html: string, pageUrl: string, now: number): JobPosting | undefined {
  const header = html.match(/class="[^"]*\btHeader\b[^"]*"[\s\S]*?(?=class="[^"]*\b(?:tCompany_main|tCompany_center|tBorderTop_box)\b|$)/)?.[0] ?? "";
  const title = header.match(/<h1\b[^>]*?(?:title="([^"]+)")?[^>]*>([\s\S]*?)<\/h1>/);
  const ltype = header.match(/class="[^"]*\bmsg ltype\b[^"]*"[^>]*title="([^"]+)"/)?.[1];
  const parts = [
    ...(ltype ? decodeEntities(ltype).split(/\s*[|｜]\s*/) : []),
    ...[...header.matchAll(/class="sp4"[^>]*>([^<]+)</g)].map(match => decodeEntities(match[1])),
  ].map(item => item.trim()).filter(Boolean);
  const expEdu = pickExpEdu(parts);
  const published = parts.find(part => /发布$/.test(part));
  const city = parts.find(part => part !== expEdu.experience && part !== expEdu.education && part !== published && !/招.*人/.test(part));
  const jd = html.match(/class="[^"]*\bbmsg job_msg\b[^"]*"[^>]*>([\s\S]*?)(?:<div class="mt10"|<div class="share"|<\/div>)/)?.[1];
  const intro = html.match(/class="[^"]*\btmsg inbox\b[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1];
  const companyTags = [...html.matchAll(/class="[^"]*\bcom_tag\b[^"]*"[\s\S]*?<\/div>/g)].flatMap(block =>
    [...block[0].matchAll(/<p\b[^>]*class="at"[^>]*>([\s\S]*?)<\/p>/g)].map(match => plain(match[1]).trim()));
  return posting({
    board: "job51",
    title: title ? decodeEntities(title[1] ?? plain(title[2])).trim() : undefined,
    company: textByClass(html, "catn"),
    companyIndustry: companyTags.filter(tag => !/\d.*人|公司$|企业$/.test(tag)).join(" ") || undefined,
    companyTagText: companyTags.join(" ") || undefined,
    companyIntro: intro ? plain(intro) : undefined,
    city,
    salary: visibleSalary(header.match(/<strong[^>]*>([^<]+)<\/strong>/)?.[1]),
    ...expEdu,
    description: jd ? plain(jd) : undefined,
    url: pageUrl,
    ...jobTime(published, "published", now),
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
    companyIndustry: asString(node.industry),
    city,
    salary: salaryFromLd(node.baseSalary),
    experience: asString(node.experienceRequirements),
    education: asString(node.educationRequirements),
    description: asString(node.description),
    ...jobTime(asString(node.dateModified) || asString(node.datePosted), asString(node.dateModified) ? "updated" : "published"),
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
      companyIndustry: [asString(item.industryName), isRecord(item.companySize) ? asString(item.companySize.name) : asString(item.companySize)].filter(Boolean).join(" ") || undefined,
      city,
      salary: asString(item.salary),
      experience: exp,
      education: edu,
      description: asString(item.jobSummary),
      ...positionTime(item, Date.now()),
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
