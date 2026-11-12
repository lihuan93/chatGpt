import {matchingAccounts, pageKey} from './core.js';
import {fillLogin} from './fill.js';

// Passwords never go into the account picker DOM or list response.
export async function handleMessage(message, sender) {
  if (!sender.tab || sender.frameId !== 0 || !['listAccounts', 'fillAccount', 'quickFill'].includes(message?.type)) return;
  const url = sender.url;
  if (!/^https?:/.test(url) || pageKey(url) !== message.page) throw Error('页面地址已变化，请重新选择账号。');
  const {accountsV1 = []} = await chrome.storage.local.get('accountsV1');
  const accounts = matchingAccounts(accountsV1, url, message.type !== 'quickFill' && message.scope === 'domain' ? 'domain' : 'page');
  if (message.type === 'listAccounts' || (message.type === 'quickFill' && accounts.length !== 1)) {
    return {accounts:accounts.map(({id, name, username, url}) => ({id, name, username, url}))};
  }
  const account = message.type === 'quickFill' ? accounts[0] : accounts.find(row => row.id === message.id);
  if (!account) throw Error('账号已修改或不属于当前页面，请重新选择。');
  const results = await chrome.scripting.executeScript({target:{tabId:sender.tab.id},func:fillLogin,
    args:[{hostname:new URL(url).hostname, expectedPage:message.page, username:account.username, password:account.password}]});
  return results[0]?.result || {ok:false, message:'页面未返回结果，请刷新后重试。'};
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handleMessage(message, sender).then(respond, error => respond({error:error.message}));
  return true;
});
// Keep credentials accessible only to extension pages/service worker, not content scripts.
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(() => {});
