(function(root){
  'use strict';
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  function seed(now = new Date()) {
    const companies = [{id:'c1',name:'青空',official:'株式会社青空建設',rate:25000,otRate:3500,color:0},{id:'c2',name:'こもれび',official:'こもれび工務店',rate:28000,otRate:4000,color:1},{id:'c3',name:'みらい',official:'株式会社みらい設備',rate:24000,otRate:3200,color:2}];
    const days = [...new Set([2,3,4,7,8,10,11,14,15,17,18,21,now.getDate(),25,28])];
    const entries = days.map((day,i)=>{const c=companies[Math.floor(i/4)%3];return {id:`e${i}`,date:ymd(new Date(now.getFullYear(),now.getMonth(),day)),companyId:c.id,site:['ひだまり住宅 新築工事','こもれび店舗 改修工事','みらい事務所 内装工事'][Math.floor(i/4)%3],qty:i===4?0.5:1,rate:c.rate,otHours:i%5===0?1:0,otRate:c.otRate,expense:i%3===0?1200:0,notes:i%5===0?'8時に現場集合':''};});
    return {companies,entries};
  }
  function amount(e){return e.qty*e.rate+e.otHours*e.otRate+e.expense;}
  function totals(entries){const labor=entries.reduce((n,e)=>n+e.qty*e.rate+e.otHours*e.otRate,0),expense=entries.reduce((n,e)=>n+e.expense,0),tax=Math.floor(labor*0.1);return {qty:entries.reduce((n,e)=>n+e.qty,0),labor,expense,subtotal:labor+expense,tax,total:labor+expense+tax};}
  function validEntry(e,companies){return /^\d{4}-\d{2}-\d{2}$/.test(e.date)&&ymd(new Date(e.date+'T12:00:00'))===e.date&&companies.some(c=>c.id===e.companyId)&&e.site.trim().length>0&&['qty','rate','otHours','otRate','expense'].every(k=>Number.isFinite(e[k])&&e[k]>=0);}
  function monthEntries(entries,month,company){return entries.filter(e=>e.date.slice(0,7)===month&&(!company||e.companyId===company)).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));}
  const model={seed,ymd,amount,totals,validEntry,monthEntries};
  if(typeof module!=='undefined'&&module.exports)module.exports=model;else root.PreviewModel=model;
})(typeof globalThis!=='undefined'?globalThis:this);
