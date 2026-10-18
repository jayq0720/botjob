import type { ResumeProfile } from "./store.js";

export type ScorePart = {
  score: number;
  max: number;
  note: string;
};

export type ScoreBreakdown = {
  total: number;
  summary: string;
  skills: ScorePart & { hit: string[]; missing: string[] };
  years: ScorePart & { required?: string; have?: number };
  education: ScorePart & { required?: string; have?: string };
  city: ScorePart & { required?: string; have?: string[] };
  salary: ScorePart & { required?: string; have?: string };
};

export type ScoreTarget = {
  title?: string;
  description?: string;
  city?: string;
  salary?: string;
  experience?: string;
  education?: string;
};

const ALIAS_GROUPS: string[][] = [
  ["javascript", "js"],
  ["typescript", "ts"],
  ["nodejs", "node"],
  ["react", "reactjs"],
  ["vue", "vuejs"],
  ["nextjs", "next"],
  ["springboot", "spring"],
  ["golang", "go"],
  ["csharp", "c#"],
  ["postgresql", "postgres"],
  ["kubernetes", "k8s"],
];

/** Terms we treat as explicit JD skills when they show up in the posting. */
const LEXICON = [
  "React",
  "Vue",
  "Angular",
  "TypeScript",
  "JavaScript",
  "Node.js",
  "Java",
  "Go",
  "Python",
  "PHP",
  "C#",
  "Kotlin",
  "Swift",
  "Rust",
  "Spring Boot",
  "MySQL",
  "PostgreSQL",
  "Redis",
  "MongoDB",
  "Kafka",
  "Docker",
  "Kubernetes",
  "Webpack",
  "HTML",
  "CSS",
  "Next.js",
  "NestJS",
  "GraphQL",
  "Elasticsearch",
  "Linux",
  "Nginx",
  "Git",
  "SQL",
  "Android",
  "iOS",
  "Flutter",
  "小程序",
  "微服务",
  "前端",
  "后端",
  "全栈",
  "算法",
  "产品",
  "运营",
  "销售",
  "性能优化",
  "工程化",
];

const CN_NUM: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export type YearReq = { min?: number; max?: number; unlimited?: boolean };

export function canonSkill(skill: string): string {
  let s = skill.trim().toLowerCase().replace(/\s+/g, "");
  if (s.endsWith(".js")) s = s.slice(0, -3);
  s = s.replace(/\./g, "");
  for (const group of ALIAS_GROUPS) {
    if (group.includes(s)) return group[0];
  }
  return s;
}

function asciiIncludes(text: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9+#])${escaped}(?:$|[^a-z0-9+#])`, "i").test(
    text,
  );
}

export function textMentionsSkill(text: string, skill: string): boolean {
  const raw = skill.trim();
  if (!raw) return false;
  if (/[\u4e00-\u9fff]/.test(raw)) return text.includes(raw);
  const canon = canonSkill(raw);
  const group = ALIAS_GROUPS.find((g) => g[0] === canon) ?? [canon];
  return group.some((token) => asciiIncludes(text, token));
}

export function parseYears(text: string | undefined): YearReq | undefined {
  if (!text) return undefined;
  const cleaned = text.replace(/(?:成立|创办|创立|注册)\s*\d+\s*年/g, " ");
  if (/经验不限|不限经验|年限不限|应届|在校/.test(cleaned)) return { unlimited: true };
  const range = cleaned.match(/(\d+)\s*[-~到至]\s*(\d+)\s*年/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const plus = cleaned.match(/(\d+)\s*年(?:以上|及以上|\+)/);
  if (plus) return { min: Number(plus[1]) };
  const under = cleaned.match(/(\d+)\s*年(?:以内|以下)/);
  if (under) return { max: Number(under[1]) };
  const cn = cleaned.match(/([一二两三四五六七八九十])\s*年(?:以上|及以上)/);
  if (cn) return { min: CN_NUM[cn[1]] };
  const plain = cleaned.match(/(\d+)\s*年/);
  if (plain) return { min: Number(plain[1]), max: Number(plain[1]) };
  return undefined;
}

const EDU_LEVELS: Array<{ rank: number; re: RegExp; label: string }> = [
  { rank: 6, re: /博士/, label: "博士" },
  { rank: 5, re: /硕士|研究生/, label: "硕士" },
  { rank: 4, re: /本科|学士/, label: "本科" },
  { rank: 3, re: /大专|专科/, label: "大专" },
  { rank: 2, re: /高中|中专/, label: "高中" },
];

export function parseEducation(
  text: string | undefined,
): { rank: number; label: string; unlimited?: boolean } | undefined {
  if (!text) return undefined;
  if (/不限|无要求|不要求|无硬性/.test(text)) {
    return { rank: 0, label: "不限", unlimited: true };
  }
  const found = EDU_LEVELS.filter((level) => level.re.test(text));
  if (found.length === 0) return undefined;
  return found.reduce((min, level) => (level.rank < min.rank ? level : min));
}

export function parseSalary(
  text: string | undefined,
): { minK: number; maxK: number; negotiable?: boolean } | undefined {
  if (!text) return undefined;
  if (/面议/.test(text)) return { minK: 0, maxK: 0, negotiable: true };
  const kBoth = text.match(
    /(\d+(?:\.\d+)?)\s*[kK]\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*[kK]/,
  );
  if (kBoth) return { minK: Number(kBoth[1]), maxK: Number(kBoth[2]) };
  const k = text.match(/(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*[kK]/);
  if (k) return { minK: Number(k[1]), maxK: Number(k[2]) };
  const wan = text.match(
    /(\d+(?:\.\d+)?)\s*[-~到至]\s*(\d+(?:\.\d+)?)\s*万/,
  );
  if (wan) {
    const yearly = /年/.test(text) && !/月/.test(text);
    const scale = yearly ? 10 / 12 : 10;
    return {
      minK: Number(wan[1]) * scale,
      maxK: Number(wan[2]) * scale,
    };
  }
  const yuan = text.match(/(\d{4,6})\s*[-~到至]\s*(\d{4,6})/);
  if (yuan) {
    return { minK: Number(yuan[1]) / 1000, maxK: Number(yuan[2]) / 1000 };
  }
  return undefined;
}

function clamp(n: number, max: number): number {
  return Math.max(0, Math.min(max, Math.round(n)));
}

function jobText(job: ScoreTarget): string {
  return [job.title, job.description, job.experience, job.education, job.city]
    .filter(Boolean)
    .join("\n");
}

export function scoreJob(
  profile: ResumeProfile,
  job: ScoreTarget,
): ScoreBreakdown {
  const text = jobText(job);
  const skills = scoreSkills(profile, text, Boolean(job.description));
  const years = scoreYears(profile, job.experience, job.description);
  const education = scoreEducation(profile, job.education, job.description);
  const city = scoreCity(profile, job.city);
  const salary = scoreSalary(profile, job.salary);
  const total = clamp(
    skills.score + years.score + education.score + city.score + salary.score,
    100,
  );
  const summary = [
    `综合 ${total} 分`,
    `技能 ${skills.score}/${skills.max}（命中 ${skills.hit.join("、") || "无"}；缺失 ${skills.missing.join("、") || "无"}）`,
    years.note,
    education.note,
    city.note,
    salary.note,
  ].join("。");
  return { total, summary, skills, years, education, city, salary };
}

function scoreSkills(
  profile: ResumeProfile,
  text: string,
  hasDescription: boolean,
): ScoreBreakdown["skills"] {
  const max = 40;
  const mine = profile.skills.map((s) => s.trim()).filter(Boolean);
  if (mine.length === 0) {
    return {
      score: 0,
      max,
      hit: [],
      missing: [],
      note: "简历未填技能",
    };
  }
  const hit = mine.filter((skill) => textMentionsSkill(text, skill));
  const profileCanons = new Set(mine.map(canonSkill));
  const missing = LEXICON.filter(
    (term) =>
      textMentionsSkill(text, term) && !profileCanons.has(canonSkill(term)),
  ).slice(0, 8);
  const jdTerms = LEXICON.filter((term) => textMentionsSkill(text, term));
  const hitRatio = hit.length / mine.length;
  const coverRatio = jdTerms.length
    ? (jdTerms.length - missing.length) / jdTerms.length
    : hitRatio;
  const score = clamp(max * (0.6 * hitRatio + 0.4 * coverRatio), max);
  const limited = hasDescription ? "" : "未抓到 JD 正文，只按已有字段比较。";
  return {
    score,
    max,
    hit,
    missing,
    note: `${limited}命中 ${hit.length}/${mine.length}`,
  };
}

function scoreYears(
  profile: ResumeProfile,
  experience: string | undefined,
  description: string | undefined,
): ScoreBreakdown["years"] {
  const max = 20;
  const req = parseYears(experience) ?? parseYears(description);
  const required = experience || (req ? "见 JD 正文" : undefined);
  if (!req) {
    return { score: max, max, required, have: profile.yearsExperience, note: "未写年限要求" };
  }
  if (req.unlimited) {
    return { score: max, max, required: required ?? "经验不限", have: profile.yearsExperience, note: "经验不限" };
  }
  if (profile.yearsExperience === undefined) {
    return { score: 8, max, required, note: "简历未填工作年限" };
  }
  const have = profile.yearsExperience;
  if (req.min !== undefined && have < req.min) {
    return {
      score: clamp(max * (have / req.min), max),
      max,
      required,
      have,
      note: `年限低于要求（简历 ${have} 年，要求 ${req.min} 年起）`,
    };
  }
  if (req.max !== undefined && have > req.max + 2) {
    return {
      score: 16,
      max,
      required,
      have,
      note: `年限高于要求上限（简历 ${have} 年，要求 ${req.max} 年以内）`,
    };
  }
  return {
    score: max,
    max,
    required,
    have,
    note: `年限符合（简历 ${have} 年）`,
  };
}

function scoreEducation(
  profile: ResumeProfile,
  education: string | undefined,
  description: string | undefined,
): ScoreBreakdown["education"] {
  const max = 15;
  const req = parseEducation(education) ?? parseEducation(description);
  const have = profile.education;
  if (!req) {
    return { score: max, max, have, note: "未写学历要求" };
  }
  if (req.unlimited) {
    return { score: max, max, required: education ?? "学历不限", have, note: "学历不限" };
  }
  if (!have) {
    return { score: 6, max, required: education ?? req.label, note: "简历未填学历" };
  }
  const got = parseEducation(have);
  if (!got || got.unlimited) {
    return { score: 6, max, required: education ?? req.label, have, note: "简历学历无法对照" };
  }
  if (got.rank >= req.rank) {
    return { score: max, max, required: education ?? req.label, have, note: "学历符合" };
  }
  return {
    score: clamp(max * (got.rank / req.rank), max),
    max,
    required: education ?? req.label,
    have,
    note: `学历低于要求（简历 ${have}，要求 ${req.label}）`,
  };
}

function cityKey(value: string): string {
  return value.replace(/市$/, "").split(/[-·/／]/)[0]?.trim() ?? value;
}

function scoreCity(
  profile: ResumeProfile,
  city: string | undefined,
): ScoreBreakdown["city"] {
  const max = 15;
  const have = profile.cities;
  if (!city || /全国|不限|远程/.test(city)) {
    return { score: max, max, required: city, have, note: city ? `城市要求为${city}` : "未写城市" };
  }
  if (have.length === 0) {
    return { score: 6, max, required: city, have, note: "简历未填城市" };
  }
  const want = cityKey(city);
  const matched = have.some((item) => {
    const key = cityKey(item);
    return key && (want.includes(key) || key.includes(want) || /远程/.test(item));
  });
  return matched
    ? { score: max, max, required: city, have, note: "城市匹配" }
    : { score: 0, max, required: city, have, note: "城市不一致" };
}

function scoreSalary(
  profile: ResumeProfile,
  salary: string | undefined,
): ScoreBreakdown["salary"] {
  const max = 10;
  const have = profile.salaryExpectation;
  const posted = parseSalary(salary);
  const expected = parseSalary(have);
  if (!posted || posted.negotiable) {
    return {
      score: max,
      max,
      required: salary,
      have,
      note: salary ? "岗位薪资面议或未写区间" : "未写薪资",
    };
  }
  if (!expected || expected.negotiable) {
    return { score: max, max, required: salary, have, note: "简历未填可比较的期望薪资，不扣分" };
  }
  const overlap = expected.minK <= posted.maxK && posted.minK <= expected.maxK;
  if (overlap) {
    return { score: max, max, required: salary, have, note: "薪资区间有重叠" };
  }
  if (expected.minK > posted.maxK) {
    return { score: 3, max, required: salary, have, note: "期望高于岗位上限" };
  }
  return { score: 6, max, required: salary, have, note: "期望低于岗位下限" };
}
