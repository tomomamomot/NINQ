const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const M=require('../visual-preview/visual-model-v1.js');
test('visual preview keeps week-crossing bands and overlapping jobs in independent lanes',()=>{
 const s=M.seed(),weeks=M.weeks('2026-09',s.entries),parts=weeks.flatMap(w=>w.segments).filter(x=>x.entry.id==='e12');
 assert.equal(parts.length,2);assert.equal(parts[0].continuesAfter,true);assert.equal(parts[1].continuesBefore,true);
 for(const w of weeks)for(const a of w.segments)for(const b of w.segments)if(a!==b&&a.lane===b.lane)assert.ok(a.right<b.left||b.right<a.left);
 assert.ok(weeks[4].segments.some(x=>x.lane===2));
});
test('month totals count only in-month work including boundary-spanning and fixed-price jobs',()=>{
 const s=M.seed();assert.deepEqual(M.totals('2026-09',s.entries),{qty:29,sales:960000});
 const e={...s.entries[0],id:'new',start:'2026-09-30',end:'2026-10-02',qty:0.5,rate:20000};s.entries.push(e);
 assert.deepEqual(M.totals('2026-09',s.entries),{qty:29.5,sales:970000});
 e.rate=30000;assert.equal(M.totals('2026-09',s.entries).sales,975000);
 s.entries=s.entries.filter(x=>x.id!=='new');assert.equal(M.totals('2026-09',s.entries).sales,960000);
});
test('invalid dates and numeric input rejected, reset seeds are independent',()=>{
 const a=M.seed(),b=M.seed();assert.ok(a.entries.every(e=>M.validEntry(e,a.companies)));
 for(const x of [{start:'2026-02-30'},{end:'2020-01-01'},{qty:NaN},{rate:-1},{company:'unknown'},{site:'  '}])assert.equal(M.validEntry({...a.entries[0],...x},a.companies),false);
 a.companies[0].name='test';a.entries[0].site='test';assert.equal(b.companies[0].name,'青空建設');assert.equal(b.entries[0].site,'ひだまり住宅');
});
test('preview assets do not connect to production, persistence, network or service worker',()=>{
 const root='visual-preview/',html=fs.readFileSync(root+'index.html','utf8'),scripts=['visual-v1.js','visual-model-v1.js'].map(f=>fs.readFileSync(root+f,'utf8')).join('\n');
 assert.doesNotMatch(scripts,/\b(localStorage|sessionStorage|indexedDB|caches|serviceWorker|fetch|XMLHttpRequest|WebSocket|sendBeacon)\b/);
 assert.doesNotMatch(html,/firebase|\.\.\/|https?:|manifest/);
 for(const r of html.matchAll(/(?:src|href)="\.\/([^"#]+)"/g))assert.ok(fs.existsSync(root+r[1]));
 assert.match(html,/デザイン見本・架空データ/);
});
test('refined palette meets 4.5:1 contrast for text on schedule bands and surfaces',()=>{
 const css=fs.readFileSync('visual-preview/visual-v2.css','utf8').split('*{')[0];
 const vars=Object.fromEntries([...css.matchAll(/--([\w-]+):(#\w{6})/g)].map(x=>[x[1],x[2]]));
 const lum=hex=>hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
 for(const [a,b] of [['ink','#ffffff'],['muted','#ffffff'],['muted','bg'],['day-ink','day'],['night-ink','night'],['contract-ink','contract'],['#ffffff','navy']]){const x=lum(vars[a]||a),y=lum(vars[b]||b);assert.ok((Math.max(x,y)+.05)/(Math.min(x,y)+.05)>=4.5,a+' / '+b);}
});

