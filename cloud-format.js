(function(root) {
  const PART_BYTES=180000, MAX_PARTS=32, MAX_WRITE_BYTES=6000000;
  const bytes=text=>new TextEncoder().encode(text).length;
  function pack(payload,revision) {
    const raw=JSON.stringify(payload), parts=[];
    let text='',size=0;
    for(const character of raw) {
      const code=character.codePointAt(0), n=code<=0x7f?1:code<=0x7ff?2:code<=0xffff?3:4;
      if(size+n>PART_BYTES) {parts.push(text);text='';size=0;}
      text+=character;size+=n;
    }
    if(text) parts.push(text);
    // Leave headroom below Firestore's 10 MiB transaction request limit,
    // including escaping, indexes and the one-time legacy recovery document.
    if(parts.length>MAX_PARTS || bytes(JSON.stringify(parts))>MAX_WRITE_BYTES) throw new Error('同期データが分割保存の上限に達しました。端末のデータは保持しています。データを書き出してお知らせください。');
    return {manifest:{storageVersion:1,revision,partCount:parts.length,byteLength:bytes(raw),
      // Previous clients must fail closed rather than merge an empty state.
      payload:{app:'NINQ',version:4}},parts:parts.map(text=>({revision,text}))};
  }
  function partCount(main) {
    if(main.storageVersion!==1 || !Number.isSafeInteger(main.revision) || main.revision<1 || !Number.isInteger(main.partCount) || main.partCount<1 || main.partCount>MAX_PARTS || !Number.isSafeInteger(main.byteLength) || main.byteLength<1 || main.byteLength>PART_BYTES*MAX_PARTS) throw new Error('クラウドの保存形式を確認できません。端末のデータは変更していません。');
    return main.partCount;
  }
  function unpack(main,parts) {
    if(!main.storageVersion) return main.payload || null;
    const count=partCount(main);
    if(parts.length!==count || parts.some(part=>!part || part.revision!==main.revision || typeof part.text!=='string' || bytes(part.text)>PART_BYTES)) throw new Error('クラウドの分割データが揃っていません。端末のデータは変更していません。');
    const raw=parts.map(part=>part.text).join('');
    if(bytes(raw)!==main.byteLength) throw new Error('クラウドのデータサイズが一致しません。再試行してください。');
    return JSON.parse(raw);
  }
  const api={pack,unpack,partCount};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.NinqCloudFormat=api;
})(globalThis);
