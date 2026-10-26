/** Self-contained review page. All job text is inserted with textContent, never as HTML. */
export const REVIEW_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>botjob 岗位列表</title>
<style>
:root { --bg:#f6f7f9; --card:#fff; --text:#1d2129; --muted:#6b7280; --line:#e5e7eb; --accent:#2563eb; --accent-text:#fff; --ok:#15803d; --warn:#b45309; --bad:#b91c1c; }
@media (prefers-color-scheme: dark) { :root { --bg:#111317; --card:#1b1e24; --text:#e8eaed; --muted:#9aa0a6; --line:#2d3139; --accent:#5b8def; --accent-text:#0b0d10; --ok:#4ade80; --warn:#fbbf24; --bad:#f87171; } }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:15px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
header { position:sticky; top:0; z-index:1; background:var(--card); border-bottom:1px solid var(--line); padding:12px 16px; display:flex; flex-wrap:wrap; gap:8px 16px; align-items:center; }
h1 { font-size:18px; margin:0; flex:1 1 auto; }
#count { color:var(--muted); }
button { font:inherit; border:0; border-radius:8px; padding:8px 16px; background:var(--accent); color:var(--accent-text); cursor:pointer; }
button:disabled { opacity:.45; cursor:not-allowed; }
main { max-width:880px; margin:0 auto; padding:16px; display:grid; gap:12px; }
.notice { color:var(--muted); font-size:13px; }
.job { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px 16px; display:grid; grid-template-columns:auto 1fr; gap:4px 12px; }
.job input { width:18px; height:18px; margin-top:4px; }
.title { font-weight:600; font-size:16px; }
.title a { color:inherit; }
.meta { color:var(--muted); font-size:13px; }
.label { font-weight:600; margin-right:4px; }
.section { grid-column:2; }
.status { grid-column:2; font-size:13px; }
.status.ok { color:var(--ok); } .status.warn { color:var(--warn); } .status.bad { color:var(--bad); }
#result { white-space:pre-wrap; }
#jobs { display:grid; gap:12px; }
.notice:empty { display:none; }
</style>
</head>
<body>
<header>
  <h1>botjob 岗位列表</h1>
  <span id="count">已选 0 个</span>
  <button id="apply" disabled>一键投递所选岗位</button>
</header>
<main>
  <p class="notice" id="material"></p>
  <p class="notice" id="result" role="status"></p>
  <div id="jobs"></div>
</main>
<script>
const STATUS = { queued:["已入队，未投递","warn"], approved:["已批准，未投递","warn"], applying:["投递中…","warn"], submitted_auto:["网站显示投递成功","ok"], submitted_manual:["已手动投递","ok"], submission_unknown:["已点击，结果未知，请到网站核对","bad"], failed:["投递失败","bad"], skipped:["已跳过","warn"], denied:["已拒绝","warn"] };
const selected = new Set();
let data = { jobs: [], maxBatch: 10 };
const $ = id => document.getElementById(id);
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
function when(t) { if (!t) return ""; const d = new Date(t); if (isNaN(d)) return t; const p = n => String(n).padStart(2, "0"); return "更新于 " + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes()); }
function line(label, text) { const p = el("div", "section"); p.append(el("span", "label", label), document.createTextNode(text)); return p; }
function render() {
  const list = $("jobs"); list.replaceChildren();
  $("material").textContent = data.material || "";
  if (!data.jobs.length) list.append(el("p", "notice", "还没有保存的岗位。请先在 AI 对话里搜索岗位。"));
  for (const job of data.jobs) {
    const card = el("article", "job");
    const box = el("input"); box.type = "checkbox"; box.checked = selected.has(job.id);
    box.disabled = !!job.blocked || data.running; box.setAttribute("aria-label", job.title);
    box.onchange = () => { box.checked ? selected.add(job.id) : selected.delete(job.id); if (selected.size > data.maxBatch) { selected.delete(job.id); box.checked = false; alert("每批最多 " + data.maxBatch + " 个岗位"); } update(); };
    const head = el("div");
    const title = el("div", "title"); const a = el("a", null, job.title); a.href = job.url; a.target = "_blank"; a.rel = "noopener noreferrer"; title.append(a);
    head.append(title, el("div", "meta", [job.company, job.city, job.salary, job.board, when(job.sourceTime), "匹配 " + job.matchScore].filter(Boolean).join(" ｜ ")));
    card.append(box, head, line("岗位简介：", job.jobSummary), line("公司简介：", (job.companyFacts ? job.companyFacts + "。" : "") + job.companySummary));
    const state = job.status && STATUS[job.status];
    if (job.blocked || state) { const s = el("div", "status " + (state ? state[1] : "warn"), [job.blocked && !state ? "不可投递：" + job.blocked : state && state[0], job.note].filter(Boolean).join(" · ")); card.append(s); }
    list.append(card);
  }
  update();
}
function update() {
  for (const id of [...selected]) if (!data.jobs.some(job => job.id === id && !job.blocked)) selected.delete(id);
  $("count").textContent = data.running ? "投递进行中…" : "已选 " + selected.size + " 个";
  $("apply").disabled = data.running || selected.size === 0;
}
async function load() {
  const res = await fetch("api/jobs", { cache: "no-store" });
  data = await res.json();
  render();
  const r = data.lastResult;
  if (r && r.message) $("result").textContent = r.message;
  if (data.running) setTimeout(load, 2000);
}
$("apply").onclick = async () => {
  const jobs = data.jobs.filter(job => selected.has(job.id));
  const list = jobs.map(job => "· " + job.title + "｜" + job.company).join("\\n");
  if (!confirm("确认立即投递以下 " + jobs.length + " 个岗位？\\n\\n" + list + "\\n\\n" + data.material)) return;
  $("apply").disabled = true;
  const res = await fetch("api/apply", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobIds: [...selected] }) });
  const body = await res.json();
  if (!res.ok) { $("result").textContent = "未投递：" + (body.error || res.status); update(); return; }
  selected.clear();
  $("result").textContent = "已开始投递 " + body.count + " 个岗位。botjob 会在登录窗口里依次打开岗位并点击投递，遇到登录、验证码或补填会暂停。";
  load();
};
load();
</script>
</body>
</html>
`;
