---
name: job-hunt
description: >-
  End-to-end job hunt: save resume, analyze profile, search and score
  智联/猎聘/51job/BOSS, write a greeting and cover letter, queue applications
  with user approval.
---

# Job hunt

## When to use

User wants to upload a resume, find roles, score a JD, or apply on Chinese job boards.

## Steps

1. `save_resume` with plain `text`, PDF (`pdfBase64` / `.pdf` path), or a png/jpg.
2. Analyze the text, then `save_resume_profile` (titles, skills, cities, years, education, salary, keywords).
3. `search_jobs` — share each `searchPacks[].searchUrl`. Quote `fetches[].message` when a board fails. Only talk about jobs in `listings`.
4. If the user pastes a JD or a job URL, call `score_job` instead of guessing.
5. For each job they might apply to, write the greeting and cover letter below, then `save_cover_letter`.
6. `queue_apply` (approval required) → `export_apply_pack` → give `localCommand`.
7. After the local runner finishes, `mark_applied`.

## Greeting and cover letter

Host code only stores what you write. You write it.

打招呼语（BOSS / 猎聘聊天框）：

- 第一人称，150 字以内。
- 点明岗位，并用简历里真实的 1–2 个技能或经历对齐 JD。
- 不写「尊敬的领导」，不堆形容词，不承诺已经投递。
- 结尾是想沟通，不是「已发送」。

求职信：

- 三段：为什么这个岗位、匹配证据（只来自简历和 JD）、收尾。
- 不编造简历里没有的公司、年限或项目。
- 大约 200–500 字。

## Local runner

```bash
npx playwright install chromium
npm run apply:local -- --pack apply-packs/pack-….json
npm run apply:local -- --pack fixtures/sample-apply-pack-boss.json --dry-run
```

Keys: `a` applied, `c` click 申请/立即沟通 (confirm again), `f` fill greeting without sending, `p` copy greeting, `l` copy the letter, `s` skip, `q` quit.

## Do not

- Invent listings when `fetches` says captcha, login, blocked, or empty.
- Claim a message was sent on BOSS. The runner never presses send by itself.
- Ask for job-board passwords or explain how to bypass a captcha.
- Search or score before a profile exists.
