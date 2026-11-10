import {matchingAccounts} from './core.js';
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
  $('#domain').textContent = hostname;
  const data = await chrome.storage.local.get('accountsV1');
  const accounts = matchingAccounts(data.accountsV1 || [],url.href);
  if (!accounts.length) {
    const empty = document.createElement('div');empty.className = 'empty';empty.textContent = '此域名下还没有账号，请在管理页新增或导入。';$('#accounts').append(empty);return;
  }
  for (const account of accounts) {
    const button = document.createElement('button');button.className = 'account';
    const info = document.createElement('div'), name = document.createElement('strong'), user = document.createElement('small'), label = document.createElement('span');
    name.textContent = account.name || account.username || '未命名账号';user.textContent = account.username;
    user.title = new URL(account.url).pathname;label.textContent = '填充 →';info.append(name,user);button.append(info,label);
    button.onclick = async () => {
      document.querySelectorAll('.account').forEach(b => b.disabled = true);
      try {
        const results = await chrome.scripting.executeScript({target:{tabId:tab.id},func:fillLogin,args:[{hostname,username:account.username,password:account.password}]});
        $('#status').textContent = results[0]?.result?.message || '页面未返回结果，请刷新登录页后重试。';
      } catch {
        $('#status').textContent = '无法在此页面填充。请确认是普通网站登录页，并刷新页面后重试。';
      } finally { document.querySelectorAll('.account').forEach(b => b.disabled = false); }
    };
    $('#accounts').append(button);
  }
}
init().catch(error => {$('#domain').textContent = '读取失败';$('#status').textContent = error.message;});
