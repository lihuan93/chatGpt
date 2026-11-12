import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readImport, mergeRows, exportRows, parseJson, cleanUrl, matchingAccounts} from './core.js';

test('imports original format, BOM, and trailing commas; preserves credentials and dates', () => {
  const rows = readImport('\uFEFF{"http://192.168.1.41/page/login_zmkm.html":[{"createdAt":"2026-09-14T08:56:29.985Z","name":"桐庐白小明","username":"tlbxm","password":"x,}\\\"\\\\",},],}');
  assert.equal(rows.length,1);
  assert.equal(rows[0].name,'桐庐白小明');
  assert.equal(rows[0].password,'x,}"\\');
  assert.equal(rows[0].createdAt,'2026-09-14T08:56:29.985Z');
  assert.deepEqual(readImport(exportRows(rows)).map(({id,...r})=>r), rows.map(({id,...r})=>r));
});
test('atomic validation rejects malformed accounts and unsafe URLs', () => {
  for (const source of ['[]','null','{"https://a.test":{}}','{"https://a.test":[{"username":"x","password":1}]}','{"javascript:alert(1)":[]}']) assert.throws(()=>readImport(source));
  assert.throws(()=>cleanUrl('https://user:secret@example.com'));
  assert.throws(()=>parseJson('{bad}'));
});
test('merge keeps existing secrets and deduplicates incoming rows', () => {
  const original = readImport('{"https://a.test":[{"username":"a","password":"old"}]}');
  const incoming = readImport('{"https://a.test/":[{"username":"a","password":"new"},{"username":"b","password":"b"},{"username":"b","password":"c"},{"username":"a","password":"old"},{"username":"b","password":"b"}]}');
  const result = mergeRows(original,incoming);
  assert.equal(result.added,3); assert.equal(result.skipped,2);
  assert.equal(result.rows[0].password,'old');
  assert.deepEqual(result.rows.map(r=>r.password),['old','new','b','c']);
  assert.equal(readImport(exportRows(result.rows)).length,4);
});

test('domain matching permits paths and ports, rejects subdomains and lookalikes', () => {
  const rows = readImport('{"https://example.com/old":[{"username":"a","password":"p"}],"https://login.example.com":[{"username":"b","password":"q"}],"https://example.com.evil.test":[{"username":"c","password":"r"}]}');
  assert.deepEqual(matchingAccounts(rows,'https://example.com:8443/login','domain').map(r=>r.username),['a']);
  assert.deepEqual(matchingAccounts(rows,'chrome://extensions'),[]);
  assert.deepEqual(matchingAccounts(rows,'not a url'),[]);
  const ip = readImport('{"http://192.168.1.41/page/login_zmkm.html":[{"username":"tlbxm","password":"x"}]}');
  assert.equal(matchingAccounts(ip,'http://192.168.1.41/another','domain').length,1);
  assert.equal(matchingAccounts(ip,'http://192.168.1.42/another').length,0);
});


test('page matching separates paths, ports and protocols; ignores query and ordinary anchors', () => {
  const rows = readImport('{"http://192.168.1.41:8080/app/login":[{"username":"app","password":"a"}],"http://192.168.1.41:8080/other/login":[{"username":"other","password":"b"}],"http://192.168.1.41:8081/app/login":[{"username":"port","password":"c"}],"https://192.168.1.41:8080/app/login":[{"username":"tls","password":"d"}]}');
  assert.deepEqual(matchingAccounts(rows,'http://192.168.1.41:8080/app/login?redirect=home#form').map(r=>r.username),['app']);
  assert.equal(matchingAccounts(rows,'http://192.168.1.41:8080/app/login/').length,0);
  assert.equal(matchingAccounts(rows,'http://192.168.1.41:8080/missing').length,0);
  assert.equal(matchingAccounts(rows,'http://192.168.1.41:8080/missing','domain').length,4);
  const hash = readImport('{"https://a.test/#/login":[{"username":"a","password":"x"}],"https://a.test/#/admin":[{"username":"b","password":"y"}]}');
  assert.deepEqual(matchingAccounts(hash,'https://a.test/#/login?redirect=home').map(r=>r.username),['a']);
});
