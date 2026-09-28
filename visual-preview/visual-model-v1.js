(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.VisualModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const iso=d=>d.toISOString().slice(0,10);
  const date=s=>new Date(s+'T00:00:00Z');
  const add=(s,n)=>{const d=date(s);d.setUTCDate(d.getUTCDate()+n);return iso(d);};
  const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(+date(s))&&iso(date(s))===s&&s>='2000-01-01'&&s<='2100-12-31';
  function seed(){
    const companies=[{id:'a',name:'青空建設',short:'青空',formal:'株式会社青空建設',rate:25000,nightRate:30000},{id:'k',name:'こもれび工務店',short:'木漏',formal:'株式会社こもれび工務店',rate:28000,nightRate:33000},{id:'m',name:'みらい住環境リノベーション',short:'みらい',formal:'株式会社みらい住環境リノベーション',rate:26000,nightRate:31000}];
    const specs=[['2026-08-31','2026-09-02','a','ひだまり住宅','day'],['2026-09-02','2026-09-02','k','駅前店舗','night'],['2026-09-04','2026-09-04','m','港町オフィス','contract'],['2026-09-07','2026-09-09','k','桜町の家','day'],['2026-09-10','2026-09-11','a','中央図書館','day'],['2026-09-11','2026-09-13','m','駅前商業施設 改修工事','night'],['2026-09-14','2026-09-17','a','ひだまり住宅','day'],['2026-09-16','2026-09-16','k','北町店舗','night'],['2026-09-19','2026-09-19','m','海辺の家','day'],['2026-09-21','2026-09-23','k','並木通り集合住宅','day'],['2026-09-24','2026-09-25','a','青葉の家','day'],['2026-09-25','2026-09-25','m','南町店舗','night'],['2026-09-26','2026-09-29','a','丘の上の家','day'],['2026-09-28','2026-09-30','m','みなと文化交流センター 改修工事','contract'],['2026-09-28','2026-09-28','k','駅前店舗','night'],['2026-09-30','2026-09-30','k','北町店舗','night'],['2026-10-05','2026-10-07','a','丘の上の家','day']];
    return {companies,entries:specs.map((s,i)=>({id:'e'+i,start:s[0],end:s[1],company:s[2],site:s[3],kind:s[4],qty:s[4]==='contract'?0:1,rate:s[4]==='contract'?40000:companies.find(c=>c.id===s[2])[s[4]==='night'?'nightRate':'rate'],notes:''}))};
  }
  function weeks(month,entries){
    const first=month+'-01',offset=(date(first).getUTCDay()+6)%7,start=add(first,-offset);
    return Array.from({length:6},(_,w)=>{
      const from=add(start,w*7),to=add(from,6),occupied=[];
      const segments=entries.filter(e=>e.start<=to&&e.end>=from).sort((a,b)=>a.start.localeCompare(b.start)||b.end.localeCompare(a.end)||a.id.localeCompare(b.id)).map(e=>{
        const left=Math.max(0,Math.round((date(e.start)-date(from))/86400000)),right=Math.min(6,Math.round((date(e.end)-date(from))/86400000));
        let lane=0;while(occupied[lane]?.some(x=>left<=x.right&&right>=x.left))lane++;
        (occupied[lane]??=[]).push({left,right});
        return {entry:e,left,right,lane,continuesBefore:e.start<from,continuesAfter:e.end>to};
      });
      return {days:Array.from({length:7},(_,i)=>add(from,i)),segments,lanes:Math.max(3,occupied.length)};
    });
  }
  function totals(month,entries){let qty=0,sales=0;for(const e of entries){const from=e.start>month+'-01'?e.start:month+'-01';const d=date(month+'-01');d.setUTCMonth(d.getUTCMonth()+1);d.setUTCDate(0);const end=iso(d),to=e.end<end?e.end:end;if(from>to)continue;const count=Math.round((date(to)-date(from))/86400000)+1;qty+=e.qty*count;sales+=(e.kind==='contract'?e.rate:e.qty*e.rate)*count;}return {qty,sales};}
  function validEntry(e,companies){return validDate(e.start)&&validDate(e.end)&&e.end>=e.start&&(date(e.end)-date(e.start))/86400000<=366&&companies.some(c=>c.id===e.company)&&typeof e.site==='string'&&e.site.trim().length>0&&e.site.length<=80&&['day','night','contract'].includes(e.kind)&&Number.isFinite(e.qty)&&e.qty>=0&&e.qty<=100&&Number.isFinite(e.rate)&&e.rate>=0&&e.rate<=10000000;}
  return {seed,weeks,totals,validEntry,add};
});
