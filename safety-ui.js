// Keep all account data hidden until Firebase resolves the signed-in user.
function beginAccountStartup() {
  document.getElementById('account-startup-retry')?.addEventListener('click', () => window.location.reload());
  accountStartupTimer = window.setTimeout(showAccountStartupError, 15000);
}
function showAccountStartupError() {
  if (accountReady) return;
  document.getElementById('account-startup-message').textContent = 'ログイン状態を確認できません。接続を確認して再読み込みしてください。保存データは変更していません。';
  document.getElementById('account-startup-retry').hidden = false;
}
function finishAccountStartup() {
  window.clearTimeout(accountStartupTimer);
  document.body.classList.remove('account-loading');
  document.getElementById('account-startup').hidden = true;
}
// Account lifecycle, recovery and issued documents. Loaded after app.js, before DOMContentLoaded.
let cloudIssueWasLocal = false;
let savingInvoice = false;
let pendingInvoiceDeletion = null;
let pendingCloudReceive = null;
let receivingCloud = false;
function mergeSafeStates(a, b) {
  return NinqData.mergeStates(normalizeState(a), normalizeState(b), mergeSettingsBySection);
}
function accountMatches(uid, epoch) { return activeOwner === uid && firebaseUser?.uid === uid && accountEpoch === epoch; }
function activateAccount(user) {
  const owner = user?.uid || 'guest';
  if (owner === activeOwner && accountReady) { firebaseUser = user; renderAll(); return; }
  if (storageFailure && !saveState()) {
    try { saveRecovery('アカウント切り替え前の未保存データ'); }
    catch (error) { downloadText('ninq-unsaved.json', JSON.stringify({app:'NINQ',version:3,state}), 'application/json'); }
  }
  accountEpoch++;
  invoiceDraftDates.clear();
  pendingInvoiceDeletion = null;
  document.getElementById('invoice-delete-dialog')?.close?.();
  for (const timer of [firebaseSyncTimer, driveSyncTimer, settingsAutosaveTimer]) window.clearTimeout(timer);
  settingsAutosaveTimer = null; settingsAutosaveSections.clear();
  firebaseSyncInFlight = false; firebaseSyncQueued = false; driveSyncInFlight = false; driveSyncQueued = false;
  googleAccessTokens.clear();
  firebaseUser = user; activeOwner = owner; accountReady = true; storageFailure = ''; cloudIssue = ''; cloudIssueWasLocal = false;
  state = loadState(); localRevision = 0;
  selectedInvoiceId = ''; invoiceRevisionDraft = null; pendingBackup = null; setBackupOperationStatus('');
  pendingCloudReceive=null;document.getElementById('cloud-receive-preview')?.remove();
  document.getElementById('backup-preview')?.remove();
  closeModal(); closeDayModal(); closeExpenseQuickEdit(); closeSheetPage();
  selectedCompany = ''; activeScreen = 'cal';
  // Remove old account values from forms that are not overwritten by renderSettings.
  document.getElementById('google-client-id').value = state.settings.googleClientId || '';
  document.getElementById('sync-log').textContent = '';
  if (user) { state.settings.googleSyncEnabled = true; saveState(); }
  renderAll();
  finishAccountStartup();
  if (user) syncFirebaseCloud({auto:true, reason:'startup'});
}
async function safeSyncCloud({auto = false, reason = ''} = {}) {
  if (pendingBackup || pendingCloudReceive || receivingCloud) return; // Keep reviewed data stable.
  if (activeScreen === 'st') flushSettingsAutosave();
  if (!firebaseUser || activeOwner !== firebaseUser.uid || !firebaseAvailable() || storageBlocked) return;
  if (storageFailure && !await retryLocalStorage(activeOwner,accountEpoch)) return;
  if (pendingBackup || !firebaseUser || activeOwner !== firebaseUser.uid) return;
  if (auto && !state.settings.googleSyncEnabled) return;
  if (!navigator.onLine) { saveSyncPending(true,'offline'); renderSyncScreen(); return; }
  if (auto && isEditingSyncSensitiveField()) { scheduleFirebaseAutoSync({delay:8000,reason}); return; }
  if (firebaseSyncInFlight) { firebaseSyncQueued = true; return; }
  const uid = firebaseUser.uid, epoch = accountEpoch, revision = localRevision;
  const submitted = clone(normalizeState(state));
  const expectedGeneration = submitted.pendingRestore?.base || submitted.restoreGeneration;
  firebaseSyncInFlight = true; cloudIssue = ''; cloudIssueWasLocal = false; renderSaveStatus();
  try {
    const payload = {...firebaseSyncPayload(), state:submitted};
    const result = await window.NinqFirebaseCloud.syncState(payload, {uid, expectedGeneration, merge:mergeSafeStates});
    if (!accountMatches(uid, epoch)) return;
    if (pendingBackup || pendingCloudReceive || receivingCloud || state.restoreGeneration !== submitted.restoreGeneration) { firebaseSyncQueued = true; return; }
    if (result.conflict) {
      if (state.pendingRestore) {
        cloudIssue = 'この端末の復元データを保持しています。クラウドが更新されているため、自動上書きを停止しました。スマホの送信完了後、「クラウドの最新データを確認」から受け取れます。';
        saveSyncPending(true,'restore-conflict'); setSyncLog(cloudIssue); return;
      }
      saveRecovery('別端末で復元済み：この端末のデータを退避', state);
      state = normalizeState(result.payload.state || result.payload);
      state.pendingRestore = null;
      if (!saveState() && !await retryLocalStorage(uid,epoch)) return;
      if (!accountMatches(uid,epoch)) return;
      cloudIssue = '別端末でデータが復元されました。この端末の変更は復旧用コピーに退避しました';
    } else {
      // A restore made while this request was in flight must be sent as its own generation.
      if (state.restoreGeneration !== submitted.restoreGeneration) { firebaseSyncQueued = true; return; }
      state = mergeSafeStates(state, result.payload.state);
      state.pendingRestore = null;
      if (!saveState() && !await retryLocalStorage(uid,epoch)) return;
      if (!accountMatches(uid,epoch)) return;
      if (pendingBackup || state.restoreGeneration !== submitted.restoreGeneration) { firebaseSyncQueued=true;return; }
    }
    saveSyncMeta({lastSyncedAt:new Date().toISOString(),lastCloudModifiedAt:result.payload.modifiedAt || '',cloudRevision:result.payload.revision || 0,lastLocalModifiedAt:localModifiedAt()});
    const changedDuringSync = !result.conflict && revision + 1 !== localRevision;
    saveSyncPending(changedDuringSync, changedDuringSync ? 'save' : '');
    if (changedDuringSync) firebaseSyncQueued = true;
    setSyncLog(cloudIssue || `クラウド同期済み：${state.entries.length}予定・${state.invoices.length}控え`);
    renderAll();
  } catch (error) {
    if (!accountMatches(uid, epoch)) return;
    cloudIssue = error.code === 'permission-denied' ? 'クラウド側の保存許可を確認する必要があります。端末のデータは保持しています。この表示をお知らせください。' : error.message || '同期に失敗しました';
    cloudIssueWasLocal = NinqData.diagnostics(submitted).some(item => item.kind === 'entry');
    if (revision !== localRevision) firebaseSyncQueued = true;
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
  pendingCloudReceive=null;document.getElementById('cloud-receive-preview')?.remove();
  const next = normalizeState(NinqData.validateBackup(payload));
  pendingBackup = next; pendingBackupOwner = activeOwner;
  window.clearTimeout(firebaseSyncTimer);
  backupRecoveryRevision = -1;
  setBackupOperationStatus('');
  const host = document.getElementById('sc-sync');
  document.getElementById('backup-preview')?.remove();
  const panel = document.createElement('section'); panel.id = 'backup-preview'; panel.className = 'safety-panel';
  panel.innerHTML = `<strong>読み込み内容を確認</strong><p>現在 ${state.entries.length}予定・${(state.invoices || []).length}控え → 読み込み ${next.entries.length}予定・${next.invoices.length}控え</p><p>確認中は、この端末の自動同期を一時停止しています。</p><button data-backup-mode="add">追加</button><button data-backup-mode="replace">置き換え</button><button data-backup-cancel>キャンセル</button><div id="backup-replace-confirm" hidden><p>この端末をバックアップの内容に置き換えます。元のデータは復旧用コピーに残します。</p><button data-backup-confirm-replace>${next.entries.length}予定に置き換える</button><button data-backup-keep>戻る</button></div>`;
  host.appendChild(panel);
  panel.scrollIntoView?.({block:'nearest'});
}
let backupRecoveryRevision = -1;
let movingRecoveryCopies = false;
async function archiveLocalRecoveryCopies(owner,epoch) {
  const keys=[];
  for(let i=0;i<localStorage.length;i++) {
    const key=localStorage.key(i);
    if(key?.startsWith('ninq-recovery-') && key.endsWith(`:${owner}`)) keys.push(key);
  }
  for(const key of keys) {
    if(activeOwner!==owner || accountEpoch!==epoch) return 0;
    const raw=localStorage.getItem(key);
    if(raw===null) continue;
    await NinqRecoveryStore.archive(key,raw,owner);
    if(activeOwner!==owner || accountEpoch!==epoch) return 0;
    if(localStorage.getItem(key)===raw) localStorage.removeItem(key);
  }
  return keys.length;
}
async function retryLocalStorage(owner,epoch) {
  if(movingRecoveryCopies || typeof NinqRecoveryStore==='undefined') return false;
  movingRecoveryCopies=true;
  try {
    await archiveLocalRecoveryCopies(owner,epoch);
    if(activeOwner!==owner || accountEpoch!==epoch) return false;
    return saveState();
  } catch(error) { return false; }
  finally { movingRecoveryCopies=false; }
}
function offerRecoveryMigration() {
  const host=document.getElementById('backup-operation-status');
  const button=document.createElement('button');
  button.dataset.recoveryMigrate='';
  button.textContent='復旧用コピーの保存先を整理する';
  host.appendChild(button);
}
async function migrateRecoveryCopies() {
  if (movingRecoveryCopies || !pendingBackup) return;
  const owner=activeOwner, epoch=accountEpoch, backup=pendingBackup;
  movingRecoveryCopies=true;
  setBackupOperationStatus('復旧用コピーを別の端末内保存領域へ移しています。元の予定は変更していません。');
  try {
    const count=await archiveLocalRecoveryCopies(owner,epoch);
    if(activeOwner!==owner || accountEpoch!==epoch || pendingBackup!==backup) return;
    if(!count) throw new Error('移動できる復旧用コピーがありません。ブラウザーのデータは削除せず、このメッセージをお知らせください。');
    setBackupOperationStatus('復旧用コピーの保存先を整理しました。コピーは「復旧用コピー」から引き続き書き出せます。下の件数付きの「予定に置き換える」ボタン、または「追加」を押してください。');
    renderRecoveryList();
  } catch(error) {
    if(activeOwner===owner && accountEpoch===epoch) {
      setBackupOperationStatus(`保存先の整理を完了できませんでした。元の予定は変更していません。移動済みのコピーも保持しています。詳細：${error.message}`);
      offerRecoveryMigration();
    }
  } finally { movingRecoveryCopies=false; }
}
function setBackupOperationStatus(message) {
  const host = document.getElementById('backup-operation-status');
  if (host) { host.textContent = message; host.hidden = !message; }
}
async function previewCloudReceive() {
  if(receivingCloud || !firebaseUser || storageBlocked) return;
  if(pendingBackup) {setBackupOperationStatus('バックアップの読み込み確認をキャンセルしてから、クラウドの最新データを確認してください。');return;}
  const owner=activeOwner,epoch=accountEpoch;
  receivingCloud=true;
  try {
    const payload=await window.NinqFirebaseCloud.readState({uid:owner});
    if(!accountMatches(owner,epoch))return;
    if(!payload)throw new Error('クラウドにデータがありません。正しいデータがあるスマホで先に同期してください。');
    const next=normalizeState(NinqData.validateBackup(payload));
    pendingCloudReceive={owner,epoch,revision:localRevision,payload,serialized:JSON.stringify(payload)};
    document.getElementById('cloud-receive-preview')?.remove();
    const panel=document.createElement('section');panel.id='cloud-receive-preview';panel.className='safety-panel';
    panel.innerHTML=`<strong>クラウドの最新データを確認</strong><p>この端末：${state.entries.length}予定・${state.invoices.length}控え<br>クラウド：${next.entries.length}予定・${next.invoices.length}控え</p><p>スマホの同期結果と件数が合っていることを確認してください。この端末の元データは復旧用コピーに残します。クラウドの内容は変更しません。</p><button data-cloud-receive-confirm>この端末をクラウドの内容に合わせる</button><button data-cloud-receive-cancel>キャンセル</button>`;
    document.getElementById('sc-sync').appendChild(panel);panel.scrollIntoView?.({block:'nearest'});
    setBackupOperationStatus('');
  } catch(error) {if(accountMatches(owner,epoch))setBackupOperationStatus(`クラウドを確認できませんでした：${error.message}`);}
  finally {receivingCloud=false;}
}
async function confirmCloudReceive() {
  const pending=pendingCloudReceive;
  if(!pending || receivingCloud || !accountMatches(pending.owner,pending.epoch))return false;
  receivingCloud=true;
  const valid=()=>pendingCloudReceive===pending && accountMatches(pending.owner,pending.epoch) && localRevision===pending.revision;
  try {
    const latest=await window.NinqFirebaseCloud.readState({uid:pending.owner});
    if(!valid())throw new Error('確認中に端末の状態が変わりました。もう一度「クラウドの最新データを確認」を押してください。');
    if(JSON.stringify(latest)!==pending.serialized)throw new Error('確認中にクラウドが更新されました。もう一度「クラウドの最新データを確認」を押してください。');
    const next=normalizeState(NinqData.validateBackup(latest));next.pendingRestore=null;
    try {saveRecovery('クラウドの最新データを受け取る前');}
    catch(error) {
      const raw=JSON.stringify({app:'NINQ',version:3,reason:'クラウドの最新データを受け取る前',exportedAt:new Date().toISOString(),state});
      await NinqRecoveryStore.archive(scopedKey(`ninq-recovery-${Date.now()}-${crypto.randomUUID()}`),raw,pending.owner);
    }
    if(!valid())throw new Error('端末の状態が変わったため受け取りを中止しました。元データは保持しています。');
    if(!saveState(next)) {
      await archiveLocalRecoveryCopies(pending.owner,pending.epoch);
      if(!valid() || !saveState(next))throw new Error('端末に保存できませんでした。元データは保持しています。');
    }
    state=next;pendingCloudReceive=null;selectedInvoiceId='';invoiceRevisionDraft=null;cloudIssue='';cloudIssueWasLocal=false;
    saveSyncMeta({lastSyncedAt:new Date().toISOString(),lastCloudModifiedAt:latest.modifiedAt||'',cloudRevision:latest.revision||0,lastLocalModifiedAt:localModifiedAt()});saveSyncPending(false,'');
    document.getElementById('cloud-receive-preview')?.remove();
    setBackupOperationStatus(`クラウドの最新データを受け取りました：${state.entries.length}予定・${state.invoices.length}控え。以後は通常の自動同期を使えます。`);
    renderAll();return true;
  } catch(error) {
    if(accountMatches(pending.owner,pending.epoch))setBackupOperationStatus(`受け取りは完了していません：${error.message}`);
    return false;
  } finally {receivingCloud=false;}
}
function commitBackup(mode, {confirmed = false} = {}) {
  if (!pendingBackup || pendingBackupOwner !== activeOwner) return false;
  try {
    if (mode === 'replace' && !confirmed && !confirm('現在のデータを置き換えます。元データの復旧用コピーを端末に残します。続けますか？')) return false;
    if (backupRecoveryRevision !== localRevision) {
      try { saveRecovery('バックアップ読み込み前'); backupRecoveryRevision = localRevision; }
      catch(error) { setBackupOperationStatus(`読み込みは完了していません。元データの復旧用コピーをこの端末に保存できませんでした。クラウドとは別の、ブラウザー内の保存容量・保存権限を確認してください。元データは変更していません。\n詳細：${error.message}`); offerRecoveryMigration(); return false; }
    }
    let next;
    if (mode === 'add') {
      next = mergeSafeStates(state, {...pendingBackup, deletedEntryIds:{},deletedReceiptIds:{},deletedInvoiceIds:{}});
      next.restoreGeneration = state.restoreGeneration || 'initial'; next.pendingRestore = state.pendingRestore;
    } else {
      next = clone(pendingBackup);
      next.restoreGeneration = crypto.randomUUID();
      next.pendingRestore = {base:state.pendingRestore?.base || state.restoreGeneration || 'initial',baseRevision:state.pendingRestore?.baseRevision ?? loadSyncMeta().cloudRevision ?? null};
      const kept = new Set(next.entries.map(entry => entry.id));
      next.deletedEntryIds = {...state.deletedEntryIds, ...next.deletedEntryIds};
      for (const entry of state.entries) if (!kept.has(entry.id)) next.deletedEntryIds[entry.id] = new Date().toISOString();
      for (const entry of next.entries) delete next.deletedEntryIds[entry.id];
      const keptInvoices = new Set(next.invoices.map(invoice => invoice.id));
      next.deletedInvoiceIds = {...state.deletedInvoiceIds, ...next.deletedInvoiceIds};
      for (const invoice of state.invoices) if (!keptInvoices.has(invoice.id)) next.deletedInvoiceIds[invoice.id] = new Date().toISOString();
      for (const invoice of next.invoices) delete next.deletedInvoiceIds[invoice.id];
    }
    if (!saveState(next)) { setBackupOperationStatus(`読み込みは完了していません。${storageFailure || 'この端末への保存に失敗しました。'} 元の予定を保持しています。`); return false; }
    state = next; pendingBackup = null; selectedInvoiceId = ''; invoiceRevisionDraft = null;
    cloudIssue = ''; cloudIssueWasLocal = false;
    saveSyncPending(true,'restore');
    document.getElementById('backup-preview')?.remove();
    setBackupOperationStatus(`この端末への${mode === 'replace' ? '置き換え' : '追加'}が完了しました：${state.entries.length}予定・${state.invoices.length}控え。クラウド同期の完了とは別です。`);
    renderAll(); scheduleFirebaseAutoSync({reason:'save'}); return true;
  } catch (error) { setBackupOperationStatus(`読み込みを中止しました：${error.message}`); return false; }
}
function renderSaveStatus() {
  const host = document.getElementById('home-storage-status'); if (!host) return;
  let label = '端末保存済み';
  const meta = loadSyncMeta(), pending = loadSyncPending();
  const issues = NinqData.diagnostics(state);
  if (cloudIssueWasLocal && !issues.some(item => item.kind === 'entry')) { cloudIssue = ''; cloudIssueWasLocal = false; }
  const diagnosticsHost = document.getElementById('data-diagnostics');
  if (diagnosticsHost) diagnosticsHost.innerHTML = diagnosticHtml(issues);
  if (storageFailure) label = storageFailure;
  else if (cloudIssue) label = `要対応：${cloudIssue}`;
  else if (firebaseSyncInFlight) label = '同期中';
  else if (pending.pending) label = navigator.onLine ? '未送信' : '未送信（オフライン）';
  else if (firebaseUser && meta.lastSyncedAt) label = '同期済み';
  host.textContent = label + (meta.lastSyncedAt ? ` ／ 最終同期 ${new Date(meta.lastSyncedAt).toLocaleString('ja-JP')}` : '');
}
function diagnosticHtml(issues) {
  if (!issues.length) return '';
  return `<details class="safety-panel" open><summary>確認が必要なデータ（${issues.length}項目）</summary>` + issues.slice(0,10).map(issue => `<div class="diagnostic-item"><strong>${issue.kind === 'invoice' ? '保存した控えの注意（現在の予定とは別）' : '現在の予定'}</strong><p>${escapeHtml(issue.message)}</p><button ${issue.kind === 'invoice' ? 'data-diagnostic-invoice' : 'data-diagnostic-entry'}="${escapeHtml(issue.id)}">${issue.kind === 'invoice' ? '控えを確認' : '予定を開く'}</button></div>`).join('') + (issues.length > 10 ? '<p>ほかの項目は修正後に表示します。</p>' : '') + '</details>';
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
    const button = document.createElement('button'); button.textContent = '最新版に更新';
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
let recoveryListRevision=0;
function renderRecoveryList() {
  const host = document.getElementById('recovery-list'); if (!host) return;
  const owner=activeOwner, revision=++recoveryListRevision;
  const keys = [];
  for (let i=0;i<localStorage.length;i++) { const key = localStorage.key(i); if (key?.startsWith('ninq-recovery-') && key.endsWith(`:${activeOwner}`)) keys.push(key); }
  host.innerHTML = keys.sort().reverse().map(key => {
    let label = '復旧用コピー';
    try { const data = JSON.parse(localStorage.getItem(key)); label = `${new Date(data.exportedAt).toLocaleString('ja-JP')} ${data.reason}`; } catch (error) {}
    return `<button data-recovery-export="${escapeHtml(key)}">${escapeHtml(label)}を書き出す</button>`;
  }).join('') || '<p>復旧用コピーはまだありません</p>';
  if (typeof NinqRecoveryStore !== 'undefined') NinqRecoveryStore.list(owner).then(copies=>{
    if(owner!==activeOwner || revision!==recoveryListRevision || document.getElementById('recovery-list')!==host) return;
    if(copies.length && !keys.length) host.textContent='';
    for(const copy of copies.sort((a,b)=>b.key.localeCompare(a.key))) {
      if(keys.includes(copy.key)) continue;
      const button=document.createElement('button');button.dataset.recoveryDatabaseExport=copy.key;
      let label='復旧用コピー';
      try { const data=JSON.parse(copy.raw);label=`${new Date(data.exportedAt).toLocaleString('ja-JP')} ${data.reason}`; } catch(error) {}
      button.textContent=`${label}を書き出す`;host.appendChild(button);
    }
  }).catch(()=>{
    if(owner!==activeOwner || revision!==recoveryListRevision) return;
    const warning=document.createElement('p');warning.textContent='別の端末内保存領域の復旧用コピーを読み込めませんでした。';host.appendChild(warning);
  });
}
function renderSafetySync() {
  const host = document.getElementById('safety-sync'); if (!host) return;
  host.innerHTML = `<p>${firebaseUser ? escapeHtml(firebaseUser.email || 'ログイン済み') : '端末内のデータを使用中'}</p>${firebaseUser ? '<button data-logout>ログアウト</button><button data-import-guest>この端末の旧データを取り込む</button>' : ''}<button data-retry-save>保存・同期を再試行</button><button data-rescue>復旧用データを書き出す</button><details><summary>復旧用コピー</summary><div id="recovery-list"></div></details>`;
  renderRecoveryList(); renderSaveStatus();
  if(firebaseUser) {const button=document.createElement('button');button.dataset.cloudReceive='';button.textContent='クラウドの最新データを確認';host.appendChild(button);}
}
function renderExpenseEditor() {
  const host = document.getElementById('st-expense-list'); if (!host) return;
  host.innerHTML = allExpenseItems().map(item => `<div class="expense-editor-row"><input aria-label="経費名" data-expense-label="${escapeHtml(item.id)}" value="${escapeHtml(item.label)}"><button data-expense-move="${escapeHtml(item.id)}" data-direction="-1" aria-label="上へ">↑</button><button data-expense-move="${escapeHtml(item.id)}" data-direction="1" aria-label="下へ">↓</button><button data-expense-archive="${escapeHtml(item.id)}">${item.archived ? '再開' : '廃止'}</button></div>`).join('');
  const unknown = NinqData.expenseColumns(allExpenseItems(), state.entries).filter(col => !allExpenseItems().some(item => item.id === col.item.id));
  host.innerHTML += unknown.map(col => `<section class="unknown-expense"><h3>名称未設定の経費</h3><p>元の項目ID：${escapeHtml(col.item.id)}</p>${state.entries.filter(entry => Object.hasOwn(entry.expenses || {},col.item.id) && entry.expenses[col.item.id] !== 0).map(entry => `<p>${escapeHtml(entry.date)} ／ ${escapeHtml(entry.company)} ／ ${escapeHtml(entry.site)}：${escapeHtml(entry.expenses[col.item.id])}円</p>`).join('')}<label>経費名<input data-unknown-expense="${escapeHtml(col.item.id)}" placeholder="例：交通費"></label><button data-name-expense="${escapeHtml(col.item.id)}">名称を設定</button></section>`).join('');
}
function nameUnknownExpense(id, label) {
  if (!label?.trim() || allExpenseItems().some(item => item.id === id)) return false;
  const next = clone(state); next.settings.expenseItems.push({id,label:label.trim(),archived:true});
  next.settings.settingUpdatedAt.expenses = new Date().toISOString(); next.settings.updatedAt = next.settings.settingUpdatedAt.expenses;
  if (!saveState(next)) return false;
  state = next; renderAll(); scheduleFirebaseAutoSync({reason:'save'}); return true;
}
function addExpenseItem() {
  const input = document.getElementById('st-expense-new');
  if (!input?.value.trim()) return;
  state.settings.expenseItems = [...allExpenseItems(), {id:crypto.randomUUID(),label:input.value.trim(),archived:false}];
  input.value = ''; markSettingsSections('expenses'); saveState(); renderExpenseEditor(); scheduleFirebaseAutoSync({reason:'save'});
}
function finalizeInvoice() {
  if (savingInvoice) return;
  savingInvoice = true;
  try {
  const draft = invoiceRevisionDraft;
  const entries = draft ? draft.snapshot.entries : entriesForInvoiceCompany();
  if (!entries.length) return;
  NinqData.validateBackup({entries,settings:draft?.snapshot.settings || state.settings});
  const invoice = {id:crypto.randomUUID(), issuedAt:new Date().toISOString(), company:draft?.company || selectedCompany,
    invoiceDate:invoiceDateValue(draft), period:clone(draft?.period || companyBillingRange(selectedCompany)), cursor:toYmd(cursor),
    revises:draft?.revises || '', snapshot:clone(draft?.snapshot || {entries,settings:state.settings}),
    totals:clone(draft?.totals || invoiceTotals(entries))};
  NinqData.validateBackup({entries:[],settings:{},invoices:[invoice]});
  const existing = state.invoices.find(item => NinqData.invoiceContentKey(item) === NinqData.invoiceContentKey(invoice));
  if (existing) { selectedInvoiceId = existing.id; invoiceRevisionDraft = null; renderAll(); return; }
  const next = {...state, invoices:[...(state.invoices || []),invoice]};
  if (!saveState(next)) return;
  state = next; invoiceRevisionDraft = null; selectedInvoiceId = invoice.id;
  renderAll(); scheduleFirebaseAutoSync({reason:'save'});
  } catch (error) { alert(`控えを保存できませんでした。\n${error.message}`); renderSaveStatus(); }
  finally { savingInvoice = false; }
}
function requestInvoiceDeletion(id) {
  const invoice = state.invoices.find(item => item.id === id); if (!invoice) return;
  pendingInvoiceDeletion = {id,owner:activeOwner,epoch:accountEpoch};
  document.getElementById('invoice-delete-description').textContent = `${invoice.company}\n${invoice.period.start}〜${invoice.period.end}\n保存：${new Date(invoice.issuedAt).toLocaleString('ja-JP')}\n合計：${yen(invoice.totals.total)}`;
  document.getElementById('invoice-delete-dialog').showModal();
}
function deleteInvoice(id, {confirmed = false} = {}) {
  const invoice = state.invoices.find(item => item.id === id); if (!invoice) return false;
  if (!confirmed && !confirm(`この控えを削除しますか？\n${invoice.company}\n${invoice.period.start}〜${invoice.period.end}\n保存：${new Date(invoice.issuedAt).toLocaleString('ja-JP')}\n合計：${yen(invoice.totals.total)}\nカレンダーの予定は残ります。`)) return false;
  try {
    saveRecovery('請求書の控えの削除前');
    const next = {...state,invoices:state.invoices.filter(item => item.id !== id),deletedInvoiceIds:{...state.deletedInvoiceIds,[id]:new Date().toISOString()}};
    if (!saveState(next)) return false;
    state = next; if (selectedInvoiceId === id) { selectedInvoiceId = ''; invoiceRevisionDraft = null; }
    renderAll(); scheduleFirebaseAutoSync({reason:'save'}); return true;
  } catch(error) { alert(`控えの削除を中止しました。${error.message}`); return false; }
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
  if (host) host.innerHTML = `<summary>保存した請求書の控え（${(state.invoices || []).length}件）</summary><button data-invoice-current>現在の予定から作成</button>` + [...(state.invoices || [])].sort((a,b) => b.issuedAt.localeCompare(a.issuedAt)).map(invoice => `<button data-invoice-open="${escapeHtml(invoice.id)}">${escapeHtml(invoice.period.start)}〜${escapeHtml(invoice.period.end)} ${escapeHtml(invoice.company)}${invoice.revises ? '（訂正版）' : ''}<small>保存 ${escapeHtml(new Date(invoice.issuedAt).toLocaleString('ja-JP'))} ／ 合計 ${escapeHtml(yen(invoice.totals.total))}</small></button>`).join('');
  const invoice = selectedInvoiceId ? (state.invoices || []).find(item => item.id === selectedInvoiceId) : invoiceRevisionDraft;
  if (!invoice) return false;
  const body = document.getElementById('inv-body');
  const hidden = !state.settings.showSales;
  document.getElementById('co-tabs').innerHTML = '';
  const sheets = withInvoice(invoice, () => buildInvoiceSheet(state.entries, invoice.totals, hidden) + buildDemenSheet(state.entries, invoice.totals, hidden));
  body.innerHTML = `<div class="invoice-actions safety-panel"><strong>${selectedInvoiceId ? '保存した控え' : '訂正版を作成中'}</strong>${invoiceDateControl(invoice,!!selectedInvoiceId)}<p>${invoice.issuedAt ? `保存日時：${escapeHtml(new Date(invoice.issuedAt).toLocaleString('ja-JP'))}` : '現在の予定や設定を変更後、「現在の予定・設定で訂正」を押してください。'}</p>${selectedInvoiceId ? '<button data-invoice-revise>訂正版を作成</button><button data-invoice-delete>この控えを削除</button>' : '<button data-finalize-invoice>請求書の控えを保存</button><button data-revision-refresh>現在の予定・設定で訂正</button>'}<button data-invoice-current>現在の予定から作成へ</button><button class="btn-primary" data-save-invoice>請求書PDF保存</button><button class="btn-gold" data-save-demen>出面表PDF保存</button><button data-print-invoice>請求書印刷</button><button data-print-demen>出面表印刷</button><button data-export-invoice>請求CSV</button><button data-export-demen>出面CSV</button></div>${invoice.revises && state.deletedInvoiceIds?.[invoice.revises] ? '<p class="safety-panel">元の控えは削除されています。この訂正版は残っています。</p>' : ''}${diagnosticHtml(NinqData.diagnostics({entries:[],invoices:[invoice]}))}${sheets}`;
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
  document.getElementById('sc-sync').appendChild(document.getElementById('backup-operation-status'));
  document.getElementById('sc-sync').appendChild(syncPanel); syncPanel.classList.remove('hidden');
  document.addEventListener('change', event => {
    if (event.target.matches('[data-invoice-date]')) { if (!setInvoiceDate(event.target.value)) { alert('請求書の日付を入力してください。'); renderInvoiceScreen(); } return; }
    const id = event.target.dataset.expenseLabel;
    if (!id) return;
    const item = state.settings.expenseItems.find(item => item.id === id);
    if (item && event.target.value.trim()) { item.label = event.target.value.trim(); markSettingsSections('expenses'); saveState(); scheduleFirebaseAutoSync({reason:'save'}); }
  });
  document.addEventListener('click', async event => {
    const button = event.target.closest('button'); if (!button) return;
    const data = button.dataset;
    if ('cloudReceive' in data) return previewCloudReceive();
    if ('cloudReceiveConfirm' in data) return confirmCloudReceive();
    if ('cloudReceiveCancel' in data) {pendingCloudReceive=null;document.getElementById('cloud-receive-preview')?.remove();setBackupOperationStatus('クラウドからの受け取りを取り消しました。予定は変更していません。');return;}
    if ('logout' in data) { if (activeScreen === 'st') flushSettingsAutosave(); await window.NinqFirebaseCloud.signOut(); return; }
    if ('importGuest' in data) return importGuestData();
    if ('retrySave' in data) { if (saveState()) syncFirebaseCloud({reason:'save'}); return; }
    if ('rescue' in data) {
      const raw = storageBlocked ? localStorage.getItem(scopedKey(STORE_KEY)) || localStorage.getItem(STORE_KEY) : JSON.stringify({app:'NINQ',version:3,state});
      downloadText('ninq-rescue.json',raw || '{}','application/json'); return;
    }
    if (data.recoveryExport) { downloadText('ninq-recovery.json',localStorage.getItem(data.recoveryExport),'application/json'); return; }
    if ('recoveryMigrate' in data) return migrateRecoveryCopies();
    if (data.recoveryDatabaseExport) {
      const owner=activeOwner,epoch=accountEpoch;
      try { const raw=await NinqRecoveryStore.read(data.recoveryDatabaseExport,owner);if(owner===activeOwner && epoch===accountEpoch) downloadText('ninq-recovery.json',raw,'application/json'); }
      catch(error) { if(owner===activeOwner && epoch===accountEpoch) setBackupOperationStatus(error.message); }
      return;
    }
    if (data.backupMode === 'replace') { document.getElementById('backup-replace-confirm').hidden = false; return; }
    if (data.backupMode) return commitBackup(data.backupMode);
    if ('backupConfirmReplace' in data) return commitBackup('replace',{confirmed:true});
    if ('backupKeep' in data) { document.getElementById('backup-replace-confirm').hidden = true; return; }
    if ('backupCancel' in data) { pendingBackup = null; document.getElementById('backup-preview')?.remove(); setBackupOperationStatus('読み込みを取り消しました。予定は変更していません。'); scheduleFirebaseAutoSync({reason:'poll'}); return; }
    if (data.diagnosticEntry) { const entry = state.entries.find(item => item.id === data.diagnosticEntry); if (entry) { activeScreen = 'cal'; selectedDate = entry.date; cursor = startOfMonth(fromYmd(entry.date)); renderAll(); openModal(entry.type,entry.id); } return; }
    if (data.diagnosticInvoice) { activeScreen = 'inv'; selectedInvoiceId = data.diagnosticInvoice; invoiceRevisionDraft = null; renderAll(); return; }
    if ('invoiceDelete' in data) return requestInvoiceDeletion(selectedInvoiceId);
    if ('invoiceDeleteCancel' in data) { pendingInvoiceDeletion = null; document.getElementById('invoice-delete-dialog').close(); return; }
    if ('invoiceDeleteConfirm' in data) {
      const pending = pendingInvoiceDeletion; pendingInvoiceDeletion = null;
      document.getElementById('invoice-delete-dialog').close();
      if (pending && pending.owner === activeOwner && pending.epoch === accountEpoch) return deleteInvoice(pending.id,{confirmed:true});
      return;
    }
    if (data.nameExpense) { const input = [...document.querySelectorAll('[data-unknown-expense]')].find(item => item.dataset.unknownExpense === data.nameExpense); return nameUnknownExpense(data.nameExpense,input?.value); }
    if ('finalizeInvoice' in data) return finalizeInvoice();
    if (data.invoiceOpen) { selectedInvoiceId = data.invoiceOpen; invoiceRevisionDraft = null; renderInvoiceScreen(); return; }
    if ('invoiceCurrent' in data) { selectedInvoiceId = ''; invoiceRevisionDraft = null; renderInvoiceScreen(); return; }
    if ('invoiceRevise' in data) {
      const invoice = state.invoices.find(item => item.id === selectedInvoiceId);
      invoiceRevisionDraft = {...clone(invoice),invoiceDate:invoiceDateValue(invoice),id:'',issuedAt:'',revises:invoice.id}; selectedInvoiceId = ''; renderInvoiceScreen(); return;
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
