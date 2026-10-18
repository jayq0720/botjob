# botjob

求职助手 Agent：上传简历 → 分析画像 → 在智联招聘 / 猎聘 / 前程无忧(51job) 搜索合适岗位并准备投递。

## 能力

| 步骤 | 说明 |
| --- | --- |
| 1. 上传简历 | 粘贴全文或上传文本；`save_resume` 写入会话存储 |
| 2. 分析简历 | Agent 提炼目标岗位 / 技能 / 城市 / 关键词，`save_resume_profile` 落库 |
| 3. 搜岗 | `search_jobs` 生成三站公开搜索深链 + 匹配候选（示例列表用于演示） |
| 4. 投递 | `queue_apply` **需用户批准**；批准后给出投递链接，由用户登录站点完成提交 |

## 为什么投递需要人工确认

智联 / 猎聘 / 51job 没有对第三方开放的稳定公开投递 API，且登录、验证码与平台条款不允许无人值守代投。本项目采用：

- **可自动**：简历解析、画像、关键词、三站搜索链接、匹配说明、投递队列
- **需用户确认**：真正在浏览器里登录并点击投递（`queue_apply` 走 BDK 审批）

后续若接入官方开放平台或用户本机浏览器会话（用户明确授权），可在不改变工具契约的前提下扩展 `queue_apply` 执行层。

## 本地运行

```bash
npm install
npx @cursor/bdk login          # 模型回合需要 Cursor 凭证
npx @cursor/bdk validate --dir .
npx @cursor/bdk info --dir . --json
npx @cursor/bdk call save_resume --dir . --input '{"text":"...至少40字的简历...","filename":"me.txt"}'
npx @cursor/bdk dev            # http://127.0.0.1:3000/playground
npm run check
```

Playground 对话示例：

> 下面是我的简历，请分析并在智联、猎聘、51job帮我找前端岗位准备投递：…

## 工具一览

- `save_resume` / `get_resume` / `save_resume_profile`
- `search_jobs` / `queue_apply`（需审批）/ `list_applications`

## 项目结构

```
bot/
  instructions.md
  tools/           # 上述工具
  lib/boards/      # 三站搜索 URL 适配器
  skills/job-hunt/
evals/
```
