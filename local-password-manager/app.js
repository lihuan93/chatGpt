import {cleanUrl, readImport, mergeRows, exportRows} from './core.js';
const $ = s => document.querySelector(s);
const STORAGE_KEY = 'accountsV1';
let rows = [], editId = null, toastTimer;
const expandedDomains = new Set();
chrome.storage.local.setAccessLevel({accessLevel: 'TRUSTED_CONTEXTS'}).catch(() => {});
function toast(message) {
  $('#toast').textContent = message; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4000);
}
async function load() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  rows = data[STORAGE_KEY] || []; render();
}
async function mutate(transform) {
  await navigator.locks.request('local-accounts-write', async () => {
    const data = await chrome.storage.local.get(STORAGE_KEY);
    const next = transform(data[STORAGE_KEY] || []);
    await chrome.storage.local.set({[STORAGE_KEY]: next});
    rows = next; render();
  });
}
function confirmAction(title, message) {
  $('#confirm-title').textContent = title; $('#confirm-message').textContent = message;
  const dialog = $('#confirm-dialog'); dialog.showModal();
  return new Promise(resolve => {
    let accepted = false;
    $('#confirm-ok').onclick = () => { accepted = true; dialog.close(); };
    $('#confirm-cancel').onclick = () => dialog.close();
    dialog.addEventListener('close', () => resolve(accepted), {once:true});
  });
}
function element(tag, className, text) {
  const node = document.createElement(tag); node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function action(label, handler, className = '') {
  const button = element('button', className, label);
  button.addEventListener('click', async () => { try { await handler(); } catch (e) { toast(e.message); } });
  return button;
}
async function copy(text) { await navigator.clipboard.writeText(text); toast('已复制到剪贴板'); }
function render() {
  if ($('#editor').open) updateAccountHint();
  $('#total').textContent = rows.length; $('#side-count').textContent = rows.length;
  $('#sites').textContent = new Set(rows.map(r => new URL(r.url).hostname)).size;
  const query = $('#search').value.toLocaleLowerCase().trim();
  const visible = rows.filter(r => [r.url,r.name,r.username,r.notes].some(v => v.toLocaleLowerCase().includes(query)))
    .sort((a,b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  $('#visible-count').textContent = visible.length;
  const list = $('#list'); list.replaceChildren();
  if (!visible.length) {
    const empty = element('div', 'empty');
    empty.append(element('div','empty-icon','▣'), element('h3','',query ? '没有找到匹配的账号' : '从第一个账号开始'),
      element('p','',query ? '试试其他名称、网址或用户名。' : '新增一个账号，或导入已有的 JSON 备份。'));
    if (!query) empty.append(action('＋ 新增账号', () => openEditor(), 'primary'));
    list.append(empty); return;
  }
  const domains = new Map();
  for (const row of visible) {
    const hostname = new URL(row.url).hostname;
    if (!domains.has(hostname)) domains.set(hostname, []);
    domains.get(hostname).push(row);
  }
  for (const [hostname, accounts] of [...domains].sort(([a],[b]) => a.localeCompare(b))) {
    const group = element('details', 'domain-group');
    group.open = expandedDomains.has(hostname);
    group.addEventListener('toggle', () => {
      if (group.open) expandedDomains.add(hostname);
      else expandedDomains.delete(hostname);
    });
    const groupHeading = element('summary', 'domain-heading');
    const groupTitle = element('h2', 'domain-title', hostname);
    const arrow = element('span', 'domain-arrow', '›'); arrow.setAttribute('aria-hidden', 'true');
    groupHeading.append(arrow, groupTitle, element('span', 'domain-count', `${accounts.length} 个账号`));
    group.append(groupHeading); list.append(group);
    for (const row of accounts) {
      const card = element('article', 'account-card');
      const heading = element('div','card-heading');
      const identity = element('div','identity');
      const host = new URL(row.url).host;
      identity.append(element('div','site-icon',host[0].toUpperCase()));
      const title = element('div','card-title');
      title.append(element('h3','',row.name || host));
      const link = element('a','site-link',row.url); link.href = row.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      title.append(link); identity.append(title);
      const tools = element('div','card-tools');
      tools.append(action('复制账号', () => openEditor(row, true)), action('编辑', () => openEditor(row)), action('删除', async () => {
        if (await confirmAction('删除这个账号？', `即将删除「${row.name || row.username}」，此操作无法撤销。`)) {
          await mutate(current => current.filter(r => r.id !== row.id)); toast('账号已删除');
        }
      },'danger'));
      heading.append(identity, tools);
      const fields = element('div','credentials');
      const user = element('div','credential');
      user.append(element('span','field-label','登录账号'), element('span','credential-value',row.username), action('复制', () => copy(row.username)));
      const password = element('div','credential');
      const secret = element('input','secret'); secret.type = 'password'; secret.value = row.password; secret.readOnly = true; secret.setAttribute('aria-label','密码');
      let hideTimer;
      const toggle = action('显示', () => {
        clearTimeout(hideTimer);
        const show = secret.type === 'password'; secret.type = show ? 'text' : 'password'; toggle.textContent = show ? '隐藏' : '显示';
        if (show) hideTimer = setTimeout(() => {secret.type = 'password'; toggle.textContent = '显示';}, 15000);
      });
      password.append(element('span','field-label','密码'), secret, toggle, action('复制', () => copy(row.password)));
      fields.append(user,password); card.append(heading,fields);
      if (row.notes) card.append(element('p','notes',row.notes));
      card.append(element('small','updated',`更新于 ${new Date(row.updatedAt).toLocaleString('zh-CN')}`)); group.append(card);
    }
  }
}
function openEditor(row, duplicate = false) {
  editId = duplicate ? null : row?.id || null;
  const form = $('#account-form'); form.reset();
  for (const field of ['url','name','username','password','notes']) form.elements[field].value = row?.[field] || '';
  form.elements.password.type = 'password'; $('#toggle-editor').textContent = '显示';
  $('#editor-title').textContent = duplicate ? '复制账号' : row ? '编辑账号' : '新增账号';
  $('#copy-hint').hidden = !duplicate;
  updateAccountHint(); $('#editor').showModal();
  if (duplicate) { form.elements.url.focus(); form.elements.url.select(); }
}
function updateAccountHint() {
  const form = $('#account-form'), hint = $('#account-hint');
  const username = form.elements.username.value, password = form.elements.password.value;
  let url;
  try { url = cleanUrl(form.elements.url.value); } catch { hint.hidden = true; return; }
  const domainRows = rows.filter(row => row.id !== editId && new URL(row.url).hostname === new URL(url).hostname);
  hint.hidden = !domainRows.length;
  if (!domainRows.length) return;
  const sameUser = domainRows.filter(row => row.username === username);
  const sameCredentials = sameUser.filter(row => row.password === password);
  hint.className = 'account-hint';
  if (sameCredentials.some(row => row.url === url)) {
    hint.textContent = '此页面已存在相同的账号和密码，请勿重复保存。'; hint.classList.add('duplicate');
  } else if (sameCredentials.length) {
    hint.textContent = '此域名的其他页面已有相同的账号和密码。若用于不同页面，仍可保存。';
  } else if (sameUser.length && password) {
    hint.textContent = '此域名已有相同用户名，但密码不同。可作为独立账号保存，不会覆盖已有密码。';
  } else {
    hint.textContent = `此域名已有 ${domainRows.length} 条账号。将同时校验用户名和密码，密码不同时允许保存。`;
  }
}
$('#account-form').addEventListener('input', updateAccountHint);
$('#add').onclick = () => openEditor();
$('#search').oninput = render;
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => document.getElementById(button.dataset.close).close());
$('#editor').addEventListener('close', () => { $('#account-form').reset(); editId = null; });
$('#toggle-editor').onclick = () => {
  const input = $('#account-form').elements.password;
  input.type = input.type === 'password' ? 'text' : 'password';
  $('#toggle-editor').textContent = input.type === 'password' ? '显示' : '隐藏';
};
$('#account-form').onsubmit = async e => {
  e.preventDefault();
  const save = e.submitter; save.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(e.target)); values.url = cleanUrl(values.url);
    await mutate(current => {
      if (current.some(r => r.id !== editId && r.url === values.url && r.username === values.username && r.password === values.password)) throw new Error('此页面已存在相同的账号和密码，请勿重复保存。');
      const old = current.find(r => r.id === editId), now = new Date().toISOString();
      if (editId && !old) throw new Error('此账号已在其他窗口删除，请关闭弹窗后重新操作。');
      const row = {...values, id: old?.id || crypto.randomUUID(), createdAt: old?.createdAt || now, updatedAt: now};
      return old ? current.map(r => r.id === old.id ? row : r) : [...current,row];
    });
    $('#editor').close(); toast('账号已保存');
  } catch(e) { toast(e.message); } finally { save.disabled = false; }
};
$('#import').onclick = () => { $('#import-text').value = ''; $('#file').value = ''; $('#import-preview').textContent = ''; $('#importer').showModal(); };
$('#importer').addEventListener('close', () => { $('#import-text').value = ''; $('#file').value = ''; });
$('#file').onchange = async e => {
  try {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 10 * 1024 * 1024) throw new Error('文件不能超过 10 MB。');
    $('#import-text').value = await file.text(); $('#import-preview').textContent = `已读取：${file.name}`;
  } catch(e) { toast(e.message); }
};
$('#import-submit').onclick = async () => {
  const button = $('#import-submit'); button.disabled = true;
  try {
    const text = $('#import-text').value;
    if (new Blob([text]).size > 10 * 1024 * 1024) throw new Error('导入内容不能超过 10 MB。');
    const incoming = readImport(text);
    if (!incoming.length) throw new Error('没有可导入的账号。');
    const preview = mergeRows(rows,incoming);
    if (!await confirmAction('确认导入', `共读取 ${incoming.length} 条账号，预计新增 ${preview.added} 条、跳过 ${preview.skipped} 条。不会覆盖现有密码。`)) return;
    let result;
    await mutate(current => { result = mergeRows(current,incoming); return result.rows; });
    $('#importer').close(); toast(`已导入 ${result.added} 条，跳过 ${result.skipped} 条`);
  } catch(e) { $('#import-preview').textContent = `导入失败：${e.message}`; } finally { button.disabled = false; }
};
$('#export').onclick = async () => {
  try {
    await load();
    if (!rows.length) return toast('还没有可导出的账号');
    if (!await confirmAction('导出明文备份', '导出文件包含全部账号和密码。请将它保存在安全的位置。')) return;
    const blob = new Blob([exportRows(rows)],{type:'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = `本地账号簿-${new Date().toISOString().slice(0,10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url),10000); toast('已生成 JSON 备份');
  } catch(e) { toast(e.message); }
};
chrome.storage.onChanged.addListener((changes,area) => { if (area === 'local' && changes[STORAGE_KEY]) load().catch(e => toast(e.message)); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { document.querySelectorAll('.secret').forEach(n => n.type = 'password'); $('#account-form').elements.password.type = 'password'; render(); } });
load().catch(e => toast(`读取本地数据失败：${e.message}`));
