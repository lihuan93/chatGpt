export function cleanUrl(value) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('网址必须为 http 或 https，且不能包含登录凭据。');
  }
  return url.href;
}

export function pageKey(value) {
  const url = new URL(value);
  // Keep hash-router paths, but ignore ordinary anchors and transient query strings.
  const route = /^#(?:\/|!)/.test(url.hash) ? url.hash.split('?')[0] : '';
  return url.origin + url.pathname + route;
}

export function matchingAccounts(rows, pageUrl, scope = 'page') {
  let page;
  try { page = new URL(pageUrl); } catch { return []; }
  if (!['http:', 'https:'].includes(page.protocol)) return [];
  return rows.filter(row => {
    try {
      const saved = new URL(row.url);
      return ['http:', 'https:'].includes(saved.protocol) && saved.hostname === page.hostname &&
        (scope === 'domain' || pageKey(saved.href) === pageKey(page.href));
    } catch { return false; }
  }).sort((a,b) => Number(pageKey(b.url) === pageKey(page.href)) - Number(pageKey(a.url) === pageKey(page.href)) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

// Strip trailing commas only outside JSON strings; never evaluate imported code.
export function parseJson(text) {
  const source = text.replace(/^\uFEFF/, '');
  let result = '', quoted = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      result += c;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else {
      if (c === '"') quoted = true;
      if (c === ',' && /^[\s]*[}\]]/.test(source.slice(i + 1))) continue;
      result += c;
    }
  }
  return JSON.parse(result);
}

export function readImport(text) {
  const data = parseJson(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 顶层必须是“网址: 账号数组”的对象。');
  const rows = [], now = new Date().toISOString();
  for (const [key, accounts] of Object.entries(data)) {
    const url = cleanUrl(key);
    if (!Array.isArray(accounts)) throw new Error(`${key} 对应的内容必须是数组。`);
    for (const account of accounts) {
      if (!account || typeof account !== 'object' || Array.isArray(account)) throw new Error('账号条目必须是对象。');
      for (const field of ['username', 'password']) {
        if (typeof account[field] !== 'string') throw new Error(`每个账号的 ${field} 必须是字符串。`);
      }
      for (const field of ['name', 'notes']) {
        if (account[field] !== undefined && typeof account[field] !== 'string') throw new Error(`${field} 必须是字符串。`);
      }
      const validDate = v => typeof v === 'string' && Number.isFinite(Date.parse(v));
      rows.push({id: crypto.randomUUID(), url, name: account.name || '', username: account.username,
        password: account.password, notes: account.notes || '',
        createdAt: validDate(account.createdAt) ? account.createdAt : now,
        updatedAt: validDate(account.updatedAt) ? account.updatedAt : now});
    }
  }
  return rows;
}

// Preserve different passwords, even for the same URL and username.
export function mergeRows(existing, incoming) {
  const rows = [...existing];
  const keys = new Set(existing.map(r => JSON.stringify([r.url, r.username, r.password])));
  let skipped = 0;
  for (const row of incoming) {
    const key = JSON.stringify([row.url, row.username, row.password]);
    if (keys.has(key)) { skipped++; continue; }
    keys.add(key); rows.push(row);
  }
  return {rows, added: rows.length - existing.length, skipped};
}

export function exportRows(rows) {
  const data = Object.create(null);
  for (const {url, id, ...account} of rows) (data[url] ??= []).push(account);
  return JSON.stringify(data, null, 2);
}
