# botjob

求职助手 Agent：上传简历 → 分析画像 → 在智联招聘 / 猎聘 / 前程无忧(51job) 搜索合适岗位并准备投递。

## 能力

| 步骤 | 说明 |
| --- | --- |
| 1. 上传简历 | 粘贴全文、workspace 文件路径，或 PDF（`pdfBase64` / `.pdf` 路径）；`save_resume` 解析并写入会话存储 |
| 2. 分析简历 | Agent 提炼目标岗位 / 技能 / 城市 / 关键词，`save_resume_profile` 落库 |
| 3. 搜岗 | `search_jobs` 生成三站公开搜索深链 + 匹配候选（示例列表用于演示） |
| 4. 投递 | `queue_apply` **需用户批准** → `export_apply_pack` → 本机 `npm run apply:local` 半自动打开浏览器，逐岗确认 |
| 5. 回写 | 本地 runner 写出 `.results.json` 后，`mark_applied` 更新会话状态 |

## 为什么是「本机半自动」而不是云端代投

智联 / 猎聘 / 51job 没有对第三方开放的稳定公开投递 API，且登录、验证码与平台条款不允许无人值守代投。本项目采用：

- **可自动**：简历解析、画像、关键词、三站搜索链接、匹配说明、投递队列、导出 pack
- **本机半自动**：Playwright 使用你自己的浏览器配置目录（默认 `~/.botjob/browser-profile`），每个岗位必须你按键确认
- **禁止**：云端静默登录、绕过验证码、无人值守批量代投

### 本机半自动投递

```bash
npm install
npx playwright install chromium
# 先在 playground 走完 queue_apply → export_apply_pack，或用示例 pack：
npm run apply:local -- --pack fixtures/sample-apply-pack.json --dry-run
npm run apply:local -- --pack fixtures/sample-apply-pack.json
```

按键：`a` 已投递 · `c` 尝试点申请按钮（仍需再确认）· `s` 跳过 · `q` 退出。  
结果写入同目录 `*.results.json`，再让 agent 调用 `mark_applied`。

## 本地运行

```bash
npm install
npx @cursor/bdk login          # 模型回合需要 Cursor 凭证
npx @cursor/bdk validate --dir .
npx @cursor/bdk info --dir . --json
npx @cursor/bdk call save_resume --dir . --input '{"text":"...至少40字的简历...","filename":"me.txt"}'
# PDF（base64）:
# node -e "console.log(JSON.stringify({pdfBase64:require('fs').readFileSync('fixtures/sample-resume.pdf').toString('base64'),filename:'sample-resume.pdf'}))" \
#   | xargs -0 -I{} npx @cursor/bdk call save_resume --dir . --input {}
npx @cursor/bdk dev            # http://127.0.0.1:3000/playground
npm run check
```

仓库自带示例 PDF：`fixtures/sample-resume.pdf`。

Playground 对话示例：

> 下面是我的简历，请分析并在智联、猎聘、51job帮我找前端岗位准备投递：…

## 工具一览

- `save_resume` / `get_resume` / `save_resume_profile`
- `search_jobs` / `queue_apply`（需审批）/ `export_apply_pack` / `mark_applied` / `list_applications`

## 项目结构

```
bot/
  instructions.md
  tools/           # 上述工具
  lib/boards/      # 三站搜索 URL 适配器
  lib/apply-pack.ts
  skills/job-hunt/
scripts/local-apply.ts   # 本机半自动投递
fixtures/
evals/
```
