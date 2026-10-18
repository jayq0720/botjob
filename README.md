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

## 在 AI 工具里使用

stdio MCP 服务器把上面的工具暴露给 Claude Code、Codex CLI、Cursor、Claude Desktop，以及任何支持本地 stdio MCP 的客户端。只做本机进程，没有远程 HTTP。打招呼语和求职信仍由客户端里的模型来写，服务器只保存。

先在仓库里安装依赖。客户端要启动的是 `node bin/botjob-mcp.js`（或在本仓库里 `npx botjob-mcp`）。不要把 `npm run mcp` 配进客户端：npm 会往 stdout 打一行脚本名，stdio 协议会坏。`npm run mcp` 只适合你自己在终端里看它是否卡住等待输入。

状态在 `~/.botjob/data/`（`kv.json` 和简历文件）。设置 `BOTJOB_HOME` 可以改掉 `~/.botjob` 这一层。浏览器登录态仍是 `~/.botjob/browser-profile`，跟数据目录分开。

MCP 没有 BDK 的审批卡片。`queue_apply` 只把申请标成 `queued`。模型必须先请你看岗位、链接和话术；`approve_apply` 会再用 MCP elicitation 弹一次确认。客户端不支持 elicitation 时，只有你已经同意，模型才可以传 `confirm: true`。没批准的岗位不能 `export_apply_pack`。服务器不打开浏览器。你拿到 `localCommand` 后，自己在仓库里跑 `npm run apply:local`，逐条确认。

服务器启动时会把 `bot/skills/job-hunt` 的流程和写作规范做成 prompt `job-hunt`，以及 resource `botjob://skills/job-hunt`。给 Claude Code / Codex 用的同一份说明在 `skills/botjob/SKILL.md`。

下面的路径请换成这台机器上的仓库绝对路径。配置格式来自各工具当前文档：Claude Code 的 [Connect Claude Code to tools via MCP](https://code.claude.com/docs/en/mcp)，Codex 的 [Model Context Protocol](https://learn.chatgpt.com/docs/extend/mcp)，Cursor 的 [MCP](https://cursor.com/docs/mcp)。

### Claude Code

```bash
claude mcp add --transport stdio --scope project botjob -- node /绝对路径/botjob/bin/botjob-mcp.js
claude mcp list
```

`--` 后面整段是服务器命令，不要漏。项目级配置写在仓库根的 `.mcp.json`（Claude Code 会请你批准后才启动）：

```json
{
  "mcpServers": {
    "botjob": {
      "type": "stdio",
      "command": "node",
      "args": ["${CLAUDE_PROJECT_DIR:-.}/bin/botjob-mcp.js"]
    }
  }
}
```

会话里用 `/mcp` 看工具列表。求职流程 skill 可链到 Claude Code 的项目技能目录：

```bash
mkdir -p .claude/skills
ln -s ../../skills/botjob .claude/skills/botjob
```

### Codex CLI

Codex 把 MCP 配在 `~/.codex/config.toml`（项目级是受信任仓库里的 `.codex/config.toml`）。CLI 和 Codex 桌面端共用这份配置。

```bash
codex mcp add botjob -- node /绝对路径/botjob/bin/botjob-mcp.js
codex mcp list
```

手写时：

```toml
[mcp_servers.botjob]
command = "node"
args = ["/绝对路径/botjob/bin/botjob-mcp.js"]

[mcp_servers.botjob.env]
BOTJOB_HOME = "/绝对路径/.botjob"
```

技能目录是仓库里的 `.agents/skills`（或 `~/.codex/skills`）：

```bash
mkdir -p .agents/skills
ln -s ../../skills/botjob .agents/skills/botjob
```

### Cursor

项目配置是 `.cursor/mcp.json`，全局是 `~/.cursor/mcp.json`。stdio 需要 `command`，官方字段表把 `type` 标成必填。

```json
{
  "mcpServers": {
    "botjob": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/bin/botjob-mcp.js"]
    }
  }
}
```

保存后在 Cursor Settings → MCP 里刷新，确认 botjob 已连接并列出工具。

### Claude Desktop 和其他 stdio 客户端

Claude Desktop 的配置文件：macOS 是 `~/Library/Application Support/Claude/claude_desktop_config.json`，Windows 是 `%APPDATA%\Claude\claude_desktop_config.json`。改完要完全退出再打开。

```json
{
  "mcpServers": {
    "botjob": {
      "command": "node",
      "args": ["/绝对路径/botjob/bin/botjob-mcp.js"]
    }
  }
}
```

其他只支持 stdio 的客户端用同一组 `command` / `args`。服务器声明的工具说明、`readOnlyHint` / `destructiveHint`，以及 prompt `job-hunt`，会在 `tools/list` 和 `prompts/list` 里出现。

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
