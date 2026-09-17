(function (root) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const time = value => Date.parse(value || '') || 0;
  const canonical = value => JSON.stringify(value, function(key, item) {
    return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item;
  });
  function mergeItems(left = [], right = [], deleted = {}) {
    const items = new Map();
    for (const item of [...left, ...right]) {
      const old = items.get(item.id);
      if (!old || time(item.updatedAt || item.createdAt) > time(old.updatedAt || old.createdAt)
        || (time(item.updatedAt || item.createdAt) === time(old.updatedAt || old.createdAt) && JSON.stringify(item) > JSON.stringify(old))) items.set(item.id, copy(item));
    }
    return [...items.values()].filter(item => !deleted[item.id] || time(item.updatedAt || item.createdAt) > time(deleted[item.id]));
  }
  function mergeMaps(a = {}, b = {}) {
    const out = {...a};
    for (const [key, value] of Object.entries(b)) if (time(value) > time(out[key])) out[key] = value;
    return out;
  }
  function mergeStates(a, b, mergeSettings) {
    const deletedEntryIds = mergeMaps(a.deletedEntryIds, b.deletedEntryIds);
    const invoices = new Map();
    for (const invoice of [...(a.invoices || []), ...(b.invoices || [])]) {
      if (invoices.has(invoice.id) && canonical(invoices.get(invoice.id)) !== canonical(invoice)) throw new Error('同じ請求書IDの内容が異なります。復旧用データを書き出してください');
      invoices.set(invoice.id, copy(invoice));
    }
    return {...copy(b), ...copy(a), settings: mergeSettings(a.settings, b.settings),
      entries: mergeItems(a.entries, b.entries, deletedEntryIds), deletedEntryIds,
      invoices: [...invoices.values()], migrationIds: [...new Set([...(a.migrationIds || []), ...(b.migrationIds || [])])],
      deletedReceiptIds: mergeMaps(a.deletedReceiptIds, b.deletedReceiptIds), receipts: []};
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function entryValueIssues(entries, expenseItems = []) {
    const labels = {qty:'人工',unitRate:'人工単価',otHours:'残業時間',otRate:'残業単価',contractAmount:'請負額',paymentAmount:'外注支払額'};
    const issues = [];
    for (const entry of entries) {
      const location = [entry.date, entry.company || '会社未入力', entry.site || '現場未入力'].join(' / ');
      const values = Object.entries(labels).filter(([key]) => entry[key] !== undefined).map(([key,label]) => [label,entry[key]]);
      for (const [id,value] of Object.entries(entry.expenses || {})) values.push([`経費「${expenseItems.find(item => item?.id === id)?.label || id}」`,value]);
      for (const [label,value] of values) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) continue;
        const shown = JSON.stringify(value) ?? String(value);
        const reason = typeof value === 'number' && value < 0
          ? 'マイナス値です。0以上の値を確認してください（入力時の符号間違いの可能性があります）。'
          : value === null || value === ''
            ? '値が空です。未入力または旧版の保存形式が原因の可能性があります。'
            : typeof value === 'string' && value.trim() && Number.isFinite(Number(value))
              ? '数字が文字形式で保存されています。旧版や取り込み時の保存形式が原因の可能性があります。'
              : '数値として読み取れません。入力内容や取り込み元の形式を確認してください。';
        issues.push(`${location}：${label} = ${shown}。${reason}`);
      }
    }
    return issues;
  }
  function validateBackup(payload, {skipEntryValues = false} = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('バックアップ形式ではありません');
    if (payload.app && payload.app !== 'NINQ') throw new Error('NINQのバックアップを選んでください');
    if (payload.version !== undefined && ![1, 2, 3].includes(payload.version)) throw new Error('このバージョンのバックアップには未対応です');
    const state = payload.state || payload;
    if (!Array.isArray(state.entries) || !state.settings || typeof state.settings !== 'object' || Array.isArray(state.settings)) throw new Error('予定と設定が揃ったバックアップを選んでください');
    if (state.restoreGeneration !== undefined && (typeof state.restoreGeneration !== 'string' || !state.restoreGeneration)) throw new Error('復元データの世代情報を確認してください');
    if (state.pendingRestore && typeof state.pendingRestore.base !== 'string') throw new Error('復元情報の確認が必要です');
    if (state.settings.taxRate !== undefined && (typeof state.settings.taxRate !== 'number' || !Number.isFinite(state.settings.taxRate) || state.settings.taxRate < 0)) throw new Error('税率の確認が必要です');
    if (state.settings.expenseItems !== undefined) {
      if (!Array.isArray(state.settings.expenseItems)) throw new Error('経費設定の確認が必要です');
      const expenses = new Set();
      for (const item of state.settings.expenseItems) {
        if (typeof item === 'string') continue; // legacy backup
        if (!item || typeof item.id !== 'string' || !item.id || expenses.has(item.id) || typeof item.label !== 'string' || !item.label.trim()) throw new Error('経費ID・名称の確認が必要です');
        expenses.add(item.id);
      }
    }
    const ids = new Set();
    for (const entry of state.entries) {
      if (!entry || typeof entry.id !== 'string' || !entry.id || ids.has(entry.id) || !validDate(entry.date)) throw new Error('予定のIDまたは日付の確認が必要です');
      ids.add(entry.id);
      for (const key of ['company','site','workerName','notes']) if (entry[key] !== undefined && typeof entry[key] !== 'string') throw new Error('予定の文字項目の確認が必要です');
    }
    if (!skipEntryValues) {
      const issues = entryValueIssues(state.entries, state.settings.expenseItems || []);
      if (issues.length) throw new Error(`予定の入力内容を確認してください（${issues.length}項目）\n${issues.slice(0, 10).join('\n')}${issues.length > 10 ? '\nほかの項目は修正後の再確認で表示します。' : ''}\n該当する予定を修正・削除してから再試行してください。端末に見当たらない場合は、別端末の予定や更新前のバックアップを確認してください。`);
    }
    if (state.schemaVersion !== undefined && state.schemaVersion !== 3) throw new Error('データ形式の更新が必要です');
    if (state.invoices !== undefined && !Array.isArray(state.invoices)) throw new Error('請求書の形式の確認が必要です');
    const invoiceIds = new Set();
    for (const invoice of state.invoices || []) {
      if (!invoice.id || invoiceIds.has(invoice.id) || !invoice.snapshot || !invoice.totals || !validDate(invoice.period?.start) || !validDate(invoice.period?.end)) throw new Error('確定請求書の確認が必要です');
      invoiceIds.add(invoice.id);
      validateBackup({entries:invoice.snapshot.entries, settings:invoice.snapshot.settings});
      for (const key of ['subtotal','tax','total','expenseTotal']) if (!Number.isFinite(invoice.totals[key])) throw new Error('請求金額の確認が必要です');
    }
    return copy(state);
  }
  function expenseColumns(items, entries) {
    const columns = items.map(item => ({label:item.label, item, ids:[item.id]}));
    const known = new Set(items.map(item => item.id));
    for (const entry of entries) for (const id of Object.keys(entry.expenses || {})) {
      if (!known.has(id)) { columns.push({label:`旧経費 (${id})`,item:{id,label:`旧経費 (${id})`,archived:true},ids:[id]}); known.add(id); }
    }
    return columns;
  }
  function paperColumns(columns) {
    const result = columns.length > 6 ? [...columns.slice(0,5), {label:'追加経費',item:{id:'__extra__'},ids:columns.slice(5).flatMap(col => col.ids)}] : [...columns];
    while (result.length < 6) result.push({label:'',item:{id:`__blank${result.length}`},ids:[]});
    return result;
  }
  root.NinqData = {copy, mergeItems, mergeMaps, mergeStates, validDate, validateBackup, expenseColumns, paperColumns};
  if (typeof module !== 'undefined') module.exports = root.NinqData;
})(typeof globalThis !== 'undefined' ? globalThis : this);
