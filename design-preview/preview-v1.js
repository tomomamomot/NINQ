/* Standalone prototype. All state lives in this closure; no persistence or network APIs. */
(() => {
  'use strict';
  const M=PreviewModel, $=s=>document.querySelector(s), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const yen=n=>'¥'+Math.round(n).toLocaleString('ja-JP'), now=new Date(), today=M.ymd(now);
  let state=M.seed(now),month=today.slice(0,7),selected=today,theme='business',page='schedule',invoiceCompany='c1',sequence=0,toastTimer,pendingAction;
  const themes={business:{title:'予定と人工',kicker:'WORK CALENDAR',description:'月の流れと、その日の仕事をひと目で。',action:'＋ 予定を追加'},notebook:{title:'今日も、ひと仕事。',kicker:'YOUR DAILY NOTE',description:'現場で開いて、さっと記録。あなたの仕事手帳。',action:'＋ 人工を記録'},dashboard:{title:'今月の仕事を見渡す',kicker:'BUSINESS OVERVIEW',description:'積み重ねた仕事を、次の請求へ。',action:'＋ 予定を追加'}};
  const company=id=>state.companies.find(c=>c.id===id);
  const dateLabel=value=>new Date(value+'T12:00:00').toLocaleDateString('ja-JP',{month:'long',day:'numeric',weekday:'short'});
  function ask(message, action){pendingAction=action;$('#confirm-message').textContent=message;$('#confirm-dialog').showModal();}
  function notify(message){$('#toast').textContent=message;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('#toast').textContent='';},3500);}
  function render(){
    document.body.dataset.theme=theme;
    document.querySelectorAll('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===theme)));
    document.querySelectorAll('[data-page]').forEach(b=>{if(b.dataset.page===page)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    const t=themes[theme];$('#theme-kicker').textContent=page==='schedule'?t.kicker:page==='invoice'?'INVOICE PREVIEW':'YOUR COMPANIES';
    $('#page-title').textContent=page==='schedule'?t.title:page==='invoice'?'仕事を、請求書に。':'いつもの会社を登録';
    $('#design-description').textContent=page==='schedule'?t.description:page==='invoice'?'入力した予定から作る、請求書の見本です。':'名前と単価を整えて、毎日の入力を軽く。';
    $('#new-entry').textContent=t.action;$('#new-entry').hidden=page!=='schedule';
    ['schedule','invoice','settings'].forEach(p=>$('#'+p+'-view').hidden=p!==page);
    renderSchedule();renderInvoice();renderCompanies();
  }
  function renderSchedule(){
    const [year,mon]=month.split('-').map(Number), list=M.monthEntries(state.entries,month),t=M.totals(list);
    $('#month-title').textContent=`${year}年 ${mon}月`;
    $('#metrics').innerHTML=`<div class="metric"><p>今月の売上 · 税抜</p><strong>${yen(t.subtotal)}</strong><small class="metric-foot">この月の記録から集計</small></div><div class="metric"><p>記録した人工</p><strong>${t.qty.toLocaleString('ja-JP')}</strong><small>人工</small><small class="metric-foot">${new Set(list.map(e=>e.date)).size}日分の仕事</small></div><div class="metric"><p>請求書の見本</p><strong>${new Set(list.map(e=>e.companyId)).size}</strong><small>社分</small><small class="metric-foot">すべて下書き・未発行</small></div>`;
    const start=new Date(year,mon-1,1),offset=start.getDay(),count=new Date(year,mon,0).getDate(),cells=Math.ceil((offset+count)/7)*7;
    let html='';for(let i=0;i<cells;i++){
      const day=new Date(year,mon-1,i-offset+1),key=M.ymd(day),rows=state.entries.filter(e=>e.date===key),outside=key.slice(0,7)!==month;
      html+=`<button class="day ${outside?'outside':''} ${key===selected?'selected':''} ${key===today?'is-today':''}" data-day="${key}" aria-pressed="${key===selected}" aria-label="${esc(dateLabel(key))}、${rows.length}件${rows.length?'、'+esc(rows.map(e=>company(e.companyId).name).join('・')):''}"><span class="date-number">${day.getDate()}</span>${rows.slice(0,2).map(e=>`<span class="day-label tone-${company(e.companyId).color}">${esc(company(e.companyId).name)}</span>`).join('')}${rows.length>2?`<span class="day-more">＋${rows.length-2}件</span>`:''}</button>`;
    }$('#calendar-grid').innerHTML=html;
    const entries=state.entries.filter(e=>e.date===selected),sum=M.totals(entries);
    $('#day-panel').innerHTML=`<div class="day-heading"><small>${selected===today?'TODAY · 今日の仕事':'SELECTED DAY · 選択日の仕事'}</small><h2>${esc(dateLabel(selected))}</h2><p class="day-total">${sum.qty}人工 ／ ${yen(sum.subtotal)}</p></div>${entries.length?entries.map(e=>`<article class="entry-card"><span class="company-tag tone-${company(e.companyId).color}">${esc(company(e.companyId).name)}</span><h3>${esc(e.site)}</h3><div class="entry-summary"><span>${e.qty}人工</span><strong>${yen(M.amount(e))}</strong></div>${e.otHours||e.expense?`<p class="entry-note">残業 ${e.otHours}時間 ・ 経費 ${yen(e.expense)}</p>`:''}${e.notes?`<p class="entry-note">${esc(e.notes)}</p>`:''}<button class="edit-button" data-edit="${esc(e.id)}">予定を編集</button></article>`).join(''):'<p class="empty">この日の予定はまだありません。<br>仕事が決まったら、ここに記録。</p>'}<button class="primary" data-add-day>＋ ${theme==='notebook'?'この日の人工を記録':'この日に追加'}</button>`;
    document.querySelector('[data-month="-1"]').disabled=month==='2000-01';document.querySelector('[data-month="1"]').disabled=month==='2100-12';
  }
  function renderInvoice(){
    if(!company(invoiceCompany))invoiceCompany=state.companies[0].id;
    $('#invoice-company').innerHTML=state.companies.map(c=>`<option value="${esc(c.id)}" ${c.id===invoiceCompany?'selected':''}>${esc(c.official)}</option>`).join('');
    $('#invoice-month').value=month;
    const c=company(invoiceCompany),rows=M.monthEntries(state.entries,month,c.id),t=M.totals(rows),[year,mon]=month.split('-').map(Number);
    $('#invoice-body').innerHTML=`<article class="invoice-paper"><div class="invoice-top"><div><h2>請求書</h2><p>${year}年${mon}月分 ／ 月末締めの見本</p></div><span class="invoice-watermark">SAMPLE<br>見本・未発行</span></div><div class="invoice-address"><div><strong>${esc(c.official)} 御中</strong><small>下記の通りご請求申し上げます。</small></div><div>青空ワークス<small>架空の発行者・デザイン確認用</small></div></div><div class="invoice-amount"><span>ご請求金額（税込）</span><strong>${yen(t.total)}</strong></div><div class="invoice-table-wrap"><table class="invoice-table"><thead><tr><th class="date">日付</th><th>作業内容・現場</th><th class="money">人工</th><th class="money">金額</th></tr></thead><tbody>${rows.length?rows.map(e=>`<tr><td class="date">${Number(e.date.slice(5,7))}/${Number(e.date.slice(8))}</td><td>${esc(e.site)}${e.otHours?`<br><small>残業 ${e.otHours}時間 × ${yen(e.otRate)}</small>`:''}${e.expense?`<br><small>経費 ${yen(e.expense)}</small>`:''}</td><td class="money">${e.qty}</td><td class="money">${yen(M.amount(e))}</td></tr>`).join(''):'<tr><td colspan="4">この月の予定はありません。予定を追加すると反映されます。</td></tr>'}</tbody></table></div><div class="invoice-totals"><div><span>人工・残業</span><span>${yen(t.labor)}</span></div><div><span>消費税（10%）</span><span>${yen(t.tax)}</span></div><div><span>経費</span><span>${yen(t.expense)}</span></div><div class="grand"><span>合計</span><span>${yen(t.total)}</span></div></div><p class="invoice-note">デザイン試作・架空データです。この画面から請求書は発行・送信されません。<br>見本の計算：人工＋残業に10%の税額（円未満切り捨て）と経費を加算。試作では全社月末締めです。</p></article>`;
  }
  function renderCompanies(){
    $('#company-list').innerHTML=state.companies.map(c=>`<article class="company-card panel"><span class="company-tag tone-${c.color}">取引会社</span><h3>${esc(c.name)}</h3><p>${esc(c.official)}</p><div class="company-rates"><div><span>人工単価</span><strong>${yen(c.rate)}</strong></div><div><span>残業単価 / 時間</span><strong>${yen(c.otRate)}</strong></div></div></article>`).join('');
  }
  function showEntry(id){
    const current=state.entries.find(e=>e.id===id),c=current?company(current.companyId):state.companies[0],f=$('#entry-form');f.reset();
    f.elements.companyId.innerHTML=state.companies.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const values=current||{id:'',date:selected,companyId:c.id,site:'',qty:1,rate:c.rate,otHours:0,otRate:c.otRate,expense:0,notes:''};
    for(const [key,value] of Object.entries(values))if(f.elements.namedItem(key))f.elements.namedItem(key).value=value;
    $('#entry-title').textContent=current?'予定を編集':'予定を追加';$('#delete-entry').hidden=!current;
    $('#entry-extras').open=!!(current&&(current.otHours||current.expense||current.notes));updateEntryTotal();$('#entry-dialog').showModal();
  }
  function readEntry(){const d=new FormData($('#entry-form'));return {id:d.get('id')||'p'+(++sequence),date:d.get('date'),companyId:d.get('companyId'),site:d.get('site').trim(),qty:Number(d.get('qty')),rate:Number(d.get('rate')),otHours:Number(d.get('otHours')),otRate:Number(d.get('otRate')),expense:Number(d.get('expense')),notes:d.get('notes').trim()};}
  function updateEntryTotal(){const f=$('#entry-form'),e={};for(const k of ['qty','rate','otHours','otRate','expense'])e[k]=Number(f.elements.namedItem(k).value)||0;$('#entry-total').textContent=`この仕事の金額（税抜） ${yen(M.amount(e))}`;}
  document.addEventListener('click',event=>{
    const b=event.target.closest('button');if(!b)return;
    if(b.dataset.themeChoice){theme=b.dataset.themeChoice;render();return;}
    if(b.dataset.page){page=b.dataset.page;render();return;}
    if(b.id==='confirm-action'){const action=pendingAction;pendingAction=null;$('#confirm-dialog').close();if(action)action();return;}
    if(b.dataset.close){$('#'+b.dataset.close).close();return;}
    if(b.dataset.month){const [y,m]=month.split('-').map(Number);month=M.ymd(new Date(y,m-1+Number(b.dataset.month),1)).slice(0,7);selected=month+'-01';render();return;}
    if(b.dataset.day){selected=b.dataset.day;month=selected.slice(0,7);render();if(matchMedia('(max-width:650px)').matches)$('#day-panel').scrollIntoView({block:'start'});return;}
    if(b.dataset.edit){showEntry(b.dataset.edit);return;}
    if(b.id==='new-entry'||b.hasAttribute('data-add-day')){showEntry();return;}
    if(b.id==='today'){selected=today;month=today.slice(0,7);render();return;}
    if(b.id==='new-company'){$('#company-form').reset();$('#company-dialog').showModal();return;}
    if(b.id==='reset'){ask('試作で入力した内容を消して、最初の架空データに戻します。本番のデータには影響しません。',()=>{state=M.seed(now);selected=today;month=today.slice(0,7);invoiceCompany='c1';render();notify('試作を最初の状態に戻しました');});return;}
    if(b.id==='delete-entry'){ask('この試作の予定を削除します。本番の予定には影響しません。',()=>{const id=$('#entry-form').elements.id.value;state.entries=state.entries.filter(e=>e.id!==id);$('#entry-dialog').close();render();notify('試作の予定を削除しました');});}

  });
  $('#entry-form').addEventListener('input',updateEntryTotal);
  $('#entry-form').elements.companyId.addEventListener('change',event=>{const c=company(event.target.value),f=$('#entry-form');f.elements.rate.value=c.rate;f.elements.otRate.value=c.otRate;updateEntryTotal();});
  $('#entry-form').addEventListener('submit',event=>{event.preventDefault();const entry=readEntry();if(!M.validEntry(entry,state.companies)){notify('日付・現場名・金額を確認してください');return;}const i=state.entries.findIndex(e=>e.id===entry.id);if(i<0)state.entries.push(entry);else state.entries[i]=entry;selected=entry.date;month=selected.slice(0,7);$('#entry-dialog').close();render();notify('試作に保存しました。3案で比較できます');});
  $('#company-form').addEventListener('submit',event=>{event.preventDefault();const d=new FormData(event.target),name=d.get('name').trim(),official=d.get('official').trim(),rate=Number(d.get('rate')),otRate=Number(d.get('otRate'));if(!name||!official||!Number.isFinite(rate)||rate<0||!Number.isFinite(otRate)||otRate<0){notify('会社名と単価を確認してください');return;}state.companies.push({id:'c-new'+(++sequence),name,official,rate,otRate,color:state.companies.length%3});$('#company-dialog').close();render();notify('試作に会社を登録しました');});
  $('#invoice-company').addEventListener('change',event=>{invoiceCompany=event.target.value;renderInvoice();});
  $('#invoice-month').addEventListener('change',event=>{if(!event.target.value||!event.target.validity.valid){event.target.value=month;return;}month=event.target.value;selected=month+'-01';render();});
  render();
})();
