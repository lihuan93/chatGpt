(() => {
  if (window !== window.top) return;
  const host = document.createElement('div');
  const root = host.attachShadow({mode:'closed'});
  const style = document.createElement('style');
  style.textContent = `:host{all:initial;display:block!important;position:fixed!important;z-index:2147483647!important;font:13px/1.5 system-ui,sans-serif!important;color:#29483e!important}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer;border:1px solid #b8cfc3;border-radius:7px;background:#fff;color:#235e49;padding:7px 10px}button:hover{background:#edf5ef}button:disabled{opacity:.6}#panel{margin-top:5px;width:min(320px,calc(100vw - 16px));padding:12px;max-height:calc(100vh - 60px);overflow:auto;background:#fff;border:1px solid #b8cfc3;border-radius:10px;box-shadow:0 6px 24px #0002}header{display:flex;justify-content:space-between;align-items:center}#list{max-height:240px;overflow:auto}.account{display:block;width:100%;text-align:left;margin:6px 0;overflow-wrap:anywhere}.account small{display:block;color:#6a8075}#search{width:100%;margin:8px 0;padding:7px;border:1px solid #b8cfc3;border-radius:6px}p{margin:8px 0;overflow-wrap:anywhere}#scope{width:100%;margin-top:8px}`;
  const trigger = document.createElement('button'); trigger.textContent = '填充账密'; trigger.type = 'button';
  const choose = document.createElement('button'); choose.textContent = '▾'; choose.type = 'button'; choose.setAttribute('aria-label', '选择其他账号'); choose.title = '选择账号或在当前域名下查找';
  const quickStatus = document.createElement('p'); quickStatus.setAttribute('role', 'status'); quickStatus.hidden = true;
  quickStatus.style.cssText = 'max-width:280px;padding:8px;background:white;border:1px solid #b8cfc3;border-radius:7px';
  const panel = document.createElement('section'); panel.id = 'panel'; panel.hidden = true;
  panel.innerHTML = '<header><strong>本地账号簿</strong><button type="button" id="close" aria-label="关闭">×</button></header><input id="search" placeholder="搜索名称、账号或 URL" aria-label="搜索账号"><p id="summary"></p><div id="list"></div><button type="button" id="scope">在当前域名下查找</button><p id="status" role="status"></p>';
  root.append(style, trigger, choose, quickStatus, panel);
  const $ = s => root.querySelector(s);
  let target, scope = 'page', accounts = [], request = 0, busy = false, currentPage;
  const pageKey = () => location.origin + location.pathname + (/^#(?:\/|!)/.test(location.hash) ? location.hash.split('?')[0] : '');
  const eligible = input => input instanceof HTMLInputElement && !input.disabled && !input.readOnly &&
    !['new-password','one-time-code'].includes(input.autocomplete) &&
    (input.type === 'password' || (['text','email','tel'].includes(input.type) &&
      (input.autocomplete === 'username' || /user|email|login|account|用户名|账号|邮箱|手机/i.test([input.id,input.name,input.placeholder].join(' ')) ||
       [...(input.form || document).querySelectorAll('input[type="password"]')].some(p => {
         if (['new-password','one-time-code'].includes(p.autocomplete)) return false;
         const preceding = [...(p.form || document).querySelectorAll('input')].filter(el =>
           ['text','email','tel'].includes(el.type) && !el.disabled && el.getClientRects().length &&
           Boolean(el.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING));
         return preceding.at(-1) === input;
       }))));
  function hide() { host.remove(); panel.hidden = true; request++; }
  function position() {
    if (!target?.isConnected || currentPage !== pageKey()) { hide(); return; }
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) { hide(); return; }
    const width = panel.hidden ? (quickStatus.hidden ? 115 : 280) : Math.min(320, innerWidth - 16);
    host.style.setProperty('left', `${Math.max(8, Math.min(rect.right + 8, innerWidth - width - 8))}px`, 'important');
    const height = host.getBoundingClientRect().height || 36;
    host.style.setProperty('top', `${Math.max(8, Math.min(rect.top, innerHeight - height - 8))}px`, 'important');
  }
  function render() {
    $('#list').replaceChildren();
    $('#summary').textContent = scope === 'page' ? `当前页面 · ${accounts.length} 个账号` : `当前域名 · ${accounts.length} 个账号`;
    $('#scope').textContent = scope === 'page' ? '在当前域名下查找' : '返回当前页面账号';
    const term = $('#search').value.toLowerCase();
    const rows = accounts.filter(a => [a.name,a.username,a.url].join(' ').toLowerCase().includes(term));
    if (!rows.length) { const p = document.createElement('p'); p.textContent = '没有匹配账号，可在当前域名下查找或到扩展中新增。'; $('#list').append(p); }
    for (const a of rows) {
      const button = document.createElement('button');button.type = 'button';button.className = 'account';
      const name = document.createElement('strong'), detail = document.createElement('small');
      name.textContent = a.name || a.username || '未命名账号';detail.textContent = `${a.username} · ${a.url}`;
      button.append(name,detail);button.disabled = busy;
      button.onclick = async event => {
        if (!event.isTrusted || busy) return;
        busy = true; render();
        try {
          target.focus({preventScroll:true});
          const result = await chrome.runtime.sendMessage({type:'fillAccount',id:a.id,scope,page:currentPage});
          $('#status').textContent = result?.error || result?.message || '无法填充，请刷新页面重试。';
        } catch { $('#status').textContent = '扩展已更新或暂不可用，请刷新页面后重试。'; }
        finally { busy = false; render(); position(); }
      };
      $('#list').append(button);
    }
    position();
  }
  async function load() {
    const token = ++request; $('#status').textContent = '正在读取…';
    try {
      const result = await chrome.runtime.sendMessage({type:'listAccounts',scope,page:currentPage});
      if (token !== request) return;
      if (result?.error) throw Error(result.error);
      accounts = result?.accounts || []; $('#status').textContent = ''; render();
    } catch { if (token === request) $('#status').textContent = '无法读取账号，请刷新页面或从扩展图标打开。'; }
  }
  document.addEventListener('focusin', event => {
    if (busy && host.isConnected) return;
    if (!eligible(event.target)) { if (event.target !== host) hide(); return; }
    if (target === event.target && host.isConnected && currentPage === pageKey()) return;
    target = event.target; currentPage = pageKey(); scope = 'page'; accounts = []; panel.hidden = true; quickStatus.hidden = true; $('#search').value = '';
    document.documentElement.append(host); position();
  }, true);
  // Preserve the input selection when interacting with picker buttons.
  root.addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
  trigger.onclick = async event => {
    if (!event.isTrusted || busy) return;
    busy = true; trigger.disabled = true; choose.disabled = true;
    panel.hidden = true; quickStatus.hidden = false; quickStatus.textContent = '正在填充…'; position();
    const token = ++request;
    try {
      target.focus({preventScroll:true});
      // The background reads the latest storage and checks cardinality before filling.
      const result = await chrome.runtime.sendMessage({type:'quickFill',page:currentPage});
      if (token !== request) return;
      if (result?.accounts) {
        scope = 'page'; accounts = result.accounts; $('#search').value = '';
        quickStatus.hidden = true; panel.hidden = false; $('#status').textContent = ''; render();
      } else quickStatus.textContent = result?.error || result?.message || '无法填充，请刷新页面后重试。';
    } catch { if (token === request) quickStatus.textContent = '扩展已更新或暂不可用，请刷新页面后重试。'; }
    finally { busy = false; trigger.disabled = false; choose.disabled = false; if (!panel.hidden) render(); position(); }
  };
  choose.onclick = event => { if (!event.isTrusted || busy) return; quickStatus.hidden = true; panel.hidden = !panel.hidden; position(); if (!panel.hidden) load(); };
  $('#close').onclick = hide;
  $('#scope').onclick = () => { scope = scope === 'page' ? 'domain' : 'page'; $('#search').value = ''; load(); };
  $('#search').oninput = render;
  document.addEventListener('pointerdown', e => { if (!e.composedPath().includes(host) && e.target !== target) hide(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hide(); }, true);
  addEventListener('scroll', position, true);addEventListener('resize', position);
  addEventListener('hashchange', hide);addEventListener('popstate', hide);
})();
