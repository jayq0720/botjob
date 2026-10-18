# botjob

求职助手 Agent：上传简历 → 分析画像 → 在智联招聘 / 猎聘 / 前程无忧(51job) / BOSS直聘搜索或打分 → 写打招呼语和求职信 → 本机半自动投递。

## 能力

| 步骤 | 说明 |
| --- | --- |
| 1. 上传简历 | 粘贴全文、workspace 路径、PDF，或 png/jpg。文本层 PDF 直接抽取；没有文本层的 PDF 和图片走 OCR |
| 2. 分析简历 | Agent 提炼目标岗位 / 技能 / 城市 / 年限 / 学历 / 薪资，`save_resume_profile` 落库 |
| 3. 搜岗打分 | `search_jobs` 生成四站搜索深链，并在页面公开可读时抓取职位名、公司、薪资、城市、经验、学历、JD 正文和详情 URL，再按简历打 0–100 分。抓不到就返回原因，不编数据。用户也可以把 JD 文本或岗位 URL 交给 `score_job` |
| 4. 话术 | Agent 按 skill 写约 150 字打招呼语和一封求职信，`save_cover_letter` 只负责保存 |
| 5. 投递 | `queue_apply` **需用户批准** → `export_apply_pack` → 本机 `npm run apply:local` 半自动打开浏览器，逐岗确认 |
| 6. 回写 | 本地 runner 写出 `.results.json` 后，`mark_applied` 更新会话状态 |

打分结果存在会话里，`list_applications` / `queue_apply` 会带上分数和分项（技能命中/缺失、年限、学历、城市、薪资）。

## 为什么是「本机半自动」而不是云端代投

智联 / 猎聘 / 51job / BOSS直聘没有对第三方开放的稳定公开投递 API，且登录、验证码与平台条款不允许无人值守代投。本项目采用：

- **可自动**：简历解析（含 OCR）、画像、四站搜索链接、公开页面抓取、打分、话术存档、投递队列、导出 pack
- **本机半自动**：Playwright 使用你自己的浏览器配置目录（默认 `~/.botjob/browser-profile`），每个岗位必须你按键确认
- **禁止**：云端静默登录、绕过验证码、无人值守批量代投、代按 BOSS「发送」

BOSS直聘主要是「立即沟通」。`apply:local` 可以显示打招呼语、复制到剪贴板，或在你确认后填进输入框（填入本身不按发送键）。在 BOSS 上点「立即沟通」之前，脚本会提示：点击可能会立即发送平台默认招呼语。确认后才点击。只打开四个招聘站的 https 链接。

### 本机半自动投递

```bash
npm install
npx playwright install chromium
npm run apply:local -- --pack fixtures/sample-apply-pack-boss.json --dry-run
npm run apply:local -- --pack fixtures/sample-apply-pack.json
```

按键：`a` 已投递 · `c` 尝试点申请或「立即沟通」（仍需再确认）· `f` 填入打招呼语（不发送）· `p` 复制打招呼语 · `l` 复制求职信 · `s` 跳过 · `q` 退出。  
结果写入同目录 `*.results.json`，再让 agent 调用 `mark_applied`。

## OCR

扫描件 PDF（没有文本层）和 png/jpg 简历使用 [tesseract.js](https://github.com/naptha/tesseract.js)，语言包是 `@tesseract.js-data/chi_sim` 与 `@tesseract.js-data/eng`（随 `npm install` 安装，运行时不下载）。识别前会把两份 `4.0.0_best_int` 语言包复制到临时目录。

限制：

- PDF / 图片最大 8MB
- OCR 最多 5 页
- 识别结果少于 20 字会报错，请改贴文本
- 不支持 webp / gif

仓库里的扫描件样例：`fixtures/sample-resume-scan.pdf`、`fixtures/sample-resume-scan.png`。

## 抓取限制

只请求这四个站的 https 页面，不带登录态，不处理验证码。常见结果：

- **猎聘**城市搜索页（如 `/city-sh/zhaopin/?key=`）和职位详情页经常能直接解析
- **智联** `sou.zhaopin.com` 有时直接返回人机验证；Node 跟随跳转后，`www.zhaopin.com/sou` 的搜索页和职位详情页可以解析。公开搜索接口 `fe-api.zhaopin.com` 仍可能返回空列表。未登录时详情页薪资会打码，这时保留列表里的薪资
- **51job** 常见阿里云 WAF 页面
- **BOSS** 常见跳到 `security.html`，职位列表接口返回「环境异常」

这些都会写进 `fetches` / `score_job` 的失败原因。页面结构变化时同样报解析失败，而不是补假数据。

## 本地运行

```bash
npm install
npx @cursor/bdk login          # 模型回合需要 Cursor 凭证
npx @cursor/bdk validate --dir .
npx @cursor/bdk info --dir . --json
npx @cursor/bdk call save_resume --dir . --input '{"text":"...至少40字的简历...","filename":"me.txt"}'
npm run check                  # tsc --noEmit
npm test                       # 单元测试，不访问招聘网站
npx @cursor/bdk dev            # http://127.0.0.1:3000/playground
```

`bdk eval` 需要 API key，CI 里没有 key 时会跳过。

仓库自带示例 PDF：`fixtures/sample-resume.pdf`。

Playground 对话示例：

> 下面是我的简历，请分析并在智联、猎聘、51job、BOSS 帮我找前端岗位。这是 JD：…

## 工具一览

- `save_resume` / `get_resume` / `save_resume_profile`
- `search_jobs` / `score_job` / `save_cover_letter`
- `queue_apply`（需审批）/ `export_apply_pack` / `mark_applied` / `list_applications`

## 项目结构

```
bot/
  instructions.md
  tools/           # 一个工具一个文件
  lib/boards/      # 四站搜索 URL、HTML/JSON 解析、抓取
  lib/score.ts     # 打分
  lib/ocr.ts       # 扫描件 OCR
  skills/job-hunt/ # 打招呼语和求职信的写法
scripts/local-apply.ts
fixtures/
evals/
tests/
```
