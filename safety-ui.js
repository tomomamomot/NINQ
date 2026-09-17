// Account lifecycle, recovery and issued documents. Loaded after app.js, before DOMContentLoaded.
function mergeSafeStates(a, b) {
  return NinqData.mergeStates(normalizeState(a), normalizeState(b), mergeSettingsBySection);
}
function accountMatches(uid, epoch) { return activeOwner === uid && firebaseUser?.uid === uid && accountEpoch === epoch; }
function activateAccount(user) {
  const owner = user?.uid || 'guest';
  if (owner === activeOwner) { firebaseUser = user; renderAll(); return; }
  if (storageFailure && !saveState()) {
    try { saveRecovery('アカウント切り替え前の未保存データ'); }
    catch (error) { downloadText('ninq-unsaved.json', JSON.stringify({app:'NINQ',version:3,state}), 'application/json'); }
  }
  accountEpoch++;
  for (const timer of [firebaseSyncTimer, driveSyncTimer, settingsAutosaveTimer]) window.clearTimeout(timer);
  settingsAutosaveTimer = null; settingsAutosaveSections.clear();
  firebaseSyncInFlight = false; firebaseSyncQueued = false; driveSyncInFlight = false; driveSyncQueued = false;
  googleAccessTokens.clear();
  firebaseUser = user; activeOwner = owner; storageFailure = ''; cloudIssue = '';
  state = loadState(); localRevision = 0;
  selectedInvoiceId = ''; invoiceRevisionDraft = null; pendingBackup = null;
  document.getElementById('backup-preview')?.remove();
  closeModal(); closeDayModal(); closeExpenseQuickEdit(); closeSheetPage();
  selectedCompany = ''; activeScreen = 'cal';
  // Remove old account values from forms that are not overwritten by renderSettings.
  document.getElementById('google-client-id').value = state.settings.googleClientId || '';
  document.getElementById('sync-log').textContent = '';
  if (user) { state.settings.googleSyncEnabled = true; saveState(); }
  renderAll();
  if (user) syncFirebaseCloud({auto:true, reason:'startup'});
}
async function safeSyncCloud({auto = false, reason = ''} = {}) {
  if (activeScreen === 'st') flushSettingsAutosave();
  if (!firebaseUser || activeOwner !== firebaseUser.uid || !firebaseAvailable() || storageBlocked || storageFailure) return;
  if (auto && !state.settings.googleSyncEnabled) return;
  if (!navigator.onLine) { saveSyncPending(true,'offline'); renderSyncScreen(); return; }
  if (auto && isEditingSyncSensitiveField()) { scheduleFirebaseAutoSync({delay:8000,reason}); return; }
  if (firebaseSyncInFlight) { firebaseSyncQueued = true; return; }
  const uid = firebaseUser.uid, epoch = accountEpoch, revision = localRevision;
  const submitted = clone(normalizeState(state));
  const expectedGeneration = submitted.pendingRestore?.base || submitted.restoreGeneration;
  firebaseSyncInFlight = true; cloudIssue = ''; renderSaveStatus();
  try {
    const payload = {...firebaseSyncPayload(), state:submitted};
    const result = await window.NinqFirebaseCloud.syncState(payload, {uid, expectedGeneration, merge:mergeSafeStates});
    if (!accountMatches(uid, epoch)) return;
    if (result.conflict) {
      saveRecovery('別端末で復元済み：この端末のデータを退避', state);
      state = normalizeState(result.payload.state || result.payload);
      state.pendingRestore = null;
      if (!saveState()) return;
      cloudIssue = '別端末でデータが復元されました。この端末の変更は復旧用コピーに退避しました';
    } else {
      // A restore made while this request was in flight must be sent as its own generation.
      if (state.restoreGeneration !== submitted.restoreGeneration) { firebaseSyncQueued = true; return; }
      state = mergeSafeStates(state, result.payload.state);
      state.pendingRestore = null;
      if (!saveState()) return;
    }
    saveSyncMeta({lastSyncedAt:new Date().toISOString(),lastCloudModifiedAt:result.payload.modifiedAt || '',lastLocalModifiedAt:localModifiedAt()});
    const changedDuringSync = !result.conflict && revision + 1 !== localRevision;
    saveSyncPending(changedDuringSync, changedDuringSync ? 'save' : '');
    if (changedDuringSync) firebaseSyncQueued = true;
    setSyncLog(cloudIssue || '同期済み：PC・スマホのデータを保存しました');
    renderAll();
  } catch (error) {
    if (!accountMatches(uid, epoch)) return;
    cloudIssue = error.message || '同期に失敗しました';
    saveSyncPending(true, 'retry'); setSyncLog(cloudIssue);
  } finally {
    if (accountMatches(uid, epoch)) {
      firebaseSyncInFlight = false; renderSyncScreen(); renderSaveStatus();
      if (firebaseSyncQueued) { firebaseSyncQueued = false; scheduleFirebaseAutoSync({delay:1000,reason:'save'}); }
    }
  }
}
function guestData() {
  const raw = localStorage.getItem(scopedKey(STORE_KEY,'guest')) || localStorage.getItem(STORE_KEY);
  if (raw) return normalizeState(JSON.parse(raw));
  for (const key of LEGACY_STORE_KEYS) {
    const legacy = localStorage.getItem(key);
    if (legacy) return key === LEGACY_STORE_KEYS[0] ? migrateLegacy(JSON.parse(legacy)) : normalizeState(JSON.parse(legacy));
  }
  return null;
}
function importGuestData() {
  if (!firebaseUser || activeOwner !== firebaseUser.uid || firebaseSyncInFlight) return;
  try {
    const guest = guestData(); if (!guest) return;
    let id = localStorage.getItem('ninq-guest-migration-id');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('ninq-guest-migration-id',id); }
    if (state.migrationIds.includes(id)) { setSyncLog('この端末の旧データは取り込み済みです'); return; }
    if (!confirm(`${firebaseUser.email || 'このアカウント'} に旧データ ${guest.entries.length}件を追加しますか？`)) return;
    saveRecovery('旧データ取り込み前');
    const next = mergeSafeStates(state, {...guest, invoices:guest.invoices || []});
    next.restoreGeneration = state.restoreGeneration; next.pendingRestore = state.pendingRestore;
    next.migrationIds = [...new Set([...(state.migrationIds || []),id])];
    if (!saveState(next)) return;
    state = next; renderAll(); scheduleFirebaseAutoSync({reason:'save'});
  } catch (error) { setSyncLog(error.message); }
}
function prepareBackup(payload) {
  const next = normalizeState(NinqData.validateBackup(payload));
  pendingBackup = next; pendingBackupOwner = activeOwner;
  const host = document.getElementById('sc-sync');
  document.getElementById('backup-preview')?.remove();
  const panel = document.createElement('section'); panel.id = 'backup-preview'; panel.className = 'safety-panel';
  panel.innerHTML = `<strong>読み込み内容を確認</strong><p>現在 ${state.entries.length}予定・${(state.invoices || []).length}確定請求書 → 読み込み ${next.entries.length}予定・${next.invoices.length}確定請求書</p><button data-backup-mode="add">追加</button><button data-backup-mode="replace">置き換え</button><button data-backup-cancel>キャンセル</button>`;
  host.appendChild(panel);
}
function commitBackup(mode) {
  if (!pendingBackup || pendingBackupOwner !== activeOwner) return false;
  try {
    if (mode === 'replace' && !confirm('現在のデータを置き換えます。元データの復旧用コピーを端末に残します。続けますか？')) return false;
    saveRecovery('バックアップ読み込み前');
    let next;
    if (mode === 'add') {
      next = mergeSafeStates(state, {...pendingBackup, deletedEntryIds:{},deletedReceiptIds:{}});
      next.restoreGeneration = state.restoreGeneration || 'initial'; next.pendingRestore = state.pendingRestore;
    } else {
      next = clone(pendingBackup);
      next.restoreGeneration = crypto.randomUUID();
      next.pendingRestore = {base:state.pendingRestore?.base || state.restoreGeneration || 'initial'};
      const kept = new Set(next.entries.map(entry => entry.id));
      next.deletedEntryIds = {...state.deletedEntryIds, ...next.deletedEntryIds};
      for (const entry of state.entries) if (!kept.has(entry.id)) next.deletedEntryIds[entry.id] = new Date().toISOString();
      for (const entry of next.entries) delete next.deletedEntryIds[entry.id];
    }
    if (!saveState(next)) return false;
    state = next; pendingBackup = null; selectedInvoiceId = ''; invoiceRevisionDraft = null;
    document.getElementById('backup-preview')?.remove();
    renderAll(); scheduleFirebaseAutoSync({reason:'save'}); return true;
  } catch (error) { setSyncLog(`読み込みを中止しました：${error.message}`); return false; }
}
function renderSaveStatus() {
  const host = document.getElementById('home-storage-status'); if (!host) return;
  let label = '端末保存済み';
  const meta = loadSyncMeta(), pending = loadSyncPending();
  if (storageFailure) label = storageFailure;
  else if (cloudIssue) label = `要対応：${cloudIssue}`;
  else if (firebaseSyncInFlight) label = '同期中';
  else if (pending.pending) label = navigator.onLine ? '未送信' : '未送信（オフライン）';
  else if (firebaseUser && meta.lastSyncedAt) label = '同期済み';
  host.textContent = label + (meta.lastSyncedAt ? ` ／ 最終同期 ${new Date(meta.lastSyncedAt).toLocaleString('ja-JP')}` : '');
}
function installUpdateFlow() {
  if (!('serviceWorker' in navigator)) return;
  let requested = false;
  let hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    if (requested) window.location.reload();
    else showUpdate('更新が適用されました。入力を保存してから画面を再読み込みしてください');
  });
  function showUpdate(message, worker) {
    const host = document.getElementById('update-notice'); if (!host) return;
    host.hidden = false; host.textContent = message;
    const button = document.createElement('button'); button.textContent = '保存後に更新';
    button.onclick = () => {
      if (document.getElementById('modal-bg')?.classList.contains('open') || document.activeElement?.matches('input,textarea,select') || firebaseSyncInFlight) {
        alert('入力画面を保存して閉じ、同期の終了後に更新してください'); return;
      }
      if (activeScreen === 'st') flushSettingsAutosave();
      if (!saveState()) return;
      requested = true;
      if (worker) worker.postMessage({type:'ACTIVATE_UPDATE'}); else window.location.reload();
    };
    host.appendChild(button);
  }
  navigator.serviceWorker.register('./sw.js').then(registration => {
    if (registration.waiting) showUpdate('新しい版があります。', registration.waiting);
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate('新しい版があります。', registration.waiting || worker);
      });
    });
  }).catch(() => { cloudIssue = 'オフライン用の保存に失敗しました'; renderSaveStatus(); });
}
function renderRecoveryList() {
  const host = document.getElementById('recovery-list'); if (!host) return;
  const keys = [];
  for (let i=0;i<localStorage.length;i++) { const key = localStorage.key(i); if (key?.startsWith('ninq-recovery-') && key.endsWith(`:${activeOwner}`)) keys.push(key); }
  host.innerHTML = keys.sort().reverse().map(key => {
    let label = '復旧用コピー';
    try { const data = JSON.parse(localStorage.getItem(key)); label = `${new Date(data.exportedAt).toLocaleString('ja-JP')} ${data.reason}`; } catch (error) {}
    return `<button data-recovery-export="${escapeHtml(key)}">${escapeHtml(label)}を書き出す</button>`;
  }).join('') || '<p>復旧用コピーはまだありません</p>';
}
function renderSafetySync() {
  const host = document.getElementById('safety-sync'); if (!host) return;
  host.innerHTML = `<p>${firebaseUser ? escapeHtml(firebaseUser.email || 'ログイン済み') : '端末内のデータを使用中'}</p>${firebaseUser ? '<button data-logout>ログアウト</button><button data-import-guest>この端末の旧データを取り込む</button>' : ''}<button data-retry-save>保存・同期を再試行</button><button data-rescue>復旧用データを書き出す</button><details><summary>復旧用コピー</summary><div id="recovery-list"></div></details>`;
  renderRecoveryList(); renderSaveStatus();
}
function renderExpenseEditor() {
  const host = document.getElementById('st-expense-list'); if (!host) return;
  host.innerHTML = allExpenseItems().map(item => `<div class="expense-editor-row"><input aria-label="経費名" data-expense-label="${escapeHtml(item.id)}" value="${escapeHtml(item.label)}"><button data-expense-move="${escapeHtml(item.id)}" data-direction="-1" aria-label="上へ">↑</button><button data-expense-move="${escapeHtml(item.id)}" data-direction="1" aria-label="下へ">↓</button><button data-expense-archive="${escapeHtml(item.id)}">${item.archived ? '再開' : '廃止'}</button></div>`).join('');
}
function addExpenseItem() {
  const input = document.getElementById('st-expense-new');
  if (!input?.value.trim()) return;
  state.settings.expenseItems = [...allExpenseItems(), {id:crypto.randomUUID(),label:input.value.trim(),archived:false}];
  input.value = ''; markSettingsSections('expenses'); saveState(); renderExpenseEditor(); scheduleFirebaseAutoSync({reason:'save'});
}
function finalizeInvoice() {
  const draft = invoiceRevisionDraft;
  const entries = draft ? draft.snapshot.entries : entriesForInvoiceCompany();
  if (!entries.length) return;
  const invoice = {id:crypto.randomUUID(), issuedAt:new Date().toISOString(), company:draft?.company || selectedCompany,
    period:clone(draft?.period || companyBillingRange(selectedCompany)), cursor:toYmd(cursor),
    revises:draft?.revises || '', snapshot:clone(draft?.snapshot || {entries,settings:state.settings}),
    totals:clone(draft?.totals || invoiceTotals(entries))};
  const next = {...state, invoices:[...(state.invoices || []),invoice]};
  if (!saveState(next)) return;
  state = next; invoiceRevisionDraft = null; selectedInvoiceId = invoice.id;
  renderAll(); scheduleFirebaseAutoSync({reason:'save'});
}
function withInvoice(invoice, callback) {
  const previous = {state,selectedCompany,cursor,invoiceRenderContext};
  try {
    state = normalizeState(invoice.snapshot); selectedCompany = invoice.company; cursor = fromYmd(invoice.cursor || invoice.period.end); invoiceRenderContext = invoice;
    return callback();
  } finally { state = previous.state; selectedCompany = previous.selectedCompany; cursor = previous.cursor; invoiceRenderContext = previous.invoiceRenderContext; }
}
function renderInvoiceArchive() {
  const host = document.getElementById('invoice-history');
  if (host) host.innerHTML = `<summary>確定済み請求書（${(state.invoices || []).length}件）</summary><button data-invoice-current>現在の下書き</button>` + [...(state.invoices || [])].sort((a,b) => b.issuedAt.localeCompare(a.issuedAt)).map(invoice => `<button data-invoice-open="${escapeHtml(invoice.id)}">${escapeHtml(invoice.period.start)}〜${escapeHtml(invoice.period.end)} ${escapeHtml(invoice.company)}${invoice.revises ? '（訂正版）' : ''}</button>`).join('');
  const invoice = selectedInvoiceId ? (state.invoices || []).find(item => item.id === selectedInvoiceId) : invoiceRevisionDraft;
  if (!invoice) return false;
  const body = document.getElementById('inv-body');
  const hidden = !state.settings.showSales;
  document.getElementById('co-tabs').innerHTML = '';
  const sheets = withInvoice(invoice, () => buildInvoiceSheet(state.entries, invoice.totals, hidden) + buildDemenSheet(state.entries, invoice.totals, hidden));
  body.innerHTML = `<div class="invoice-actions safety-panel"><strong>${selectedInvoiceId ? '確定済み' : '訂正版の下書き'}</strong><p>${invoice.issuedAt ? `確定日時：${escapeHtml(new Date(invoice.issuedAt).toLocaleString('ja-JP'))}` : '現在の予定や設定を変更後、「現在の予定・設定で訂正」を押してください。'}</p>${selectedInvoiceId ? '<button data-invoice-revise>訂正版を作成</button>' : '<button data-finalize-invoice>請求書を確定</button><button data-revision-refresh>現在の予定・設定で訂正</button>'}<button data-invoice-current>現在の下書きへ</button><button data-print-invoice>請求書印刷</button><button data-print-demen>出面表印刷</button><button data-export-invoice>請求CSV</button><button data-export-demen>出面CSV</button></div>${sheets}`;
  return true;
}
function renderOnboarding() {
  const host = document.getElementById('onboarding'); if (!host) return;
  const dismissed = localStorage.getItem(scopedKey('ninq-onboarding-dismissed'));
  if (dismissed || state.entries.length || (state.invoices || []).length) { host.hidden = true; return; }
  host.hidden = false;
  host.innerHTML = '<strong>最初の1件を登録しましょう</strong><ol><li><button data-onboard="settings">取引先と単価を登録</button></li><li><button data-onboard="entry">今日の人工を記録</button></li><li><button data-onboard="invoice">請求書を確認</button></li></ol><button data-onboard="skip">案内を閉じる</button>';
}
function reusePreviousEntry() {
  const previous = [...state.entries].sort((a,b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!previous) return;
  for (const [id,key] of [['f-company','company'],['f-site','site'],['f-shift','shift'],['f-qty','qty'],['f-rate','unitRate']]) document.getElementById(id).value = previous[key];
  document.getElementById('f-company-select').value = previous.company;
  for (const id of ['f-ot-hours','f-ot-rate','f-notes']) document.getElementById(id).value = '';
  document.querySelectorAll('[data-expense-id]').forEach(input => { input.value = ''; });
}
function initSafetyUi() {
  const syncPanel = document.getElementById('safety-sync');
  document.getElementById('sc-sync').appendChild(syncPanel); syncPanel.classList.remove('hidden');
  document.addEventListener('change', event => {
    const id = event.target.dataset.expenseLabel;
    if (!id) return;
    const item = state.settings.expenseItems.find(item => item.id === id);
    if (item && event.target.value.trim()) { item.label = event.target.value.trim(); markSettingsSections('expenses'); saveState(); scheduleFirebaseAutoSync({reason:'save'}); }
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    const data = button.dataset;
    if ('logout' in data) { if (activeScreen === 'st') flushSettingsAutosave(); await window.NinqFirebaseCloud.signOut(); return; }
    if ('importGuest' in data) return importGuestData();
    if ('retrySave' in data) { if (saveState()) syncFirebaseCloud({reason:'save'}); return; }
    if ('rescue' in data) {
      const raw = storageBlocked ? localStorage.getItem(scopedKey(STORE_KEY)) || localStorage.getItem(STORE_KEY) : JSON.stringify({app:'NINQ',version:3,state});
      downloadText('ninq-rescue.json',raw || '{}','application/json'); return;
    }
    if (data.recoveryExport) { downloadText('ninq-recovery.json',localStorage.getItem(data.recoveryExport),'application/json'); return; }
    if (data.backupMode) return commitBackup(data.backupMode);
    if ('backupCancel' in data) { pendingBackup = null; document.getElementById('backup-preview')?.remove(); return; }
    if ('finalizeInvoice' in data) return finalizeInvoice();
    if (data.invoiceOpen) { selectedInvoiceId = data.invoiceOpen; invoiceRevisionDraft = null; renderInvoiceScreen(); return; }
    if ('invoiceCurrent' in data) { selectedInvoiceId = ''; invoiceRevisionDraft = null; renderInvoiceScreen(); return; }
    if ('invoiceRevise' in data) {
      const invoice = state.invoices.find(item => item.id === selectedInvoiceId);
      invoiceRevisionDraft = {...clone(invoice),id:'',issuedAt:'',revises:invoice.id}; selectedInvoiceId = ''; renderInvoiceScreen(); return;
    }
    if ('revisionRefresh' in data && invoiceRevisionDraft) {
      const draft = invoiceRevisionDraft;
      draft.snapshot = {settings:clone(state.settings),entries:clone(state.entries.filter(entry => invoiceBillableEntry(entry) && entry.company === draft.company && entry.date >= draft.period.start && entry.date <= draft.period.end))};
      draft.totals = withInvoice(draft, () => clone(invoiceTotals(state.entries))); renderInvoiceScreen(); return;
    }
    if (data.expenseArchive || data.expenseMove) {
      const items = allExpenseItems(), index = items.findIndex(item => item.id === (data.expenseArchive || data.expenseMove));
      if (index < 0) return;
      if (data.expenseArchive) items[index].archived = !items[index].archived;
      else { const next = index + Number(data.direction); if (next >= 0 && next < items.length) [items[index],items[next]] = [items[next],items[index]]; }
      state.settings.expenseItems = items; markSettingsSections('expenses'); saveState(); renderExpenseEditor(); scheduleFirebaseAutoSync({reason:'save'}); return;
    }
    if ('reusePrevious' in data) return reusePreviousEntry();
    if (data.onboard) {
      if (data.onboard === 'skip') localStorage.setItem(scopedKey('ninq-onboarding-dismissed'),'yes');
      else if (data.onboard === 'entry') { selectedDate = toYmd(new Date()); openModal('self'); }
      else activeScreen = data.onboard === 'settings' ? 'st' : 'inv';
      renderAll();
    }
  });
}
