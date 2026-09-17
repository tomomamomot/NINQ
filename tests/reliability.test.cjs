const {test}=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {randomUUID}=require('node:crypto'), data=require('../data-core.js');
const entry=(id,extra={})=>({id,date:'2026-09-06',company:'Test',qty:1,unitRate:20000,updatedAt:'2026-09-06T00:00:00Z',...extra});
function app(){
  const memory=new Map(),nodes=new Map();
  const el=()=>({value:'',textContent:'',innerHTML:'',dataset:{},style:{removeProperty(){}},classList:{contains:()=>false,add(){},remove(){},toggle(){}},remove(){},appendChild(){}});
  const localStorage={getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k),key:i=>[...memory.keys()][i],get length(){return memory.size;}};
  const context=vm.createContext({console,crypto:{randomUUID},TextEncoder,localStorage,navigator:{onLine:true},
    document:{body:el(),getElementById(id){if(!nodes.has(id))nodes.set(id,el());return nodes.get(id);},querySelector:()=>null,querySelectorAll:()=>[],createElement:el,addEventListener(){}},
    window:{scrollTo(){},clearTimeout(){},setTimeout(){},addEventListener(){}},alert(){},confirm:()=>true,FileReader:class{readAsText(text){this.result=text;this.onload();}}});
  for(const path of ['data-core.js','app.js','safety-ui.js'])vm.runInContext(fs.readFileSync(path,'utf8'),context,{filename:path});
  vm.runInContext('renderAll=()=>{};renderSyncScreen=()=>{};renderSaveStatus=()=>{};showSaveFeedback=()=>{};',context);
  const run=code=>vm.runInContext(code,context);
  run(`state=normalizeState({entries:[${JSON.stringify(entry('a'))}],settings:{}});selectedCompany='Test';`);
  return {run,memory,context,nodes};
}
test('invalid JSON and versions leave data untouched',()=>{
 const {run}=app();run(`saveState();importBackupJson('{}');`);assert.equal(run('state.entries.length'),1);assert.equal(run('pendingBackup'),null);
 for(const value of [{},{app:'Other',entries:[],settings:{}},{version:99,state:{entries:[],settings:{}}},{entries:[entry('a',{date:'2026-02-30'})],settings:{}},{entries:[entry('a',{unitRate:'bad'})],settings:{}}])assert.throws(()=>data.validateBackup(value));
});
test('startup does not write, legacy data survives quota failures',()=>{
 const {run,memory}=app();const raw=JSON.stringify({entries:[entry('a')],settings:{}});memory.set('ninq-v2',raw);run(`localStorage.setItem=()=>{throw Error('quota')};state=loadState();`);
 assert.equal(run('state.entries.length'),1);assert.equal(memory.get('ninq-v2'),raw);assert.equal(run('saveState()'),false);assert.match(run('storageFailure'),/未保存/);
});
test('corrupt storage cannot be overwritten',()=>{
 const {run,memory}=app();memory.set('ninq-v2:guest','{broken');run('state=loadState()');assert.equal(run('saveState()'),false);assert.equal(memory.get('ninq-v2:guest'),'{broken');
});
test('seventh and archived expenses appear in all totals',()=>{
 const {run}=app();run(`state.settings.expenseItems.push({id:'extra',label:'Rental',archived:true});state.entries[0].expenses={extra:3000};`);
 assert.equal(run('calcEntry(state.entries[0]).expenses'),3000);assert.equal(run('invoiceTotals(state.entries).expenseTotal'),3000);assert.equal(run('desktopSheetTotals(state.entries,desktopSheetExpenseColumns()).expenseTotal'),3000);assert.equal(run('invoiceTotals(state.entries).total'),25000);
});
test('expense rename, reorder and retirement keep IDs and amounts',()=>{
 const {run}=app();run(`state.entries[0].expenses={exp1:3000};state.settings.expenseItems[0].label='Rental';state.settings.expenseItems[0].archived=true;state.settings.expenseItems.reverse();`);
 assert.equal(run(`invoiceTotals(state.entries).expenses.find(c=>c.item.id==='exp1').label`),'Rental');assert.equal(run('invoiceTotals(state.entries).expenseTotal'),3000);assert.equal(run(`expenseItems().some(e=>e.id==='exp1')`),false);
});
test('paper stays six expense columns and includes extra detail',()=>{
 const {run}=app();run(`state.settings.expenseItems=Array.from({length:8},(_,i)=>({id:'e'+i,label:'Expense '+i}));state.entries[0].expenses={e7:3000};`);
 const columns=run('NinqData.paperColumns(invoiceTotals(state.entries).expenses)');assert.equal(columns.length,6);assert.equal(columns[5].label,'追加経費');
 const html=run('buildDemenSheet(state.entries,invoiceTotals(state.entries),false)');assert.match(html,/追加経費 明細/);assert.match(html,/Expense 7/);assert.match(html,/3,000/);
});
test('different overtime rates produce consistent individual lines',()=>{
 const {run}=app();run(`state.entries=[normalizeEntry(${JSON.stringify(entry('a',{otHours:1,otRate:2000}))}),normalizeEntry(${JSON.stringify(entry('b',{otHours:1,otRate:3000}))})];`);
 const html=run('buildInvoiceSheet(state.entries,invoiceTotals(state.entries),false)');
 for(const money of ['2,000','3,000'])assert.ok(html.includes(`<td>1</td><td>h</td><td class="right">${money}</td><td class="right">${money}</td>`));
});
test('issued invoice survives tax, bank and source changes plus backup roundtrip',()=>{
 const {run}=app();run(`state.settings.bank='Old Bank';finalizeInvoice();window.original=JSON.stringify(state.invoices[0]);state.settings.taxRate=8;state.settings.bank='New Bank';state.entries=[];`);
 assert.equal(run('state.invoices[0].totals.total'),22000);assert.equal(run('state.invoices[0].snapshot.settings.bank'),'Old Bank');assert.equal(run('renderInvoiceArchive()'),true);assert.equal(run('JSON.stringify(state.invoices[0])===window.original'),true);
 assert.equal(data.validateBackup(JSON.parse(run(`JSON.stringify({app:'NINQ',version:3,state})`))).invoices.length,1);
});
test('revision saves separately and links to the original',()=>{
 const {run}=app();run(`finalizeInvoice();invoiceRevisionDraft={...clone(state.invoices[0]),revises:state.invoices[0].id};invoiceRevisionDraft.totals.total=24000;selectedInvoiceId='';finalizeInvoice();`);
 assert.equal(run('state.invoices.length'),2);assert.equal(run('state.invoices[0].totals.total'),22000);assert.equal(run('state.invoices[1].revises===state.invoices[0].id'),true);
});
test('cancel or failed recovery copy cannot replace records',()=>{
 const {run}=app();run(`pendingBackup=normalizeState({entries:[],settings:{}});pendingBackupOwner=activeOwner;confirm=()=>false;`);assert.equal(run(`commitBackup('replace')`),false);assert.equal(run('state.entries.length'),1);
 run(`confirm=()=>true;localStorage.setItem=()=>{throw Error('quota')};`);assert.equal(run(`commitBackup('replace')`),false);assert.equal(run('state.entries.length'),1);
});
test('restore adds generation, deletion history and a recovery copy',()=>{
 const {run,memory}=app();run(`pendingBackup=normalizeState({entries:[],settings:{}});pendingBackupOwner=activeOwner;`);assert.equal(run(`commitBackup('replace')`),true);assert.equal(run('state.entries.length'),0);assert.equal(run('state.pendingRestore.base'),'initial');assert.notEqual(run('state.restoreGeneration'),'initial');assert.ok([...memory.keys()].some(k=>k.startsWith('ninq-recovery-')));
});
test('account change isolates local records and metadata',()=>{
 const {run,memory}=app();run(`activeOwner='A';firebaseUser={uid:'A'};saveState();saveSyncMeta({lastSyncedAt:'A-only'});activateAccount({uid:'B'});`);
 assert.equal(run('state.entries.length'),0);assert.equal(run('loadSyncMeta().lastSyncedAt'),'');assert.equal(JSON.parse(memory.get('ninq-v2:A')).entries[0].id,'a');assert.equal(JSON.parse(memory.get('ninq-v2:B')).entries.length,0);
});
test('late response from old account cannot change the new account',async()=>{
 const {run}=app();run(`activeOwner='A';firebaseUser={uid:'A'};window.NinqFirebaseCloud={syncState:()=>new Promise(resolve=>window.finish=resolve)};window.work=safeSyncCloud();activeOwner='B';firebaseUser={uid:'B'};accountEpoch++;state=normalizeState(DEFAULT_STATE);window.finish({conflict:false,payload:{state:normalizeState({entries:[${JSON.stringify(entry('private-A'))}],settings:{}})}});`);
 await run('window.work');assert.equal(run('state.entries.length'),0);
});
test('old restore generation is backed up instead of resurrected',async()=>{
 const {run,memory}=app();run(`activeOwner='A';firebaseUser={uid:'A'};window.NinqFirebaseCloud={syncState:async()=>({conflict:true,payload:{state:{entries:[],settings:{},restoreGeneration:'new'}}})};`);await run('safeSyncCloud()');assert.equal(run('state.entries.length'),0);assert.equal(run('state.restoreGeneration'),'new');assert.ok([...memory.keys()].some(k=>k.startsWith('ninq-recovery-')));
});
test('edit during sync stays pending',async()=>{
 const {run}=app();run(`activeOwner='A';firebaseUser={uid:'A'};window.NinqFirebaseCloud={syncState:()=>new Promise(resolve=>window.finish=resolve)};window.work=safeSyncCloud();state.entries.push(normalizeEntry(${JSON.stringify(entry('new'))}));saveState();window.finish({conflict:false,payload:{state:normalizeState(DEFAULT_STATE)}});`);await run('window.work');assert.equal(run('state.entries.length'),2);assert.equal(run('loadSyncPending().pending'),true);
});
test('offline changes remain pending',async()=>{
 const {run}=app();run(`activeOwner='A';firebaseUser={uid:'A'};navigator.onLine=false;window.NinqFirebaseCloud={};`);await run('safeSyncCloud()');assert.equal(run('loadSyncPending().pending'),true);assert.equal(run('state.entries.length'),1);
});
test('explicit legacy import only imports once and keeps source',()=>{
 const {run,memory}=app();memory.set('ninq-v2',JSON.stringify({entries:[entry('guest')],settings:{}}));run(`activeOwner='A';firebaseUser={uid:'A'};state=normalizeState(DEFAULT_STATE);importGuestData();importGuestData();`);assert.equal(run('state.entries.length'),1);assert.equal(run('state.migrationIds.length'),1);assert.ok(memory.has('ninq-v2'));
});
test('deletion wins over stale edit',()=>{assert.equal(data.mergeItems([entry('a')],[entry('a',{updatedAt:'2026-09-05T00:00:00Z'})],{a:'2026-09-07T00:00:00Z'}).length,0);});
test('closing date and multi-day contract retain one charge',()=>{
 const {run}=app();run(`state.settings.companyRates=[{id:'co',name:'Test',closingDay:20}];cursor=new Date(2026,8,1);`);assert.equal(run('companyBillingRange(selectedCompany).start'),'2026-08-21');assert.equal(run('companyBillingRange(selectedCompany).end'),'2026-09-20');
 run(`state.entries=[normalizeEntry(${JSON.stringify(entry('a',{date:'2026-09-05',billingType:'contract',rangeGroupId:'g',rangeStart:'2026-09-05',rangeEnd:'2026-09-06',contractAmount:100000}))}),normalizeEntry(${JSON.stringify(entry('b',{billingType:'contract',rangeGroupId:'g',rangeStart:'2026-09-05',rangeEnd:'2026-09-06',contractAmount:100000}))})];`);assert.equal(run('invoiceTotals(state.entries).contract'),100000);
});
function cloud(initial=null){
 let saved=initial,revision=0,retries=0;
 const context=vm.createContext({TextEncoder,Date,JSON,window:{NinqData:data},currentUser:{uid:'A'},db:{},serverTimestamp:()=>0,doc:()=>({}),runTransaction:async(db,fn)=>{
   for(let attempt=0;attempt<5;attempt++){
     const readRevision=revision,read=saved;let write;
     const result=await fn({get:async()=>({exists:()=>read!==null,data:()=>read}),set:(ref,next)=>{write=next;}});
     if(readRevision!==revision){retries++;continue;}
     if(write){saved=write;revision++;}return result;
   }
   throw Error('transaction retries exhausted');
 }});
 const source=fs.readFileSync('firebase-sync.js','utf8');vm.runInContext(source.slice(source.indexOf('function stateRef('),source.indexOf('async function signIn('))+source.slice(source.indexOf('async function syncState('),source.indexOf('window.NinqFirebaseCloud')),context);
 return {context,write:(payload,expectedGeneration='initial')=>context.syncState(payload,{uid:'A',expectedGeneration,merge:(a,b)=>data.mergeStates(a,b,(a,b)=>({...b,...a}))}),get:()=>saved,retries:()=>retries};
}
test('two cloud writers preserve independent records',async()=>{
 const c=cloud();await Promise.all(['a','b'].map(id=>c.write({version:3,state:{entries:[entry(id)],settings:{},restoreGeneration:'initial'}})));assert.deepEqual(c.get().payload.state.entries.map(e=>e.id).sort(),['a','b']);assert.ok(c.retries()>0);
});
test('cloud restore rejects older generation without writing',async()=>{
 const c=cloud();await c.write({version:3,state:{entries:[entry('a')],settings:{},restoreGeneration:'initial'}});await c.write({version:3,state:{entries:[],settings:{},restoreGeneration:'new',pendingRestore:{base:'initial'}}});const result=await c.write({version:3,state:{entries:[entry('a')],settings:{},restoreGeneration:'initial'}});assert.equal(result.conflict,true);assert.equal(c.get().payload.state.entries.length,0);
});
test('cloud rejects oversized payload and mismatched account',async()=>{
 const c=cloud();await assert.rejects(c.write({state:{entries:[],settings:{text:'x'.repeat(800001)}}}),/容量/);assert.equal(c.get(),null);c.context.currentUser={uid:'B'};await assert.rejects(c.write({state:{entries:[],settings:{}}}),/ログイン/);
});
test('backup add preserves current records and requires confirmation only for replacement',()=>{
 const {run}=app();run(`pendingBackup=normalizeState({entries:[${JSON.stringify(entry('b'))}],settings:{}});pendingBackupOwner=activeOwner;`);assert.equal(run(`commitBackup('add')`),true);assert.equal(run('state.entries.length'),2);assert.equal(run('state.restoreGeneration'),'initial');
});
test('restore started during an in-flight save is not overwritten by its response',async()=>{
 const {run}=app();run(`activeOwner='A';firebaseUser={uid:'A'};window.NinqFirebaseCloud={syncState:()=>new Promise(resolve=>window.finish=resolve)};window.work=safeSyncCloud();state.restoreGeneration='restored-now';state.pendingRestore={base:'initial'};state.entries=[];saveState();window.finish({conflict:false,payload:{state:normalizeState({entries:[${JSON.stringify(entry('a'))}],settings:{}})}});`);await run('window.work');assert.equal(run('state.restoreGeneration'),'restored-now');assert.equal(run('state.entries.length'),0);assert.ok(run('state.pendingRestore'));
});
test('new expense editor creates stable IDs without altering existing IDs',()=>{
 const {run,nodes}=app();run('renderExpenseEditor()');run(`document.getElementById('st-expense-new').value='Rental';addExpenseItem();`);assert.equal(run('state.settings.expenseItems.length'),7);assert.equal(run('state.settings.expenseItems[0].id'),'exp1');assert.notEqual(run('state.settings.expenseItems[6].id'),'exp7');
});
test('CSV exports preserve issued amounts and unknown expense columns',()=>{
 const {run}=app();run(`state.entries[0].expenses={unknown:1000};finalizeInvoice();state.settings.taxRate=8;downloadCsv=(name,rows)=>{window.csv=rows};exportInvoiceCsv();`);assert.equal(run(`window.csv.find(row=>row[0]==='合計')[1]`),23000);run('exportDemenCsv()');assert.equal(run(`window.csv[0].includes('旧経費 (unknown)')`),true);assert.equal(run('window.csv[1].at(-1)'),21000);
});
test('reusable previous entry clears variable charges and keeps the chosen date',()=>{
 const {run}=app();run(`document.getElementById('f-date').value='2026-10-01';document.getElementById('f-ot-hours').value='2';document.getElementById('f-notes').value='old';reusePreviousEntry();`);assert.equal(run(`document.getElementById('f-date').value`),'2026-10-01');assert.equal(run(`document.getElementById('f-ot-hours').value`),'');assert.equal(run(`document.getElementById('f-notes').value`),'');assert.equal(run(`document.getElementById('f-rate').value`),20000);
});
test('HTML IDs are unique and all local app assets are precached',()=>{
 const html=fs.readFileSync('index.html','utf8'),sw=fs.readFileSync('sw.js','utf8');const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
 for(const match of html.matchAll(/(?:src|href)="([^"#]+\.js\?[^"#]+|styles\.css\?[^"#]+)"/g))assert.ok(sw.includes(match[1]),match[1]);
 assert.ok(!sw.slice(sw.indexOf("'install'"),sw.indexOf("'activate'")).includes('skipWaiting'));
});
test('generate long-name multipage print layout fixtures',()=>{
 const {run}=app();run(`state.settings.name='検証用の長い氏名';state.settings.companyName='株式会社検証用建設設備工事サービス';state.settings.expenseItems=Array.from({length:8},(_,i)=>({id:'e'+i,label:'経費項目'+(i+1)}));state.entries=Array.from({length:36},(_,i)=>normalizeEntry({id:'entry'+i,date:'2026-09-'+String(i%28+1).padStart(2,'0'),company:'長い名称を持つ取引先建設設備工事株式会社',site:'長い名称を持つ現場の改修工事その'+i,billingType:'contract',contractAmount:10000+i,expenses:{e7:3000},updatedAt:'2026-09-06T00:00:00Z'}));selectedCompany=state.entries[0].company;cursor=new Date(2026,8,1);`);
 const sheets=run('buildInvoiceSheet(state.entries,invoiceTotals(state.entries),false)+buildDemenSheet(state.entries,invoiceTotals(state.entries),false)');assert.match(sheets,/追加経費 明細/);assert.match(sheets,/経費項目8/);
 const css=fs.readFileSync('styles.css','utf8').replaceAll('@media print','@media screen');fs.mkdirSync('review/print-qa',{recursive:true});
 for(const kind of ['invoice','demen'])fs.writeFileSync(`review/print-qa/${kind}.html`,`<!doctype html><html lang="ja"><meta charset="utf-8"><title>印刷レイアウト検証 ${kind}</title><style>${css}</style><body><div id="sc-inv" class="screen print-active printing-${kind}">${sheets}</div></body></html>`);
});


test('diagnostics identify date, field and negative value without accusatory wording',()=>{
 const p={entries:[entry('bad',{date:'2026-09-08',otRate:-3,otHours:0})],settings:{}};
 assert.throws(()=>data.validateBackup(p),error=>/2026-09-08/.test(error.message)&&/残業単価 = -3/.test(error.message)&&/可能性/.test(error.message)&&!error.message.includes('不正'));
 assert.equal(p.entries[0].otRate,-3);
});
test('diagnostics distinguish text numbers, empty values and expense names',()=>{
 assert.throws(()=>data.validateBackup({entries:[entry('a',{qty:'1',otRate:null,expenses:{x:-2}})],settings:{expenseItems:[{id:'x',label:'交通費'}]}}),error=>/文字形式/.test(error.message)&&/値が空/.test(error.message)&&/交通費/.test(error.message));
});
const oldInvalidCloud=()=>({payload:{version:1,state:{entries:[entry('bad',{date:'2026-09-08',otRate:-3})],settings:{},restoreGeneration:'initial'}}});
test('deleting an invalid legacy cloud entry succeeds before value validation',async()=>{
 const original=oldInvalidCloud(),c=cloud(original);
 await c.write({version:3,state:{entries:[],settings:{},restoreGeneration:'initial',deletedEntryIds:{bad:'2026-09-18T00:00:00Z'}}});
 assert.equal(c.get().payload.state.entries.length,0);assert.equal(original.payload.state.entries[0].otRate,-3);
});
test('correcting invalid cloud data succeeds but stale deletion cannot hide newer data',async()=>{
 const c=cloud(oldInvalidCloud());await c.write({version:3,state:{entries:[entry('bad',{date:'2026-09-08',otRate:0,updatedAt:'2026-09-18T00:00:00Z'})],settings:{},restoreGeneration:'initial'}});assert.equal(c.get().payload.state.entries[0].otRate,0);
 const stale=cloud(oldInvalidCloud());await assert.rejects(stale.write({version:3,state:{entries:[],settings:{},deletedEntryIds:{bad:'2026-09-01T00:00:00Z'},restoreGeneration:'initial'}}),/残業単価 = -3/);
});
test('unresolved cloud error and a different generation cannot be bypassed',async()=>{
 const original=oldInvalidCloud(),c=cloud(original);
 await assert.rejects(c.write({version:3,state:{entries:[],settings:{},restoreGeneration:'initial'}}),/2026-09-08/);assert.equal(c.get(),original);
 original.payload.state.restoreGeneration='elsewhere';
 await assert.rejects(c.write({version:3,state:{entries:[],settings:{},restoreGeneration:'initial',deletedEntryIds:{bad:'2026-09-18T00:00:00Z'}}}),/残業単価/);assert.equal(c.get(),original);
});
