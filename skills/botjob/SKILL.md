---
name: botjob
description: >
  用本机 botjob MCP 完成求职：保存简历和画像，搜索或打分智联、猎聘、51job、BOSS，
  撰写并保存打招呼语和求职信，经用户确认后批准并导出投递包。
  用户要找工作、分析简历、给 JD 打分或准备投递时使用。
---

# botjob 求职流程

服务器只保存状态和做校验。岗位文案、打招呼语、求职信由你写。不要编造职位、公司或 JD。不要打开浏览器，不要代按发送。

## 调用顺序

1. `save_resume`：简历全文、本机路径（PDF / 扫描件 / png / jpg / txt），或 base64。四选一。
2. 阅读简历，调用 `save_resume_profile`（目标岗位、技能、城市、年限、学历、薪资、关键词）。
3. `search_jobs` 展示各站搜索链接。只讨论 `listings` 里的真实岗位；`fetches` 的失败原因原样告诉用户。用户贴了 JD 或岗位链接时改用 `score_job`。已有详情 HTML 时把 HTML 和该站 https 链接一起交给 `score_job`，这样不会访问网络。
4. 对准备投的岗位写打招呼语和求职信，再 `save_cover_letter`。
5. `queue_apply`。此时状态是 `queued`，还没批准。
6. 把岗位、链接、打招呼语、求职信给用户看。用户明确同意后调用 `approve_apply`。工具会用 MCP elicitation 再确认，弹窗里有求职信；只批准弹窗列出的申请，话术或链接变了就不批。客户端不支持 elicitation 时，先调用一次读取 `snapshotHash`，用户已经同意后再传 `confirm: true` 和这个哈希。不要只传 `confirm`。没有弹窗时，你仍可能自行回传哈希，那不是用户点选；能用 elicitation 就用 elicitation。
7. `export_apply_pack`。没批准的岗位不会出现在包里。把返回的 `localCommand` 交给用户，让用户在 botjob 仓库里自己运行。
8. 用户跑完 `npm run apply:local` 后，用 `mark_applied` 回写。

状态在 `~/.botjob/data/`，可用 `BOTJOB_HOME` 改家目录。用 `get_resume` 和 `list_applications` 回答进度。

## 接入

客户端不克隆仓库时用一行 npx（stdio）。不要把 `npm run mcp` 配进去。

```bash
npx -y github:qianjie0720-sys/botjob
```

Claude Code：`claude mcp add --transport stdio --scope user botjob -- npx -y github:qianjie0720-sys/botjob`

Codex：`codex mcp add botjob -- npx -y github:qianjie0720-sys/botjob`

Cursor / Claude Desktop 的 `mcpServers.botjob`：`command` 为 `npx`，`args` 为 `["-y", "github:qianjie0720-sys/botjob"]`。Cursor 还要 `"type": "stdio"`。

已经克隆仓库时，改为 `node` 加上仓库里的 `bin/botjob-mcp.js`。

## 链接

只接受智联 `zhaopin.com`、猎聘 `liepin.com`、前程无忧 `51job.com`、BOSS `zhipin.com` 的 https 链接，而且域名必须和 `board` 一致。其它链接请用户贴 JD 正文。

## 打招呼语和求职信

打招呼语（BOSS / 猎聘聊天框）：

- 第一人称，150 字以内，最多 200。
- 点明岗位，并用简历里真实的 1–2 个技能或经历对齐 JD。
- 不写「尊敬的领导」，不堆形容词，不承诺已经投递。
- 结尾是想沟通，不是「已发送」。

求职信：

- 三段：为什么这个岗位、匹配证据（只来自简历和 JD）、收尾。
- 不编造简历里没有的公司、年限或项目。
- 大约 200–500 字。

已批准或已投递的申请不能靠 `save_cover_letter` 改话术。再次 `queue_apply` 同一岗位（规范化 URL）只返回原记录和当前状态，不会改回 queued，也不会改掉已批准的话术。

## 本机投递

`export_apply_pack` 的 `localCommand` 类似：

```bash
npm run apply:local -- --pack <pack.json>
```

按键：`a` 已投递，`c` 尝试点申请或「立即沟通」（仍需再确认），`f` 填入打招呼语但不发送，`p` 复制打招呼语，`l` 复制求职信，`s` 跳过，`q` 退出。

BOSS 上点「立即沟通」可能会立即发出平台默认招呼语。脚本会先说明，确认后才点。不要说已经在云端投递成功。

## 不要

- 抓取失败时编造公司和 JD，或用示例公司冒充真实岗位。
- 在用户确认前调用 `approve_apply`，或在不支持 elicitation 时自己填 `confirm: true` 和 `snapshotHash`。
- 索要招聘网站密码，或解释如何绕过验证码。
- 没有画像就搜岗、打分。
