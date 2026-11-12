// This function is serialized by chrome.scripting; keep it self-contained.
export function fillLogin({hostname, username, password, expectedPage}) {
  if (!['https:', 'http:'].includes(location.protocol) || location.hostname !== hostname) {
    return {ok:false, message:'页面域名已变化，请重新打开扩展。'};
  }
  const key = value => { const u = new URL(value); return u.origin + u.pathname + (/^#(?:\/|!)/.test(u.hash) ? u.hash.split('?')[0] : ''); };
  if (expectedPage && key(location.href) !== expectedPage) return {ok:false, message:'页面地址已变化，请重新选择账号。'};
  const visible = input => !input.disabled && !input.readOnly && input.getClientRects().length > 0 &&
    getComputedStyle(input).visibility !== 'hidden' && getComputedStyle(input).display !== 'none';
  const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
  const loginPasswords = passwords.filter(input => !['new-password', 'one-time-code'].includes(input.autocomplete));
  const focused = document.activeElement;
  let target = loginPasswords.find(input => input === focused);
  if (!target && focused?.form) {
    const inForm = loginPasswords.filter(input => input.form === focused.form);
    if (inForm.length === 1) target = inForm[0];
  }
  if (!target) target = loginPasswords.find(input => input.autocomplete === 'current-password');
  if (!target && loginPasswords.length === 1) target = loginPasswords[0];
  if (!target) return {ok:false, message:loginPasswords.length > 1 ? '找到多个密码框，请先点击要填充的密码框，再打开扩展。' : '未找到可填写的登录密码框。请先打开登录页面；暂不支持嵌入式 iframe 或 Shadow DOM 登录框。'};
  const inputs = [...(target.form || document).querySelectorAll('input')];
  const candidates = inputs.filter(input => visible(input) && ['text', 'email', 'tel'].includes(input.type) &&
    !['one-time-code','new-password'].includes(input.autocomplete) &&
    Boolean(input.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING));
  const account = candidates.find(input => input.autocomplete === 'username') ||
    candidates.find(input => /user|email|login|account|用户名|账号|邮箱|手机/i.test([input.name,input.id,input.placeholder].join(' '))) || candidates.at(-1);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  const set = (input,value) => {
    setter.call(input,value);
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
  };
  if (account) set(account,username);
  set(target,password); target.focus();
  return {ok:true, message:account ? '已填充账号和密码，请检查后自行登录。' : '已填充密码；未找到用户名输入框。'};
}
