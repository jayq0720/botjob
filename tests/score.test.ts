import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseEducation,
  parseSalary,
  parseYears,
  scoreJob,
  textMentionsSkill,
} from "../bot/lib/score.js";
import type { ResumeProfile } from "../bot/lib/store.js";

const profile: ResumeProfile = {
  summary: "6年前端，带过小组，熟悉 React 和 TypeScript。",
  yearsExperience: 6,
  education: "本科",
  currentTitle: "前端负责人",
  targetTitles: ["高级前端工程师"],
  skills: ["React", "TypeScript", "Node.js", "性能优化"],
  cities: ["上海"],
  industries: [],
  salaryExpectation: "40-50K",
  strengths: [],
  gaps: [],
  keywords: ["前端"],
  updatedAt: "2026-10-18T00:00:00.000Z",
};

test("skill aliases do not treat Java as JavaScript", () => {
  assert.equal(textMentionsSkill("需要 Java 后端", "JavaScript"), false);
  assert.equal(textMentionsSkill("熟悉 JavaScript 与 Node.js", "Node.js"), true);
});

test("years, education, and salary parsers", () => {
  assert.deepEqual(parseYears("3-5年"), { min: 3, max: 5 });
  assert.deepEqual(parseYears("经验不限"), { unlimited: true });
  assert.equal(parseEducation("统招本科")?.label, "本科");
  assert.equal(parseEducation("学历不限")?.unlimited, true);
  assert.deepEqual(parseSalary("20-30k·14薪"), { minK: 20, maxK: 30 });
  assert.deepEqual(parseSalary("15k-25k"), { minK: 15, maxK: 25 });
  assert.equal(parseSalary("面议")?.negotiable, true);
  assert.equal(parseYears("公司成立10年"), undefined);
  assert.deepEqual(parseYears("公司成立10年，要求3年以上"), { min: 3 });
});

test("frontend JD scores higher than an unrelated sales JD", () => {
  const frontend = scoreJob(profile, {
    title: "高级前端工程师",
    city: "上海",
    salary: "25-40K",
    experience: "3-5年",
    education: "本科",
    description: "负责交易前台，要求熟悉 React、TypeScript、Node.js，有性能优化经验。",
  });
  const sales = scoreJob(profile, {
    title: "外滩豪宅销售",
    city: "上海-虹口区",
    salary: "20-30k",
    experience: "经验不限",
    education: "学历不限",
    description: "高提成销售岗位，学历不限，经验不限。",
  });
  assert.ok(frontend.total >= 80);
  assert.ok(sales.total < frontend.total);
  assert.ok(frontend.skills.hit.includes("React"));
  assert.equal(frontend.city.score, 15);
  assert.match(sales.salary.note, /高于/);
  assert.equal(frontend.total, frontend.skills.score + frontend.years.score + frontend.education.score + frontend.city.score + frontend.salary.score);
  const withTests = scoreJob(profile, {
    title: "前端工程师",
    city: "上海",
    salary: "25-40K",
    experience: "3-5年",
    education: "本科",
    description: "负责业务开发，并编写单元测试。要求 React。",
  });
  assert.equal(withTests.skills.missing.includes("测试"), false);
  const founded = scoreJob(profile, {
    title: "前端工程师",
    city: "上海",
    description: "公司成立10年。负责 React 开发。",
  });
  assert.equal(founded.years.note, "未写年限要求");
});
