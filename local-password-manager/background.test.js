import {test} from 'node:test';
import assert from 'node:assert/strict';
const url = 'http://192.168.1.41:8080/app/login';
const rows = [
  {id:'a', url, username:'alice', password:'secret'},
  {id:'b', url:'http://192.168.1.41:8080/other/login', username:'bob', password:'other'},
  {id:'c', url:'http://evil.test/app/login', username:'eve', password:'bad'}
];
let sent;
globalThis.chrome = {
  runtime:{onMessage:{addListener(){}}},
  storage:{local:{async get(){return {accountsV1:rows};},async setAccessLevel(){}}},
  scripting:{async executeScript(spec){sent = spec;return [{result:{ok:true}}];}}
};
const {handleMessage} = await import('./background.js');
const sender = {tab:{id:7}, frameId:0, url};
test('picker returns page metadata only; explicit fallback remains within hostname', async () => {
  const page = await handleMessage({type:'listAccounts',page:url},sender);
  assert.deepEqual(page.accounts.map(a=>a.id),['a']);
  assert.equal('password' in page.accounts[0],false);
  const domain = await handleMessage({type:'listAccounts',page:url,scope:'domain'},sender);
  assert.deepEqual(domain.accounts.map(a=>a.id),['a','b']);
});
test('filling rechecks scope and page; only selected secret enters executeScript', async () => {
  await assert.rejects(handleMessage({type:'fillAccount',page:url,id:'b'},sender));
  await assert.rejects(handleMessage({type:'fillAccount',page:url,id:'c',scope:'domain'},sender));
  await assert.rejects(handleMessage({type:'fillAccount',page:url+'/changed',id:'a'},sender));
  assert.equal(await handleMessage({type:'listAccounts',page:url},{...sender,frameId:1}),undefined);
  assert.deepEqual(await handleMessage({type:'fillAccount',page:url,id:'b',scope:'domain'},sender),{ok:true});
  assert.equal(sent.target.tabId,7);
  assert.deepEqual(sent.args,[{hostname:'192.168.1.41',expectedPage:url,username:'bob',password:'other'}]);
});
test('quick fill uses only the current page and fills only when exactly one account remains', async () => {
  sent = null;
  assert.deepEqual(await handleMessage({type:'quickFill',page:url,scope:'domain'},sender),{ok:true});
  assert.equal(sent.args[0].username,'alice');
  rows.push({id:'d',url,username:'second',password:'second-secret'});
  sent = null;
  const multiple = await handleMessage({type:'quickFill',page:url},sender);
  assert.equal(multiple.accounts.length,2);
  assert.equal(sent,null);
  assert.equal('password' in multiple.accounts[0],false);
  rows.pop();
  const missingUrl = 'http://192.168.1.41:8080/missing';
  assert.deepEqual(await handleMessage({type:'quickFill',page:missingUrl},{...sender,url:missingUrl}),{accounts:[]});
  assert.equal(sent,null);
});
