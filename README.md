# botjob

**让常用 AI 帮你读简历、找岗位、比较机会，并在你确认后投递。**

botjob 是一个通过 **MCP（Model Context Protocol）** 接入 AI 客户端的本地求职助手。支持 Cursor、Claude Desktop、Claude Code、Codex，以及其他支持本地 stdio MCP 的客户端。

AI 负责理解你的经历、分析岗位和撰写材料；botjob 负责读取文件、获取真实岗位、保存进度，以及执行经过确认的投递操作。MCP 模式使用客户端提供的模型，无需单独配置 Cursor API key。

## 能做什么

| 能力 | 说明 |
| --- | --- |
| 简历读取 | 支持 PDF、扫描件、PNG、JPEG、TXT 与粘贴文本；扫描件可进行中英文 OCR |
| 真实搜岗 | 搜索智联招聘、猎聘，保留岗位链接、JD 与来源时间 |
| 最近三天 | 仅返回查询时刻向前 **72 小时**内可确认更新或发布的岗位；更新时间优先，无法确认时间则不返回 |
| 公司排除 | 根据公司名称和行业证据排除保险、劳务派遣公司；证据不足的岗位单列待核实 |
| 岗位比较 | 保存匹配依据，让 AI 对照真实经历解释优势、缺口和需要确认的条件 |
| 登录后继续 | 网站要求登录时提示用户，在本机浏览器自行登录后继续读取 |
| 一键投递 | 选择岗位、预览、一次确认整批，自动尝试投递；每批最多 10 条 |
| 进度保存 | 保存画像、候选岗位、话术与投递状态，后续对话可继续处理 |

目前只支持**智联和猎聘**。匹配分是规则参考，不是录用概率；搜索结果仍可能混入网站推荐岗位，需要 AI 结合 JD 进一步筛选。

## 快速开始

### 1. 安装与自检

建议使用 **Node.js 24.14+** 和 npm；最低支持 Node.js 22.13。需要登录搜索或一键投递时，请在有桌面的电脑上安装。

```bash
git clone https://github.com/qianjie0720-sys/botjob.git
cd botjob
npm ci
node bin/botjob-mcp.js --check
```

登录搜索和一键投递会打开**系统默认浏览器**（Chrome、Edge、Brave 等 Chromium 内核浏览器）。默认浏览器是 Firefox 或 Safari 时无法自动操作，会改用 Edge（Windows）或 Chrome。电脑上没有这些浏览器时，再安装 botjob 自带的 Chromium：

```bash
npx playwright install chromium
```

也可以用环境变量 `BOTJOB_BROWSER` 指定：`chrome`、`msedge`、`bundled`（自带 Chromium）或浏览器可执行文件路径。

### 2. 接入 AI 客户端

运行对应命令，生成配置并合并到客户端的 MCP 设置中：

| 客户端 | 命令 |
| --- | --- |
| Cursor | `node bin/botjob-mcp.js --config cursor` |
| Claude Desktop | `node bin/botjob-mcp.js --config claude-desktop` |
| Claude Code | `node bin/botjob-mcp.js --config claude-code` |
| Codex | `node bin/botjob-mcp.js --config codex` |

生成的配置使用当前电脑的 Node 和入口文件绝对路径；换电脑后应重新生成。重载 MCP 后，可发现 **15 个工具**。

无参数运行 `node bin/botjob-mcp.js` 即启动 stdio 服务。客户端启动命令不要填 `npm run mcp`，npm 的输出可能干扰协议。

当前提供本地 stdio 接入，尚未提供远程 HTTP MCP 地址。只接受远程 MCP URL 的网页版 AI 产品无法直接接入此配置。

### 3. 开始使用

连接后可以直接对 AI 说：

> 这是我的简历，请分析我的优势，在上海找最近三天更新的薪酬绩效经理岗位。

> 比较这几个岗位，说明我符合哪些条件，还有哪些经历不足。

> 把我选中的这几个岗位一键投递，先给我看投递清单。

> 继续上次的求职，看看哪些岗位已经投递、哪些需要我处理。

通常的流程是：**读取简历 → 保存画像 → 搜索与比较 → 选择岗位 → 确认投递 → 查看结果**。

## 搜索与公司筛选

- 以岗位自身更新时间为优先依据，无更新字段时才采用发布时间。保留时间原文与来源类型，不将招聘者活跃时间、抓取时间或网页页脚日期作为更新证据。
- 默认每站返回最多 5 条，`limitPerBoard` 可增至 20；每次每站最多检查 20 条候选。这是程序读取范围，不代表网站全部岗位，也不表示账号权限不足。
- 公司筛选使用名称和行业证据，岗位福利中的“五险一金”“商业保险”不等同于保险公司。人力资源服务公司也不直接等同于劳务派遣公司。
- `pendingEmployerReview` 单独保留公司性质或名称待核实的记录，不计入推荐结果，也不自动进入候选池。核实前不推荐。
- 网站要求登录或验证时返回具体原因，不编造职位、不绕过校验。

登录流程通过 `open_job_login` 在运行 MCP 的电脑上用**系统默认浏览器**打开一个 botjob 窗口，由用户自行登录。智联和猎聘在同一窗口的不同标签页。这个窗口使用独立的登录记录：平时浏览器里的登录不会带过来，但登录一次后会被记住，MCP 重启后搜索也会直接复用，不需要再打开登录窗口。支持 MCP elicitation 的客户端会显示完成提示；否则在聊天中等待用户确认，再保持窗口打开，用 `accessMode: "browser"` 继续搜索。电脑浏览器的登录状态不会自动同步到云端。

浏览器模式等待岗位 DOM 出现并短暂稳定（最多等待 10 秒），直接读取职位卡片与 JD，再与 HTML/结构化数据按岗位链接合并。它支持异步渲染，不以网络空闲作为读取完成的判断。站点更换选择器、加载超时或未识别的验证页面仍可能失败，不能保证所有页面版本都兼容。

排查时查看 `fetches[].diagnostics`（页面类型、等待时间、卡片数、解析数）和 `detailFailures`（详情链接及错误原因）：

| 返回原因 | 含义与处理 |
| --- | --- |
| `login_required` | 有明确登录限制；在 botjob 窗口中对应站点的标签页登录 |
| `render_timeout` | 等待后仍未识别到可用岗位；检查窗口内页面、网络或结构变化，不能据此判断登录成功或岗位为空 |
| `parse_error` | 页面内容与解析器不匹配；保留脱敏错误信息用于修复，不要反复扫码 |
| `empty` | 网站明确显示无结果，或已读取候选经过时间/公司规则后没有合格岗位；结合排除计数判断 |

详情抓取失败会保留具体原因，不把所有“时间无法确认”归结为岗位过期。默认每站最多补读 5 个详情，可用 `limitPerBoard: 20` 扩大到 20 个；这仍不是站点全部结果，也不会放宽 72 小时及公司排除规则。

## 一键投递

`queue_apply` 准备申请后，调用 `apply_jobs` 预览。使用 `execute: true` 时，用户一次确认整批岗位，再由本机浏览器依次尝试申请，无需导出文件或在终端逐条按键。

**投递使用招聘网站账号当前选用的简历，包括其中的联系方式。** 请先在网站核对账号与简历。上传给 botjob 的本地 PDF 不会自动替换网站简历；本版本也不自动发送单独保存的打招呼语、求职信或填写问卷。

- 确认绑定本批岗位及内容快照，执行前再次检查岗位身份、公司限制和 72 小时时间条件。
- 支持 elicitation 的客户端显示确认弹窗；不支持时展示清单，等待用户明确同意后再带确认参数与快照哈希执行。哈希本身不能证明用户已经同意。
- 遇到登录、验证码、必填信息、仅支持“聊一聊”或按钮无法唯一识别时暂停。
- 页面明确显示成功才记录成功。点击后结果不明时标记待核对，不因超时自动重试。

| 状态 | 含义 |
| --- | --- |
| `queued` | 等待确认或本批暂停后尚未点击 |
| `applying` | 正在准备投递 |
| `submitted_auto` | 页面确认已投递 |
| `submission_unknown` | 已尝试点击，结果需要人工核对 |
| `submitted_manual` | 用户核对后确认已投递 |

通过 `list_applications` 查看结果与成功证据；人工核对后可用 `mark_applied` 回写。已投递、执行中和结果未知的岗位不会重复入队。

浏览器页面结构与账号权限可能变化，因此不能保证所有岗位自动提交。当前自动化验证使用真实浏览器中的隔离测试页面，尚未以用户账号验证真实投递。

### 手动投递方式

原有半自动流程保留：`queue_apply` → 用户确认后 `approve_apply` → `export_apply_pack`，然后在本机执行返回的命令：

```bash
npm run apply:local -- --pack /绝对路径/投递包.json
```

脚本逐条展示材料并等待操作；结束后通过 `mark_applied` 回写结果。未批准申请不能导出。

## MCP 工具

| 阶段 | 工具 |
| --- | --- |
| 恢复进度 | `get_workspace` |
| 简历与画像 | `save_resume`、`get_resume`、`save_resume_profile` |
| 岗位与登录 | `search_jobs`、`score_job`、`list_jobs`、`open_job_login` |
| 求职材料 | `save_cover_letter` |
| 投递与跟进 | `queue_apply`、`apply_jobs`、`approve_apply`、`list_applications`、`export_apply_pack`、`mark_applied` |

工具同时返回文本 JSON 与 `structuredContent`。客户端可读取 prompt `job-hunt` 和 resource `botjob://skills/job-hunt`；独立技能说明位于 [skills/botjob/SKILL.md](skills/botjob/SKILL.md)。

## 数据与运行环境

简历和求职进度默认保存在 `~/.botjob/data/`，可通过 `BOTJOB_HOME` 指定目录。登录搜索与一键投递的浏览器会话保存在 `<BOTJOB_HOME>/search-browser/shared`（旧版本按站点分目录，升级后需重新登录一次）；手动投递脚本默认使用 `~/.botjob/browser-profile`，两者的登录状态独立。

浏览器会话含账号登录信息，不要提交到 Git 或分享。工具不会要求用户在聊天中提供密码、验证码或 Cookie。简历会交给所选 AI 客户端分析，其模型服务的数据处理方式取决于客户端配置；本地保存不代表简历内容完全不离开电脑。

每个用户使用独立目录，同一目录只运行一个服务实例。一般状态存储不提供跨进程事务锁；一键投递使用独立文件锁防止并发提交。进程异常退出可能留下 `one-click-apply.lock`，应先停止相关实例并核对网站投递记录，再维护锁和中断状态，避免重复投递。

无交互桌面的云环境可以读取简历和抓取公开岗位，无法向用户提供本机登录窗口。登录和投递需在具备交互浏览器的环境执行。

### 代理网络

Node.js 24.14+ 下，公开页面请求会自动使用进程中的 `HTTP_PROXY` / `HTTPS_PROXY` 并遵守 `NO_PROXY`；`NODE_USE_ENV_PROXY=0` 可关闭自动配置。Node.js 22.21+ 或 24.5+ 可通过启动时设置 `NODE_USE_ENV_PROXY=1` 启用内置代理。

MCP 客户端需要将代理变量传给服务进程；SDK 的默认环境白名单不包含这些变量。企业可信证书通过 `NODE_EXTRA_CA_CERTS` 传入，保留 TLS 校验。此配置针对公开 HTTP 请求，浏览器联网还取决于本机环境；代理不能保证绕过网站登录或风控限制。

## 开发与验证

```bash
npm run check
npm test
node scripts/check-pack-files.mjs
npx bdk validate --dir .
npm run apply:local -- --pack fixtures/sample-apply-pack-liepin.json --dry-run
```

当前测试覆盖简历读取、站点解析、72 小时筛选、公司排除、MCP 客户端接入、登录提示、投递确认、并发防重复及结果回写。浏览器测试在拦截页面上运行；未安装可用 Chromium 时会跳过该项，完整验证应先安装浏览器。测试不向真实岗位投递。

| 目录 | 用途 |
| --- | --- |
| `bot/lib/actions/` | 简历、岗位、材料、申请、投递和工作区业务逻辑 |
| `bot/lib/boards/` | 智联、猎聘的查询、解析、筛选与浏览器适配 |
| `mcp/` | MCP 服务、工具注册与确认流程 |
| `bin/` | 启动、自检和客户端配置生成 |
| `scripts/` | 手动投递及打包检查 |
| `tests/` | 自动化测试 |
| `skills/` | AI 客户端使用指引 |

项目保留 BDK 入口，可运行 `npm run dev`。BDK 自行驱动的模型对话和评测需要对应 Cursor 凭证；MCP 模式和本地测试无需这些凭证。

发现解析或客户端兼容问题，可在 [Issues](https://github.com/qianjie0720-sys/botjob/issues) 提供站点、客户端版本与脱敏后的错误信息。
