const status = document.getElementById('status');
document.getElementById('connect').onclick = async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab.url);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || !/^#[a-f0-9]{64}$/.test(url.hash)) throw new Error('请先让 AI 调用 open_job_login，并切换到它打开的 botjob 连接页面。');
    await chrome.storage.local.set({ connection: { address: url.origin, token: url.hash.slice(1) } });
    await chrome.runtime.sendMessage({ type: 'connect' });
    status.textContent = '已保存本机配对。回到 AI，告诉它继续登录或搜索；扩展响应状态见下方。';
  } catch (error) { status.textContent = error.message; }
};
document.getElementById('disconnect').onclick = async () => {
  await chrome.storage.local.remove('connection');
  await chrome.runtime.sendMessage({ type: 'disconnect' });
  status.textContent = '已断开。正在进行的操作可能已点击，请先核对网站记录。';
};
chrome.storage.local.get('lastStatus').then(value => { if (value.lastStatus) status.textContent = value.lastStatus; });
