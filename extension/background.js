const waiting = ms => new Promise(resolve => setTimeout(resolve, ms));
const pendingApplications = new Map();
let running = false;
let pollAbort;
let generation = 0;
function allowed(url, board) {
  try {
    const u = new URL(url);
    const domain = board === 'liepin' ? 'liepin.com' : board === 'zhilian' ? 'zhaopin.com' : '';
    return !!domain && u.protocol === 'https:' && !u.username && !u.password && (u.hostname === domain || u.hostname.endsWith('.' + domain));
  } catch { return false; }
}
async function pageCall(tabId, board, operation, fingerprint) {
  const tab = await chrome.tabs.get(tabId);
  if (!allowed(tab.url, board)) throw new Error('页面离开了所选招聘站，停止读取或点击。');
  const result = await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED',
    func: (board, operation, fingerprint) => {
      if (operation === 'read') {
        const body = document.documentElement.outerHTML;
        if (new TextEncoder().encode(body).length > 2_000_000) throw new Error('页面超过 2MB');
        return { body, finalUrl: location.href, raw: BotjobPage.captureJobDom({ board, detail: /\/(job|jobdetail)\/[^/]+\.(shtml|htm)/.test(location.pathname) }) };
      }
      return BotjobPage.applicationDom(board, operation, fingerprint);
    }, args: [board, operation, fingerprint ?? null] });
  if (result[0]?.error || !result[0]?.result) throw new Error('读取页面失败，请检查当前招聘网站页面。');
  const value = result[0].result;
  if (operation === 'read' && board === 'zhilian') {
    // Only source time fields cross from the website's JS world; all actions run isolated.
    const ids = value.raw.jobs.map(job => job.url.match(/\/jobdetail\/([^/.]+)\.htm/)?.[1]).filter(Boolean);
    const times = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: ids => {
      const state = window.__INITIAL_STATE__;
      const rows = [...(Array.isArray(state?.positionList) ? state.positionList : []), state?.jobDetail?.detailedPosition];
      return rows.filter(row => row && ids.includes(row.number)).slice(0, 100).map(row => ({ number: row.number,
        updated: [row.positionUpdateTime, row.updateTime].find(value => typeof value === 'string') || '',
        published: [row.positionPublishTime, row.publishTime].find(value => typeof value === 'string') || '' }));
    }, args: [ids] });
    for (const job of value.raw.jobs) {
      const number = job.url.match(/\/jobdetail\/([^/.]+)\.htm/)?.[1];
      const row = times[0]?.result?.find(row => row.number === number);
      if (row) { job.updated ||= row.updated; job.published ||= row.published; }
    }
  }
  return value;
}
async function newJobTab(url, board, active) {
  if (!allowed(url, board)) throw new Error('不允许打开此站点');
  const tab = await chrome.tabs.create({ url, active });
  try {
    const started = Date.now();
    while (Date.now() - started < 20_000) {
      const current = await chrome.tabs.get(tab.id);
      if (current.status === 'complete') break;
      await waiting(200);
    }
    const current = await chrome.tabs.get(tab.id);
    if (!allowed(current.url, board)) throw new Error('请在浏览器中手动完成登录或验证。');
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', files: ['page.js'] });
    return tab.id;
  } catch (error) { await chrome.tabs.remove(tab.id).catch(() => {}); throw error; }
}
async function readReady(tabId, board) {
  const started = Date.now();
  let signature = '', stableAt = started, snapshot;
  let state = 'timeout';
  while (Date.now() - started <= 10_000) {
    snapshot = await pageCall(tabId, board, 'read');
    const next = JSON.stringify(snapshot.raw);
    if (next !== signature) { stableAt = Date.now(); signature = next; }
    const detail = /\/(job|jobdetail)\/[^/]+\.(shtml|htm)/.test(new URL(snapshot.finalUrl).pathname);
    const ready = snapshot.raw.jobs.some(job => job.title && job.url && (!detail || job.description.length >= 20));
    if (Date.now() - stableAt >= 750) {
      if (ready) { state = 'ready'; break; }
      if (snapshot.raw.restricted) { state = 'restricted'; break; }
      if (!detail && snapshot.raw.empty) { state = 'empty'; break; }
    }
    await waiting(200);
  }
  return { ...snapshot, state, elapsedMs: Date.now() - started };
}
async function handle(command, epoch) {
  if (epoch !== generation) throw new Error("浏览器连接已变化，操作取消。");
  if (!['liepin', 'zhilian'].includes(command.board)) throw new Error('不支持的招聘站');
  if (command.type === 'open') {
    if (!allowed(command.url, command.board)) throw new Error('登录链接不合法');
    await chrome.tabs.create({ url: command.url, active: true });
    return { opened: true };
  }
  if (command.type === 'read' || command.type === 'prepare_apply') {
    const tabId = await newJobTab(command.url, command.board, command.type === 'prepare_apply');
    try {
      const snapshot = await readReady(tabId, command.board);
      if (command.type === 'read') return snapshot;
      const inspection = await pageCall(tabId, command.board, 'inspect');
      const token = crypto.randomUUID();
      pendingApplications.set(token, { tabId, board: command.board, url: snapshot.finalUrl, fingerprint: inspection.fingerprint, expires: Date.now() + 60_000 });
      for (const [key, value] of pendingApplications) if (value.expires < Date.now()) pendingApplications.delete(key);
      return { ...snapshot, inspection, token };
    } finally { if (command.type === 'read') await chrome.tabs.remove(tabId).catch(() => {}); }
  }
  if (command.type === 'click_apply') {
    const prepared = pendingApplications.get(command.token);
    pendingApplications.delete(command.token); // One attempt even if the result channel is interrupted.
    if (!prepared || prepared.expires < Date.now() || prepared.board !== command.board) throw new Error('投递准备已失效，请核对网站记录后重新预览。');
    const current = await chrome.tabs.get(prepared.tabId);
    if (current.url !== prepared.url) throw new Error('页面已跳转，未点击。');
    if (epoch !== generation) throw new Error('浏览器连接已断开，未点击。');
    const clicked = await pageCall(prepared.tabId, command.board, 'click', prepared.fingerprint);
    if (!clicked.clicked) return { outcome: 'paused', message: clicked.reason + '，未点击。' };
    const started = Date.now();
    while (Date.now() - started < 8000) {
      const tab = await chrome.tabs.get(prepared.tabId);
      if (tab.url !== prepared.url) break;
      const result = await pageCall(prepared.tabId, command.board, 'result');
      if (result.done) { await chrome.tabs.remove(prepared.tabId); return { outcome: 'submitted', message: '网站显示投递成功。', evidence: result.evidence }; }
      await waiting(250);
    }
    return { outcome: 'unknown', message: '已点击一次，但未取得明确成功证据。请核对当前标签页，不自动重试。' };
  }
  throw new Error('未知操作');
}
async function loop() {
  if (running) return;
  running = true;
  const epoch = generation;
  try {
    while (epoch === generation) {
      const { connection } = await chrome.storage.local.get('connection');
      if (!connection) break;
      pollAbort = new AbortController();
      try {
        const response = await fetch(connection.address + '/poll', { headers: { Authorization: 'Bearer ' + connection.token }, signal: pollAbort.signal });
        if (!response.ok) throw new Error('配对无效或本机服务不可用');
        await chrome.storage.local.set({ lastStatus: '已连接本机 botjob，复用当前浏览器登录态。' });
        const command = await response.json();
        if (command.type === 'idle') continue;
        let value, error;
        try { value = await handle(command, epoch); } catch (e) { error = e.message; }
        // Result transport failures never replay the action.
        await fetch(connection.address + '/result', { method: 'POST', headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: command.id, value, error }), signal: AbortSignal.timeout(5000) });
      } catch {
        await chrome.storage.local.set({ lastStatus: '等待本机 botjob 服务，请保持 AI 连接器运行。' });
        await waiting(3000);
      }
    }
  } finally { running = false; if (epoch !== generation) void loop(); }
}
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'connect' || message.type === 'disconnect') { generation++; pendingApplications.clear(); pollAbort?.abort(); void loop(); sendResponse({ ok: true }); }
});
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('botjob', { periodInMinutes: 0.5 }); void loop(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('botjob', { periodInMinutes: 0.5 }); void loop(); });
chrome.alarms.onAlarm.addListener(() => void loop());
void loop();
