const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const M=require('../design-preview/preview-model-v1.js');
test('demo data is fresh, valid and isolated on every reset',()=>{
 const now=new Date(2026,8,23),a=M.seed(now),b=M.seed(now);
 assert.ok(a.entries.length>10);assert.ok(a.entries.every(e=>M.validEntry(e,a.companies)));
 a.entries[0].site='Changed';a.companies[0].rate=1;
 assert.notEqual(a.entries[0].site,b.entries[0].site);assert.equal(b.companies[0].rate,25000);
});
test('entry edits and deletes recalculate selected-company invoice without altering other months',()=>{
 const s=M.seed(new Date(2026,8,23)),rows=M.monthEntries(s.entries,'2026-09','c1'),before=M.totals(rows);
 const e={...rows[0],id:'new',qty:2,rate:10000,otHours:1,otRate:3000,expense:1000};
 s.entries.push(e);const after=M.totals(M.monthEntries(s.entries,'2026-09','c1'));
 assert.equal(after.subtotal-before.subtotal,24000);assert.equal(after.total-before.total,26300);
 e.qty=1;assert.equal(M.totals(M.monthEntries(s.entries,'2026-09','c1')).total-before.total,15300);
 s.entries=s.entries.filter(x=>x.id!=='new');assert.deepEqual(M.totals(M.monthEntries(s.entries,'2026-09','c1')),before);
 assert.equal(M.monthEntries(s.entries,'2026-10').length,0);
});
test('invalid numeric values, dates and unknown companies are rejected',()=>{
 const s=M.seed(new Date(2026,8,23)),e=s.entries[0];
 for(const extra of [{qty:-1},{rate:NaN},{date:'2026-02-30'},{companyId:'missing'},{site:'  '}])assert.equal(M.validEntry({...e,...extra},s.companies),false);
});
test('prototype contains no production imports, network, persistence or PWA hooks',()=>{
 const folder='design-preview/';
 const html=fs.readFileSync(folder+'index.html','utf8');
 const scripts=['preview-model-v1.js','preview-v1.js'].map(x=>fs.readFileSync(folder+x,'utf8')).join('\n');
 assert.doesNotMatch(scripts,/\b(localStorage|sessionStorage|indexedDB|caches|serviceWorker|fetch|XMLHttpRequest|WebSocket|sendBeacon)\b/);
 assert.doesNotMatch(html,/firebase|\.\.\/|https?:|manifest/);
 for(const ref of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))assert.ok(fs.existsSync(folder+ref[1]));
 assert.match(html,/デザイン試作・架空データ/);assert.match(html,/入力内容は再読み込みでリセット/);
});
