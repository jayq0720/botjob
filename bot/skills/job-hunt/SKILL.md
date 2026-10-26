---
name: job-hunt
description: >-
  End-to-end job hunt: save resume, analyze profile, search and score
  智联/猎聘, write a greeting and cover letter, queue applications
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
6. MCP one-click: `queue_apply` → `apply_jobs` preview → one batch confirmation → execute. Manual/BDK: approval → `export_apply_pack` → give `localCommand`.
7. After the local runner finishes, `mark_applied`.

## Greeting and cover letter

Host code only stores what you write. You write it.

打招呼语（猎聘聊天框）：

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
npm run apply:local -- --pack fixtures/sample-apply-pack-liepin.json --dry-run
```

Keys: `a` applied, `c` click 申请/立即沟通 (confirm again), `f` fill greeting without sending, `p` copy greeting, `l` copy the letter, `s` skip, `q` quit.

## Do not

- Invent listings when `fetches` says captcha, login, blocked, or empty.
- Claim a message was sent automatically. The runner never presses send by itself.
- Ask for job-board passwords or explain how to bypass a captcha.
- Search or score before a profile exists.

搜索支持智联、猎聘、前程无忧（前程无忧需 accessMode=browser），固定最近72小时。优先核验岗位更新时间，无更新字段时用发布时间；无法确认时间的岗位不展示。说明返回的来源时间及类型，不把招聘者活跃时间或网页刷新时间当作岗位更新。

岗位展示：`listings` 里每个岗位都按这个格式给用户看，不要只列标题：
- **岗位名｜公司｜城市｜薪资｜来源时间**，附完整链接和匹配分。
- **岗位简介**：根据 `description` 用两三句话概括主要职责和硬性要求（年龄、带团队人数、行业等）；JD 未抓到（`jdStatus=list_only`）就写“未抓到 JD 正文”。
- **公司简介**：`companyIndustry`、`companySize`、`companyStage` 加上 `companyIntro` 的一两句概括；网站没提供的字段写“网站未提供”，不要凭公司名补充或猜测。
- 展示后调用 `open_job_list`（带上你写的 jobSummary / companySummary），让用户在本机页面勾选岗位并点「一键投递所选岗位」。页面点击即用户确认，不要替用户打开或操作该页面。


公司限制：排除保险公司与劳务派遣公司的岗位。服务器按来源中的公司名、行业证据先过滤，并返回排除数量；不可将 JD 中的五险一金、社会保险或 HR 管理派遣员工的职责当成雇主性质。`employerReview=needs_review` 必须结合公司信息核实后才推荐，无法确认则暂不推荐。人力资源/猎头公司不等于劳务派遣公司；根据证据判断，禁止猜测。

登录继续：`search_jobs.userActions` 出现 `login_required` 时，明确告诉用户哪一站需要登录，并调用 `open_job_login(board, url)`。该工具打开运行 MCP 的电脑上的浏览器，支持 elicitation 的客户端会弹出“我已完成登录”提示；不支持时在聊天中等待用户确认。用户自行登录或验证，确认后用原条件和 `accessMode: "browser"` 重新搜索。用户取消、未回复或超时都不能当作已登录；登录后仍受限继续提示，不绕过。验证码/风控需明确说明，并让用户在网站手动处理。不要索要密码、验证码或 Cookie。云端无交互桌面时明确说明需将 MCP 运行在用户电脑上，不能声称已经打开用户浏览器。

默认每站最多5条，`limitPerBoard` 可增至20；`fetches[].limits` 是程序读取上限，不能据此说账号权限不足，也不能承诺登录后必定有更多岗位。登录搜索仍执行72小时和公司排除规则。

`pendingEmployerReview` 单独保留公司性质待核实的来源记录，不计入已筛选岗位 `listings`，不推荐、不自动入候选池；取得公司性质证据排除保险/劳务派遣后才可推荐。


## 一键投递（MCP）

用户选定岗位后先 `queue_apply` 取得申请 id，再调用 `apply_jobs(ids)` 预览。向用户说明公司、岗位、链接及投递材料：使用招聘网站当前账号选用的简历（含联系方式），不会自动上传本地 PDF，也不会自动发送保存的话术/求职信。请用户在网站核对账号及简历。

调用 `apply_jobs(ids, execute: true)`，支持 elicitation 的客户端一次确认整批岗位，随后自动依次尝试点击申请。无需先调用 approve_apply 或导出包。客户端不支持弹窗时，等待用户明确确认，再带 `execute: true, confirm: true, snapshotHash` 调用；不要自行把工具调用或哈希当作用户确认。

复用 `open_job_login` 的本机浏览器登录态。首次登录、验证码、必填表单、只有“聊一聊”、按钮不唯一等情况暂停并说明，不猜答案、不绕过。只自动点击有明确证据的申请/投递按钮；不自动操作聊天发送或后续确认表单。网站明确显示成功才标为 `submitted_auto`；点击后无法确认标为 `submission_unknown`，必须人工核对，不能直接重试。用户核对实际投递记录后可用 `mark_applied` 回写结果。其余未点击申请回到 queued，完成登录/补填后重新预览确认。

每批最多10条；执行前继续检查公司限制、72小时来源时间和岗位身份。已投递、执行中或结果未知的岗位不能重复入队；已确认的材料不能被覆盖。`apply_jobs` 只在运行 MCP 的有桌面电脑执行，云端无交互浏览器时明确报告不可用；开发测试不能声称已替用户投递。
