/** Self-contained review page. All job text is inserted with textContent, never as HTML. */
export const REVIEW_PAGE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>botjob 投递台</title>
<style>
:root {
  --bg:#f4f6f9; --card:#ffffff; --soft:#f8fafc; --text:#181d26; --muted:#5f697a;
  --line:#e3e8ef; --accent:#2563eb; --accent-soft:#eff6ff; --accent-text:#ffffff;
  --ok:#15803d; --ok-bg:#ecfdf5; --warn:#b45309; --warn-bg:#fffbeb;
  --bad:#b91c1c; --bad-bg:#fef2f2; --salary:#d9480f;
  --shadow:0 1px 3px rgba(15,23,42,.06), 0 1px 2px rgba(15,23,42,.04);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg:#0f1217; --card:#181c23; --soft:#1e232c; --text:#e8ecf2; --muted:#9aa3b2;
    --line:#2b313d; --accent:#5b8def; --accent-soft:rgba(91,141,239,.14); --accent-text:#0b0e14;
    --ok:#4ade80; --ok-bg:rgba(74,222,128,.12); --warn:#fbbf24; --warn-bg:rgba(251,191,36,.12);
    --bad:#f87171; --bad-bg:rgba(248,113,113,.12); --salary:#fb923c;
    --shadow:0 1px 3px rgba(0,0,0,.35);
  }
}
* { box-sizing:border-box; }
body {
  margin:0; padding-bottom:88px; background:var(--bg); color:var(--text);
  font:14px/1.6 -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif;
}
button, input, select { font:inherit; color:inherit; }
button {
  border:1px solid transparent; border-radius:8px; padding:7px 14px;
  cursor:pointer; transition:background .15s, border-color .15s, opacity .15s;
}
button:disabled { opacity:.45; cursor:not-allowed; }
.btn-primary { background:var(--accent); color:var(--accent-text); font-weight:600; }
.btn-primary:hover:not(:disabled) { filter:brightness(1.06); }
.btn-ghost { background:var(--card); border-color:var(--line); color:var(--text); }
.btn-ghost:hover:not(:disabled) { background:var(--soft); }
.btn-sm { padding:4px 10px; font-size:12px; border-radius:6px; }
.btn-ok { background:var(--ok-bg); color:var(--ok); border-color:color-mix(in srgb, var(--ok) 30%, transparent); font-weight:600; }

header {
  position:sticky; top:0; z-index:20; background:var(--card);
  border-bottom:1px solid var(--line); box-shadow:var(--shadow);
}
.head-inner {
  max-width:1040px; margin:0 auto; padding:12px 16px;
  display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; justify-content:space-between;
}
.brand { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
.brand h1 { font-size:18px; margin:0; letter-spacing:-.01em; }
.brand .sub { font-size:12px; color:var(--muted); }
.login-bar { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.login-bar .label { font-size:12px; color:var(--muted); }

.wrap { max-width:1040px; margin:0 auto; padding:16px; display:grid; gap:14px; }
.material-bar {
  background:var(--accent-soft); border:1px solid color-mix(in srgb, var(--accent) 24%, transparent);
  border-radius:10px; padding:10px 14px; font-size:13px; color:var(--text);
  display:flex; align-items:flex-start; gap:8px;
}
.material-bar b { color:var(--accent); white-space:nowrap; }

.stats { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; }
@media (max-width:680px) { .stats { grid-template-columns:repeat(2, minmax(0, 1fr)); } }
.stat {
  background:var(--card); border:1px solid var(--line); border-radius:10px;
  padding:10px 14px; text-align:left; box-shadow:var(--shadow);
}
.stat:hover { border-color:var(--accent); }
.stat.active { border-color:var(--accent); background:var(--accent-soft); }
.stat .num { font-size:22px; font-weight:700; line-height:1.2; }
.stat .lbl { font-size:12px; color:var(--muted); margin-top:2px; }
.stat.ready .num { color:var(--accent); }
.stat.ok .num { color:var(--ok); }
.stat.attn .num { color:var(--warn); }

.panel {
  background:var(--card); border:1px solid var(--line); border-radius:12px;
  padding:14px 16px; box-shadow:var(--shadow); display:grid; gap:10px;
}
.panel.running { border-color:var(--accent); background:var(--accent-soft); }
.panel.ok { border-color:color-mix(in srgb, var(--ok) 40%, var(--line)); background:var(--ok-bg); }
.panel.warn { border-color:color-mix(in srgb, var(--warn) 40%, var(--line)); background:var(--warn-bg); }
.panel.bad { border-color:color-mix(in srgb, var(--bad) 40%, var(--line)); background:var(--bad-bg); }
.panel-head { display:flex; align-items:center; justify-content:space-between; gap:10px; font-weight:600; }
.progress-track { height:7px; background:color-mix(in srgb, var(--accent) 18%, transparent); border-radius:999px; overflow:hidden; }
.progress-fill { height:100%; background:var(--accent); transition:width .25s; }
.batch-items { display:grid; gap:6px; margin:0; padding:0; list-style:none; }
.batch-item {
  background:var(--card); border:1px solid var(--line); border-radius:8px;
  padding:8px 10px; display:flex; flex-wrap:wrap; gap:6px 10px; align-items:center; font-size:13px;
}
.batch-item .name { font-weight:600; }
.batch-item .msg { color:var(--muted); flex:1 1 220px; }

.toolbar {
  background:var(--card); border:1px solid var(--line); border-radius:12px;
  padding:12px 14px; display:grid; gap:10px; box-shadow:var(--shadow);
}
.tool-row { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; }
.chips { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.chip {
  background:var(--soft); border:1px solid var(--line); border-radius:999px;
  padding:4px 12px; font-size:13px; color:var(--muted);
}
.chip.active { background:var(--accent); border-color:var(--accent); color:var(--accent-text); font-weight:600; }
.controls { display:flex; flex-wrap:wrap; gap:8px; align-items:center; flex:1 1 auto; justify-content:flex-end; }
.search {
  background:var(--soft); border:1px solid var(--line); border-radius:8px;
  padding:6px 10px; min-width:200px; flex:1 1 200px; max-width:300px;
}
select.sort { background:var(--soft); border:1px solid var(--line); border-radius:8px; padding:6px 10px; }

#jobs { display:grid; gap:12px; }
.job {
  background:var(--card); border:1.5px solid var(--line); border-radius:12px;
  padding:14px 16px; display:grid; grid-template-columns:auto 1fr; gap:10px 14px;
  box-shadow:var(--shadow); transition:border-color .15s, background .15s;
}
.job.selected { border-color:var(--accent); background:color-mix(in srgb, var(--accent-soft) 55%, var(--card)); }
.job.disabled { opacity:.82; }
.job-check { padding-top:3px; }
.job-check input { width:19px; height:19px; accent-color:var(--accent); cursor:pointer; }
.job-body { display:grid; gap:10px; min-width:0; }

.job-top { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:flex-start; justify-content:space-between; }
.job-title-wrap { display:flex; flex-wrap:wrap; gap:8px; align-items:center; min-width:0; }
.board-tag {
  font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px;
  background:var(--soft); border:1px solid var(--line); white-space:nowrap;
}
.board-zhilian { color:#1d4ed8; background:rgba(37,99,235,.1); border-color:rgba(37,99,235,.25); }
.board-liepin { color:#c2410c; background:rgba(234,88,12,.1); border-color:rgba(234,88,12,.25); }
.board-job51 { color:#0f766e; background:rgba(13,148,136,.1); border-color:rgba(13,148,136,.25); }
.job-title { font-size:16px; font-weight:700; color:var(--text); text-decoration:none; }
.job-title:hover { color:var(--accent); text-decoration:underline; }
.ext-link { font-size:12px; color:var(--muted); text-decoration:none; white-space:nowrap; }
.ext-link:hover { color:var(--accent); }

.badges { display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
.score-pill { font-size:12px; font-weight:700; padding:3px 9px; border-radius:999px; white-space:nowrap; }
.score-high { background:var(--ok-bg); color:var(--ok); }
.score-mid { background:var(--accent-soft); color:var(--accent); }
.score-low { background:var(--soft); color:var(--muted); }
.state-pill { font-size:12px; font-weight:600; padding:3px 9px; border-radius:999px; white-space:nowrap; }
.state-ready { background:var(--accent-soft); color:var(--accent); }
.state-ok { background:var(--ok-bg); color:var(--ok); }
.state-warn { background:var(--warn-bg); color:var(--warn); }
.state-bad { background:var(--bad-bg); color:var(--bad); }
.state-muted { background:var(--soft); color:var(--muted); }

.meta-row { display:flex; flex-wrap:wrap; gap:6px 14px; align-items:center; font-size:13px; color:var(--muted); }
.salary { font-weight:700; color:var(--salary); font-size:14px; }
.company-name { font-weight:600; color:var(--text); }
.match-reason {
  background:var(--soft); border-left:3px solid var(--accent);
  border-radius:0 6px 6px 0; padding:5px 10px; font-size:13px; color:var(--text);
}

.info-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
@media (max-width:740px) { .info-grid { grid-template-columns:1fr; } }
.info-box {
  background:var(--soft); border:1px solid var(--line); border-radius:8px;
  padding:9px 11px; font-size:13px; display:grid; gap:4px; align-content:start;
}
.info-box .box-title { font-size:12px; font-weight:700; color:var(--muted); }
.info-box .facts { font-size:12px; color:var(--accent); font-weight:600; }

.card-foot {
  display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; justify-content:space-between;
  padding:8px 10px; border-radius:8px; font-size:13px;
}
.card-foot.ok { background:var(--ok-bg); color:var(--ok); }
.card-foot.warn { background:var(--warn-bg); color:var(--warn); }
.card-foot.bad { background:var(--bad-bg); color:var(--bad); }
.card-foot.muted { background:var(--soft); color:var(--muted); }
.mark-actions { display:flex; flex-wrap:wrap; gap:6px; }

.empty {
  background:var(--card); border:1px dashed var(--line); border-radius:12px;
  padding:32px 16px; text-align:center; color:var(--muted);
}

.dock {
  position:fixed; left:0; right:0; bottom:0; z-index:25;
  background:var(--card); border-top:1px solid var(--line); box-shadow:0 -4px 16px rgba(15,23,42,.08);
}
.dock-inner {
  max-width:1040px; margin:0 auto; padding:12px 16px;
  display:flex; flex-wrap:wrap; gap:10px 16px; align-items:center; justify-content:space-between;
}
.dock-info { display:grid; gap:2px; min-width:0; }
.dock-count { font-weight:700; font-size:15px; }
.dock-names { font-size:12px; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:560px; }
.dock-actions { display:flex; gap:8px; align-items:center; }

.modal-mask {
  position:fixed; inset:0; z-index:50; background:rgba(15,23,42,.55);
  display:flex; align-items:center; justify-content:center; padding:16px;
}
.modal {
  background:var(--card); border:1px solid var(--line); border-radius:14px;
  max-width:560px; width:100%; max-height:85vh; display:grid; grid-template-rows:auto 1fr auto;
  box-shadow:0 20px 50px rgba(0,0,0,.25); overflow:hidden;
}
.modal-head { padding:14px 18px; border-bottom:1px solid var(--line); font-weight:700; font-size:16px; }
.modal-body { padding:14px 18px; overflow:auto; display:grid; gap:10px; }
.modal-list { margin:0; padding:0; list-style:none; display:grid; gap:6px; }
.modal-list li { background:var(--soft); border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:13px; }
.modal-foot { padding:12px 18px; border-top:1px solid var(--line); display:flex; justify-content:flex-end; gap:8px; }
.hidden { display:none !important; }
</style>
</head>
<body>
<header>
  <div class="head-inner">
    <div class="brand">
      <h1>botjob 投递台</h1>
      <span class="sub">先筛选核对，再在登录窗口依次一键投递</span>
    </div>
    <div class="login-bar hidden" id="login-bar">
      <span class="label">登录窗口：</span>
      <button type="button" class="btn-ghost btn-sm" data-login="zhilian">智联登录/检查</button>
      <button type="button" class="btn-ghost btn-sm" data-login="liepin">猎聘登录/检查</button>
      <button type="button" class="btn-ghost btn-sm" data-login="job51">51job登录/检查</button>
    </div>
  </div>
</header>

<main class="wrap">
  <div class="material-bar">
    <b>投递说明</b>
    <span id="material"></span>
  </div>

  <div class="panel hidden" id="login-toast" role="status"></div>
  <div class="panel hidden" id="batch-panel" role="status"></div>

  <section class="stats" aria-label="岗位概览">
    <button type="button" class="stat active" data-tab="all">
      <div class="num" id="stat-total">0</div>
      <div class="lbl">全部岗位</div>
    </button>
    <button type="button" class="stat ready" data-tab="ready">
      <div class="num" id="stat-ready">0</div>
      <div class="lbl">可投递（72h内）</div>
    </button>
    <button type="button" class="stat ok" data-tab="submitted">
      <div class="num" id="stat-submitted">0</div>
      <div class="lbl">已投递</div>
    </button>
    <button type="button" class="stat attn" data-tab="attention">
      <div class="num" id="stat-attention">0</div>
      <div class="lbl">待核对 / 曾暂停</div>
    </button>
  </section>

  <section class="toolbar" aria-label="筛选与批量操作">
    <div class="tool-row">
      <div class="chips" id="board-chips">
        <button type="button" class="chip active" data-board="all">全部平台</button>
        <button type="button" class="chip" data-board="zhilian">智联</button>
        <button type="button" class="chip" data-board="liepin">猎聘</button>
        <button type="button" class="chip" data-board="job51">前程无忧</button>
      </div>
      <div class="controls">
        <input class="search" id="search" type="search" placeholder="搜索职位、公司、城市或行业…">
        <select class="sort" id="sort" aria-label="排序方式">
          <option value="score">按匹配分从高到低</option>
          <option value="time">按更新时间从新到旧</option>
          <option value="ready">可投递优先</option>
        </select>
      </div>
    </div>
    <div class="tool-row">
      <div class="chips" id="status-chips">
        <button type="button" class="chip active" data-tab="all">全部</button>
        <button type="button" class="chip" data-tab="ready">可投递</button>
        <button type="button" class="chip" data-tab="submitted">已投递</button>
        <button type="button" class="chip" data-tab="attention">待核对 / 暂停</button>
        <button type="button" class="chip" data-tab="blocked">不可投递</button>
      </div>
      <div class="chips">
        <button type="button" class="btn-ghost btn-sm" id="select-ready">全选可投递（最多10个）</button>
        <button type="button" class="btn-ghost btn-sm" id="clear-sel">清空已选</button>
      </div>
    </div>
  </section>

  <div id="jobs"></div>
</main>

<div class="dock">
  <div class="dock-inner">
    <div class="dock-info">
      <div class="dock-count" id="count">已选 0 个</div>
      <div class="dock-names" id="selected-names">勾选上方「可投递」岗位后，点右侧按钮一键投递</div>
    </div>
    <div class="dock-actions">
      <button type="button" class="btn-ghost" id="dock-clear" disabled>清空</button>
      <button type="button" class="btn-primary" id="apply" disabled>一键投递所选岗位</button>
    </div>
  </div>
</div>

<div class="modal-mask hidden" id="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
  <div class="modal">
    <div class="modal-head" id="modal-title">确认一键投递</div>
    <div class="modal-body">
      <div class="material-bar"><b>提示</b><span id="modal-material"></span></div>
      <ul class="modal-list" id="modal-list"></ul>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn-ghost" id="modal-cancel">取消</button>
      <button type="button" class="btn-primary" id="modal-go">确认立即投递</button>
    </div>
  </div>
</div>

<script>
const STATUS = {
  queued: ["已入队，等待投递", "warn"],
  approved: ["已批准，等待投递", "warn"],
  applying: ["正在自动投递…", "warn"],
  submitted_auto: ["网站显示投递成功", "ok"],
  submitted_manual: ["已手动投递", "ok"],
  submission_unknown: ["已点击，结果未知，请到网站核对", "bad"],
  failed: ["投递失败", "bad"],
  skipped: ["已跳过", "muted"],
  denied: ["已拒绝", "muted"]
};
const OUTCOME = {
  submitted: ["✓ 投递成功", "ok"],
  already_submitted: ["✓ 此前已投递", "ok"],
  paused: ["⏸ 已暂停", "warn"],
  unknown: ["! 结果待核对", "bad"],
  not_started: ["○ 未开始", "muted"]
};
const selected = new Set();
let data = { jobs: [], stats: { total: 0, ready: 0, submitted: 0, attention: 0 }, maxBatch: 10 };
let tabFilter = "all";
let boardFilter = "all";
let query = "";
let sortBy = "score";
let dismissedResult = false;
let pollTimer = null;

const $ = id => document.getElementById(id);
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function when(t) {
  if (!t) return "";
  const d = new Date(t);
  if (isNaN(d)) return t;
  const p = n => String(n).padStart(2, "0");
  return "更新于 " + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function isSubmitted(job) {
  return job.status === "submitted_auto" || job.status === "submitted_manual";
}
function isAttention(job) {
  return job.status === "submission_unknown" || (job.status === "queued" && !!job.note);
}
function matchesTab(job) {
  if (tabFilter === "ready") return !job.blocked;
  if (tabFilter === "submitted") return isSubmitted(job);
  if (tabFilter === "attention") return isAttention(job);
  if (tabFilter === "blocked") return !!job.blocked && !isSubmitted(job);
  return true;
}
function filteredJobs() {
  const q = query.trim().toLowerCase();
  const list = data.jobs.filter(job => {
    if (!matchesTab(job)) return false;
    if (boardFilter !== "all" && job.boardId !== boardFilter) return false;
    if (!q) return true;
    return [job.title, job.company, job.city, job.companyFacts, job.jobSummary]
      .some(v => (v || "").toLowerCase().includes(q));
  });
  return list.sort((a, b) => {
    if (sortBy === "ready") {
      const ra = a.blocked ? 1 : 0, rb = b.blocked ? 1 : 0;
      if (ra !== rb) return ra - rb;
    }
    if (sortBy === "time") {
      const ta = Date.parse(a.sourceAt || "") || 0, tb = Date.parse(b.sourceAt || "") || 0;
      if (tb !== ta) return tb - ta;
    }
    return (b.matchScore || 0) - (a.matchScore || 0);
  });
}

function renderBatchPanel() {
  const panel = $("batch-panel");
  panel.className = "panel";
  panel.replaceChildren();
  if (data.running && data.batch && Array.isArray(data.batch.jobIds)) {
    panel.classList.add("running");
    const ids = data.batch.jobIds;
    const rows = ids.map(id => data.jobs.find(j => j.id === id)).filter(Boolean);
    const done = rows.filter(j => isSubmitted(j) || j.status === "submission_unknown" || (j.status === "queued" && !!j.note)).length;
    const head = el("div", "panel-head");
    head.append(el("span", null, "正在自动投递（" + done + " / " + ids.length + "）… 请留意弹出的浏览器窗口"));
    panel.append(head);
    const track = el("div", "progress-track");
    const fill = el("div", "progress-fill");
    fill.style.width = Math.max(8, Math.round((done / Math.max(1, ids.length)) * 100)) + "%";
    track.append(fill);
    panel.append(track);
    panel.append(el("div", "sub", "遇到登录验证、滑块或必填表单时会自动暂停并保留该标签页，方便你直接处理。"));
    const ul = el("ul", "batch-items");
    for (const id of ids) {
      const job = data.jobs.find(j => j.id === id);
      if (!job) continue;
      const li = el("li", "batch-item");
      let badgeText = "○ 等待中", cls = "state-muted";
      if (job.status === "applying") { badgeText = "⏳ 正在核验并投递"; cls = "state-ready"; }
      else if (isSubmitted(job)) { badgeText = "✓ 投递成功"; cls = "state-ok"; }
      else if (job.status === "submission_unknown") { badgeText = "! 结果待核对"; cls = "state-bad"; }
      else if (job.status === "queued" && job.note) { badgeText = "⏸ 已暂停"; cls = "state-warn"; }
      li.append(el("span", "state-pill " + cls, badgeText), el("span", "name", job.title + " · " + job.company));
      if (job.note) li.append(el("span", "msg", job.note));
      ul.append(li);
    }
    panel.append(ul);
    return;
  }
  const r = data.lastResult;
  if (r && !dismissedResult) {
    const tone = !r.executed ? "bad" : (r.counts && (r.counts.paused || r.counts.unknown || r.counts.notStarted)) ? "warn" : "ok";
    panel.classList.add(tone);
    const head = el("div", "panel-head");
    head.append(el("span", null, r.message || "本批投递已结束"));
    const close = el("button", "btn-ghost btn-sm", "收起");
    close.type = "button";
    close.onclick = () => { dismissedResult = true; renderBatchPanel(); };
    head.append(close);
    panel.append(head);
    if (Array.isArray(r.items) && r.items.length) {
      const ul = el("ul", "batch-items");
      for (const item of r.items) {
        const meta = OUTCOME[item.outcome] || ["•", "muted"];
        const li = el("li", "batch-item");
        li.append(
          el("span", "state-pill state-" + meta[1], meta[0]),
          el("span", "name", item.title + " · " + item.company),
          el("span", "msg", item.message || "")
        );
        ul.append(li);
      }
      panel.append(ul);
    }
    return;
  }
  panel.classList.add("hidden");
}

function renderStatsAndTabs() {
  const s = data.stats || {
    total: data.jobs.length,
    ready: data.jobs.filter(j => !j.blocked).length,
    submitted: data.jobs.filter(isSubmitted).length,
    attention: data.jobs.filter(isAttention).length
  };
  $("stat-total").textContent = String(s.total);
  $("stat-ready").textContent = String(s.ready);
  $("stat-submitted").textContent = String(s.submitted);
  $("stat-attention").textContent = String(s.attention);
  document.querySelectorAll("[data-tab]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-tab") === tabFilter);
  });
  document.querySelectorAll("[data-board]").forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-board") === boardFilter);
  });
  $("login-bar").classList.toggle("hidden", !data.canLogin);
}

async function markJob(appId, outcome, note) {
  const res = await fetch("api/mark", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId, outcome, note })
  });
  const body = await res.json();
  if (!res.ok) { alert("更新失败：" + (body.error || res.status)); return; }
  await load();
}

function render() {
  $("material").textContent = data.material || "";
  renderStatsAndTabs();
  renderBatchPanel();

  const list = $("jobs");
  list.replaceChildren();
  const visible = filteredJobs();
  if (!data.jobs.length) {
    list.append(el("div", "empty", "还没有保存的岗位。请先在 AI 对话里搜索岗位。"));
    updateDock();
    return;
  }
  if (!visible.length) {
    list.append(el("div", "empty", "当前筛选条件下没有匹配的岗位，试试切换上方筛选或清空搜索词。"));
    updateDock();
    return;
  }

  for (const job of visible) {
    const card = el("article", "job" + (selected.has(job.id) ? " selected" : "") + (job.blocked ? " disabled" : ""));
    const checkWrap = el("div", "job-check");
    const box = el("input");
    box.type = "checkbox";
    box.checked = selected.has(job.id);
    box.disabled = !!job.blocked || !!data.running;
    box.setAttribute("aria-label", job.title);
    box.onchange = () => {
      if (box.checked) {
        if (selected.size >= data.maxBatch) {
          box.checked = false;
          alert("每批最多选择 " + data.maxBatch + " 个岗位");
          return;
        }
        selected.add(job.id);
      } else {
        selected.delete(job.id);
      }
      card.classList.toggle("selected", box.checked);
      updateDock();
    };
    checkWrap.append(box);

    const body = el("div", "job-body");
    const top = el("div", "job-top");
    const titleWrap = el("div", "job-title-wrap");
    titleWrap.append(el("span", "board-tag board-" + (job.boardId || "other"), job.board));
    const a = el("a", "job-title", job.title);
    a.href = job.url; a.target = "_blank"; a.rel = "noopener noreferrer";
    const ext = el("a", "ext-link", "查看原页 ↗");
    ext.href = job.url; ext.target = "_blank"; ext.rel = "noopener noreferrer";
    titleWrap.append(a, ext);

    const badges = el("div", "badges");
    const score = Number(job.matchScore || 0);
    const scoreCls = score >= 80 ? "score-high" : score >= 65 ? "score-mid" : "score-low";
    badges.append(el("span", "score-pill " + scoreCls, "匹配 " + score + " 分"));

    const st = job.status && STATUS[job.status];
    let pillText = "可投递", pillCls = "state-ready";
    if (st) { pillText = st[0]; pillCls = "state-" + st[1]; }
    else if (job.blocked) { pillText = "不可投递"; pillCls = "state-muted"; }
    badges.append(el("span", "state-pill " + pillCls, pillText));
    top.append(titleWrap, badges);
    body.append(top);

    const meta = el("div", "meta-row");
    if (job.salary) meta.append(el("span", "salary", job.salary));
    meta.append(el("span", "company-name", job.company));
    for (const part of [job.city, job.experience, job.education, when(job.sourceTime)].filter(Boolean)) {
      meta.append(el("span", null, part));
    }
    body.append(meta);

    if (job.matchReason) {
      body.append(el("div", "match-reason", "匹配依据：" + job.matchReason));
    }

    const grid = el("div", "info-grid");
    const jBox = el("div", "info-box");
    jBox.append(el("div", "box-title", "岗位简介"), el("div", null, job.jobSummary || "未抓到 JD 正文"));
    const cBox = el("div", "info-box");
    cBox.append(el("div", "box-title", "公司概况"));
    if (job.companyFacts) cBox.append(el("div", "facts", job.companyFacts));
    cBox.append(el("div", null, job.companySummary || "网站未提供公司介绍"));
    grid.append(jBox, cBox);
    body.append(grid);

    if (job.blocked || st || job.note) {
      const tone = st ? st[1] : "warn";
      const foot = el("div", "card-foot " + tone);
      const text = [job.blocked && !st ? "不可投递：" + job.blocked : st && st[0], job.note].filter(Boolean).join(" · ");
      foot.append(el("span", null, text));
      if (job.appId && (job.status === "submission_unknown" || job.status === "approved")) {
        const actions = el("div", "mark-actions");
        const okBtn = el("button", "btn-ok btn-sm", "我已核对：已投递");
        okBtn.type = "button";
        okBtn.onclick = () => markJob(job.appId, "applied", "用户在投递台核对确认已投递");
        const failBtn = el("button", "btn-ghost btn-sm", "标记失败");
        failBtn.type = "button";
        failBtn.onclick = () => markJob(job.appId, "failed", "用户在投递台核对为未投递/失败");
        const skipBtn = el("button", "btn-ghost btn-sm", "跳过");
        skipBtn.type = "button";
        skipBtn.onclick = () => markJob(job.appId, "skipped", "用户在投递台选择跳过");
        actions.append(okBtn, failBtn, skipBtn);
        foot.append(actions);
      }
      body.append(foot);
    }

    card.append(checkWrap, body);
    list.append(card);
  }
  updateDock();
}

function updateDock() {
  for (const id of [...selected]) {
    if (!data.jobs.some(job => job.id === id && !job.blocked)) selected.delete(id);
  }
  const chosen = data.jobs.filter(job => selected.has(job.id));
  $("count").textContent = data.running ? "正在自动投递…" : "已选 " + chosen.length + " / " + data.maxBatch + " 个";
  $("selected-names").textContent = chosen.length
    ? chosen.map(j => j.title + "（" + j.company + "）").join("、")
    : "勾选上方「可投递」岗位后，点右侧按钮一键投递";
  $("apply").disabled = !!data.running || chosen.length === 0;
  $("dock-clear").disabled = !!data.running || chosen.length === 0;
}

async function load() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  const res = await fetch("api/jobs", { cache: "no-store" });
  data = await res.json();
  render();
  if (data.running) pollTimer = setTimeout(load, 1200);
}

function openConfirmModal() {
  const chosen = data.jobs.filter(job => selected.has(job.id));
  if (!chosen.length) return;
  $("modal-title").textContent = "确认立即投递 " + chosen.length + " 个岗位";
  $("modal-material").textContent = data.material || "";
  const list = $("modal-list");
  list.replaceChildren();
  for (const job of chosen) {
    const li = el("li", null, [job.board, job.title, job.company, job.salary].filter(Boolean).join(" · "));
    list.append(li);
  }
  $("modal-go").disabled = false;
  $("confirm-modal").classList.remove("hidden");
}

function closeConfirmModal() {
  $("confirm-modal").classList.add("hidden");
}

async function submitBatch() {
  $("modal-go").disabled = true;
  $("apply").disabled = true;
  const res = await fetch("api/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jobIds: [...selected] })
  });
  const body = await res.json();
  closeConfirmModal();
  if (!res.ok) {
    data.lastResult = { executed: false, message: "未投递：" + (body.error || res.status) };
    dismissedResult = false;
    render();
    return;
  }
  selected.clear();
  dismissedResult = false;
  await load();
}

document.querySelectorAll("[data-tab]").forEach(btn => {
  btn.onclick = () => { tabFilter = btn.getAttribute("data-tab") || "all"; render(); };
});
document.querySelectorAll("[data-board]").forEach(btn => {
  btn.onclick = () => { boardFilter = btn.getAttribute("data-board") || "all"; render(); };
});
document.querySelectorAll("[data-login]").forEach(btn => {
  btn.onclick = async () => {
    const board = btn.getAttribute("data-login");
    const toast = $("login-toast");
    toast.className = "panel running";
    toast.textContent = "正在打开浏览器登录窗口…";
    const res = await fetch("api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board })
    });
    const body = await res.json();
    toast.className = "panel " + (res.ok ? "ok" : "bad");
    toast.textContent = res.ok ? (body.message || "已打开对应网站标签页") : ("打开失败：" + (body.error || res.status));
  };
});
$("search").oninput = e => { query = e.target.value || ""; render(); };
$("sort").onchange = e => { sortBy = e.target.value || "score"; render(); };
$("select-ready").onclick = () => {
  for (const job of filteredJobs()) {
    if (selected.size >= data.maxBatch) break;
    if (!job.blocked) selected.add(job.id);
  }
  render();
};
const clearSelection = () => { selected.clear(); render(); };
$("clear-sel").onclick = clearSelection;
$("dock-clear").onclick = clearSelection;
$("apply").onclick = openConfirmModal;
$("modal-cancel").onclick = closeConfirmModal;
$("modal-go").onclick = submitBatch;
$("confirm-modal").onclick = e => { if (e.target === $("confirm-modal")) closeConfirmModal(); };
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("confirm-modal").classList.contains("hidden")) closeConfirmModal(); });

load();
</script>
</body>
</html>
`;
