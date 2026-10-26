---
name: botjob
description: >
  用本机 botjob MCP 完成求职：保存简历和画像，搜索或打分智联、猎聘，
  撰写并保存打招呼语和求职信，经用户确认后批准并导出投递包。
  用户要找工作、分析简历、给 JD 打分或准备投递时使用。
---

# botjob 求职流程

服务器保存状态、做校验，并可在用户确认后通过本机浏览器投递。岗位文案、打招呼语、求职信由你写。不要编造职位、公司或 JD。搜索登录通过 open_job_login 打开用户本机浏览器；投递由 apply_jobs 在确认后执行，不自动发送聊天消息。

## 调用顺序

先调用 `get_workspace` 恢复求职进度，再用 `list_jobs` 读取已有候选池。不要在新对话中重复要求已有简历。根据用户意图继续相应阶段，模型负责分析、比较和写作，服务器保存证据和状态。匹配分仅是规则参考，不是录用概率。

1. `save_resume`：简历全文、本机路径（PDF / 扫描件 / png / jpg / txt），或 base64。四选一。
2. 阅读简历，调用 `save_resume_profile`（目标岗位、技能、城市、年限、学历、薪资、关键词）。
3. `search_jobs` 展示各站搜索链接。只讨论 `listings` 里的真实岗位；`fetches` 的失败原因原样告诉用户。用户贴了 JD 或岗位链接时改用 `score_job`。已有详情 HTML 时把 HTML 和该站 https 链接一起交给 `score_job`，这样不会访问网络。
4. 对准备投的岗位写打招呼语和求职信，再 `save_cover_letter`。
5. `queue_apply`。此时状态是 `queued`，还没批准。
6. 一键模式使用 `apply_jobs`（见下方），无需执行第7步的导出。手动模式把岗位、链接、打招呼语、求职信给用户看。用户明确同意后调用 `approve_apply`。工具会用 MCP elicitation 再确认，弹窗里有求职信；只批准弹窗列出的申请，话术或链接变了就不批。客户端不支持 elicitation 时，先调用一次读取 `snapshotHash`，用户已经同意后再传 `confirm: true` 和这个哈希。不要只传 `confirm`。没有弹窗时，你仍可能自行回传哈希，那不是用户点选；能用 elicitation 就用 elicitation。
7. `export_apply_pack`。没批准的岗位不会出现在包里。把返回的 `localCommand` 交给用户，让用户在 botjob 仓库里自己运行。
8. 用户跑完 `npm run apply:local` 后，用 `mark_applied` 回写。

状态在 `~/.botjob/data/`，可用 `BOTJOB_HOME` 改家目录。用 `get_resume` 和 `list_applications` 回答进度。

## 接入

在已安装依赖的仓库里运行：

```bash
node bin/botjob-mcp.js --check
node bin/botjob-mcp.js --config cursor
node bin/botjob-mcp.js --config claude-desktop
node bin/botjob-mcp.js --config claude-code
node bin/botjob-mcp.js --config codex
```

将需要的配置合并进对应客户端 MCP 配置。生成的配置使用当前 Node 与入口的绝对路径，不依赖客户端工作目录。无参数运行启动 stdio 服务。模型由客户端提供，无需 Cursor API key。不要把 `npm run mcp` 配入客户端，它会污染 stdout。

## 链接

只接受智联 `zhaopin.com`、猎聘 `liepin.com` 的 https 链接，而且域名必须和 `board` 一致。其它链接请用户贴 JD 正文。

## 打招呼语和求职信

打招呼语（猎聘聊天框）：

- 第一人称，150 字以内，最多 200。
- 点明岗位，并用简历里真实的 1–2 个技能或经历对齐 JD。
- 不写「尊敬的领导」，不堆形容词，不承诺已经投递。
- 结尾是想沟通，不是「已发送」。

求职信：

- 三段：为什么这个岗位、匹配证据（只来自简历和 JD）、收尾。
- 不编造简历里没有的公司、年限或项目。
- 大约 200–500 字。

已批准或已投递的申请不能靠 `save_cover_letter` 改话术。`queued`、`approved`、`submitted_manual` 再次 `queue_apply` 只返回原记录，不会改回 queued，也不会改掉已批准的话术。`failed` 或 `skipped` 会另开一条 `queued`，使用最新话术，并需要重新审批；旧记录保留。

## 本机投递

`export_apply_pack` 的 `localCommand` 类似：

```bash
npm run apply:local -- --pack <pack.json>
```

按键：`a` 已投递，`c` 尝试点申请或「立即沟通」（仍需再确认），`f` 填入打招呼语但不发送，`p` 复制打招呼语，`l` 复制求职信，`s` 跳过，`q` 退出。

点击投递前必须再次确认。不要说已经在云端投递成功。

## 不要

- 抓取失败时编造公司和 JD，或用示例公司冒充真实岗位。
- 在用户确认前调用 `approve_apply`，或在不支持 elicitation 时自己填 `confirm: true` 和 `snapshotHash`。
- 索要招聘网站密码，或解释如何绕过验证码。
- 没有画像就搜岗、打分。

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
