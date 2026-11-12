import {matchingAccounts, pageKey} from './core.js';
import {fillLogin} from './fill.js';
const $ = selector => document.querySelector(selector);
$('#manage').onclick = () => chrome.tabs.create({url:chrome.runtime.getURL('index.html')});
async function init() {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  let url;
  try {url = new URL(tab?.url);} catch {}
  if (!url || !['http:','https:'].includes(url.protocol)) {
    $('#domain').textContent = '当前页面不支持填充';
    $('#hint').textContent = '请在普通网站的登录页打开扩展，或点击“管理账号”。'; return;
  }
  const hostname = url.hostname;
  $('#domain').textContent = url.host + url.pathname;
  const data = await chrome.storage.local.get('accountsV1');
  let scope = 'page';
  function render() {
    $('#accounts').replaceChildren();
    const accounts = matchingAccounts(data.accountsV1 || [],url.href,scope);
    $('#hint').textContent = scope === 'page' ? `当前页面 · ${accounts.length} 个账号` : `当前域名 · ${accounts.length} 个账号`;
    $('#scope').textContent = scope === 'page' ? '在当前域名下查找' : '返回当前页面账号';
    if (!accounts.length) {
      const empty = document.createElement('div');empty.className = 'empty';empty.textContent = '没有匹配账号，可在当前域名下查找，或在管理页新增。';$('#accounts').append(empty);return;
    }
    for (const account of accounts) {
      const button = document.createElement('button');button.className = 'account';
      const info = document.createElement('div'), name = document.createElement('strong'), user = document.createElement('small'), label = document.createElement('span');
      name.textContent = account.name || account.username || '未命名账号';user.textContent = account.username + ' · ' + account.url;
      user.title = account.url;label.textContent = '填充 →';info.append(name,user);button.append(info,label);
      button.onclick = async () => {
        document.querySelectorAll('.account').forEach(b => b.disabled = true);
        try {
          const results = await chrome.scripting.executeScript({target:{tabId:tab.id},func:fillLogin,args:[{hostname,expectedPage:pageKey(url.href),username:account.username,password:account.password}]});
          $('#status').textContent = results[0]?.result?.message || '页面未返回结果，请刷新登录页后重试。';
        } catch {
          $('#status').textContent = '无法在此页面填充。请确认是普通网站登录页，并刷新页面后重试。';
        } finally { document.querySelectorAll('.account').forEach(b => b.disabled = false); }
      };
      $('#accounts').append(button);
    }
  }
  $('#scope').onclick = () => {scope = scope === 'page' ? 'domain' : 'page'; render();};
  render();
}
init().catch(error => {$('#domain').textContent = '读取失败';$('#status').textContent = error.message;});
