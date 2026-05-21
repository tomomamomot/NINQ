
const STORE_KEY = 'ninq-v2';
const SYNC_META_KEY = 'ninq-sync-meta-v1';
const LEGACY_STORE_KEYS = [['s', 'hokunin3'].join(''), ['g', 'enba-box-v2'].join('')];
const DRIVE_SYNC_FILE = 'ninq-sync.json';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const APP_VERSION = 'v2026.05.21-2';
const DEFAULT_EXPENSE_ITEMS = ['交通費', '駐車場代', '宿泊費', 'ガソリン代', '資材代', 'その他'];
const DEFAULT_SETTINGS = {
  name: '', postalCode: '', address: '', tel: '', companyName: '', bank: '', branch: '', accountNo: '', accountName: '',
  invoiceNo: '', invoiceEnabled: true, taxRate: 10, stampImage: '',
  defaultDayRate: 0, defaultNightRate: 0, defaultOtRate: 0,
  companies: [], companyRates: [], expenseItems: DEFAULT_EXPENSE_ITEMS.map((label, index) => ({ id: `exp${index + 1}`, label })),
  companyInvoiceModes: {}, showSales: true, showSubcontract: true, googleClientId: '', googleCalendarId: 'primary', googleStoreMode: 'local', googleAccountEmail: '', googleSyncEnabled: false,
  salesTotalParts: { labor: true, overtime: true, expenses: false }, settingUpdatedAt: {},
};
const DEFAULT_STATE = { entries: [], receipts: [], deletedEntryIds: {}, settings: DEFAULT_SETTINGS };
const SETTINGS_SECTIONS = {
  profile: ['name', 'postalCode', 'address', 'tel', 'companyName'],
  bank: ['bank', 'branch', 'accountNo', 'accountName'],
  invoice: ['invoiceNo', 'invoiceEnabled', 'taxRate', 'stampImage', 'companyInvoiceModes'],
  companies: ['companies', 'companyRates'],
  expenses: ['expenseItems'],
  display: ['showSales', 'showSubcontract', 'salesTotalParts'],
  google: ['googleClientId', 'googleCalendarId', 'googleStoreMode', 'googleAccountEmail', 'googleSyncEnabled'],
};

let state = loadState();
let cursor = startOfMonth(new Date());
let selectedDate = toYmd(new Date());
let selectedCompany = '';
let activeScreen = 'cal';
let editingId = null;
let isDayModalOpen = false;
let activeDatePickerInput = null;
let datePickerValue = selectedDate;
let datePickerCursor = startOfMonth(new Date());
let googleTokenClient = null;
let googleAccessToken = '';
let settingsAutosaveTimer = null;
let settingsAutosaveSections = new Set();
let driveAuthPrompt = 'consent';
let driveSyncTimer = null;
let driveSyncInFlight = false;
let driveSyncQueued = false;

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalizeState(JSON.parse(raw));
    for (const key of LEGACY_STORE_KEYS) {
      const legacy = localStorage.getItem(key);
      if (!legacy) continue;
      const migrated = key === LEGACY_STORE_KEYS[0] ? migrateLegacy(JSON.parse(legacy)) : normalizeState(JSON.parse(legacy));
      localStorage.setItem(STORE_KEY, JSON.stringify(migrated));
      localStorage.removeItem(key);
      return migrated;
    }
  } catch (error) {
    console.warn('loadState failed', error);
  }
  return clone(DEFAULT_STATE);
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeState(source) {
  const settings = { ...clone(DEFAULT_SETTINGS), ...(source.settings || {}) };
  settings.companies = Array.isArray(settings.companies) ? settings.companies.filter(Boolean) : [];
  settings.expenseItems = normalizeExpenseItems(settings.expenseItems);
  settings.companyInvoiceModes = settings.companyInvoiceModes && typeof settings.companyInvoiceModes === 'object' ? settings.companyInvoiceModes : {};
  settings.salesTotalParts = { ...DEFAULT_SETTINGS.salesTotalParts, ...(settings.salesTotalParts || {}) };
  settings.settingUpdatedAt = settings.settingUpdatedAt && typeof settings.settingUpdatedAt === 'object' ? settings.settingUpdatedAt : {};
  const entries = Array.isArray(source.entries) ? source.entries.map(normalizeEntry) : [];
  const receipts = Array.isArray(source.receipts) ? source.receipts.map(normalizeReceipt) : [];
  const deletedEntryIds = source.deletedEntryIds && typeof source.deletedEntryIds === 'object' ? source.deletedEntryIds : {};
  return { entries, receipts, deletedEntryIds, settings };
}
function normalizeExpenseItems(items) {
  const list = Array.isArray(items) ? items : [];
  const mapped = list.map((item, index) => typeof item === 'string' ? { id: `exp${index + 1}`, label: item } : { id: item.id || `exp${index + 1}`, label: item.label || `項目${index + 1}` }).filter((item) => item.label.trim());
  return mapped.length ? mapped : clone(DEFAULT_SETTINGS.expenseItems);
}
function normalizeCompanyRates(items, companies = []) {
  const source = Array.isArray(items) ? items : [];
  const mapped = source.map((item) => {
    if (typeof item === 'string') return { id: crypto.randomUUID(), name: item, officialName: item, dayRate: 0, nightRate: 0, otRate: 0 };
    const name = String(item.name || item.company || '').trim();
    return { id: String(item.id || crypto.randomUUID()), name, officialName: String(item.officialName || item.formalName || name).trim(), dayRate: num(item.dayRate), nightRate: num(item.nightRate), otRate: num(item.otRate) };
  }).filter((item) => item.name);
  const deduped = [];
  mapped.forEach((item) => {
    const existing = deduped.find((saved) => saved.id === item.id || saved.name === item.name);
    if (existing) {
      existing.officialName = item.officialName || existing.officialName || item.name;
      existing.dayRate = item.dayRate || existing.dayRate;
      existing.nightRate = item.nightRate || existing.nightRate;
      existing.otRate = item.otRate || existing.otRate;
    } else {
      deduped.push(item);
    }
  });
  companies.filter(Boolean).forEach((name) => { if (!deduped.some((item) => item.name === name)) deduped.push({ id: crypto.randomUUID(), name, officialName: name, dayRate: 0, nightRate: 0, otRate: 0 }); });
  return deduped;
}
function normalizeReceipt(receipt) {
  return {
    id: String(receipt.id || crypto.randomUUID()), fileName: receipt.fileName || '領収書', importedAt: receipt.importedAt || new Date().toISOString(),
    category: receipt.category || guessReceiptCategory(receipt.fileName || ''), amount: num(receipt.amount || 0), date: receipt.date || '', vendor: receipt.vendor || '', status: receipt.status || '未確認'
  };
}
function normalizeEntry(entry) {
  return {
    id: String(entry.id || crypto.randomUUID()), date: entry.date || toYmd(new Date()), type: entry.type || 'self', shift: entry.shift || 'day',
    company: entry.company || '', site: entry.site || '', workerName: entry.workerName || '', qty: qtyValue(entry.qty),
    unitRate: num(entry.unitRate || 0), paymentAmount: num(entry.paymentAmount || 0), otHours: num(entry.otHours || 0), otRate: num(entry.otRate || 0),
    expenses: entry.expenses && typeof entry.expenses === 'object' ? entry.expenses : {}, notes: entry.notes || '',
    invoiceMode: entry.invoiceMode || 'with', rangeGroupId: entry.rangeGroupId || '', rangeStart: entry.rangeStart || '', rangeEnd: entry.rangeEnd || '',
    excludedDates: Array.isArray(entry.excludedDates) ? entry.excludedDates.filter(Boolean) : [],
    createdAt: entry.createdAt || new Date().toISOString(), updatedAt: entry.updatedAt || new Date().toISOString()
  };
}
function migrateLegacy(oldData) {
  const migrated = clone(DEFAULT_STATE);
  const oldSettings = oldData.settings || {};
  migrated.settings = {
    ...migrated.settings,
    name: oldSettings.name || '', address: oldSettings.addr || '', tel: oldSettings.tel || '', companyName: oldSettings.co || '',
    bank: oldSettings.bank || '', branch: oldSettings.branch || '', accountNo: oldSettings.accno || '', accountName: oldSettings.accname || '',
    invoiceNo: oldSettings.invno || '', invoiceEnabled: oldSettings.showInv !== false, taxRate: num(oldSettings.taxRate || 10),
    defaultDayRate: num(oldSettings.tanka || 0), defaultNightRate: num(oldSettings.ntanka || 0), defaultOtRate: num(oldSettings.ottanka || 0),
    companies: [...new Set((oldData.entries || []).map((entry) => entry.co).filter(Boolean))],
    companyRates: [...new Set((oldData.entries || []).map((entry) => entry.co).filter(Boolean))].map((name) => ({ id: crypto.randomUUID(), name, officialName: name, dayRate: num(oldSettings.tanka || 0), nightRate: num(oldSettings.ntanka || 0), otRate: num(oldSettings.ottanka || 0) })),
  };
  migrated.entries = (oldData.entries || []).map((entry) => ({
    id: String(entry.id || crypto.randomUUID()), date: toYmd(new Date(entry.y, entry.m, entry.d)), type: entry.type || 'self',
    shift: entry.wt === 'night' ? 'night' : entry.wt === 'trip' ? 'trip' : 'day', company: entry.co || '', site: entry.site || '',
    workerName: entry.subname || '', qty: qtyValue(entry.ninku), unitRate: num(entry.tanka || 0),
    otHours: num(entry.oth || 0), otRate: num(entry.ottanka || 0),
    expenses: { exp1: num(entry.kotsu || 0), exp2: num(entry.parking || 0), exp3: num(entry.shuku || 0), exp4: num(entry.gas || 0), exp5: num(entry.zai || 0), exp6: num(entry.other || 0) },
    notes: entry.memo || '', invoiceMode: 'with', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }));
  saveState(migrated);
  return migrated;
}
function saveState(nextState = state) { localStorage.setItem(STORE_KEY, JSON.stringify(nextState)); }
function loadSyncMeta() {
  try {
    return { lastCloudModifiedAt: '', lastLocalModifiedAt: '', lastSyncedAt: '', ...(JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}')) };
  } catch (error) {
    return { lastCloudModifiedAt: '', lastLocalModifiedAt: '', lastSyncedAt: '' };
  }
}
function saveSyncMeta(meta) { localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...loadSyncMeta(), ...meta })); }
function dateTime(value) { return Date.parse(value || '') || 0; }
function isAfterDate(a, b) { return dateTime(a) > dateTime(b); }
function num(value) { const n = Number(value); return Number.isFinite(n) ? n : 0; }
function qtyValue(value, fallback = 1) { return value === '' || value === null || value === undefined ? fallback : num(value); }
function roundTo(value, digits = 2) { const factor = 10 ** digits; return Math.round((num(value) + Number.EPSILON) * factor) / factor; }
function qtyLabel(value) { return roundTo(value, 2).toLocaleString('ja-JP', { maximumFractionDigits: 2 }); }
function yen(value, hidden = false) { return hidden ? '••••••' : `¥${Math.round(num(value)).toLocaleString('ja-JP')}`; }
function yenPlain(value, hidden = false) { return hidden ? '••••••' : Math.round(num(value)).toLocaleString('ja-JP'); }
function escapeHtml(value) { return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function toYmd(date) { const d = new Date(date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function fromYmd(ymd) { const [y, m, d] = String(ymd).split('-').map(Number); return new Date(y, m - 1, d); }
function startOfMonth(date) { return new Date(date.getFullYear(), date.getMonth(), 1); }
function monthKey(dateOrString) { const d = typeof dateOrString === 'string' ? fromYmd(dateOrString) : new Date(dateOrString); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function fmtMonth(date) { return `${date.getFullYear()}年${date.getMonth() + 1}月`; }
function fmtDateJP(ymd) { const d = fromYmd(ymd); return `${d.getMonth() + 1}月${d.getDate()}日`; }
function weekdayLabel(ymd) { return ['日', '月', '火', '水', '木', '金', '土'][fromYmd(ymd).getDay()]; }
function dateList(startDate, endDate) {
  if (!startDate || !endDate || fromYmd(endDate) < fromYmd(startDate)) return [];
  const dates = [];
  const current = fromYmd(startDate), last = fromYmd(endDate);
  while (current <= last) {
    dates.push(toYmd(current));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}
function shortDateLabel(ymd) {
  return `${fmtDateJP(ymd)}(${weekdayLabel(ymd)})`;
}
function sortedExpenseText(expenses) {
  return JSON.stringify(Object.entries(expenses || {}).sort(([a], [b]) => a.localeCompare(b)));
}
function entrySignature(entry) {
  return [
    entry.type || 'self', entry.shift || 'day', entry.company || '', entry.site || '', entry.workerName || '',
    num(entry.qty), num(entry.unitRate), num(entry.otHours), num(entry.otRate), entry.notes || '', sortedExpenseText(entry.expenses)
  ].join('\u001f');
}
function contiguousLegacyGroup(entry) {
  const matching = state.entries
    .filter((item) => item.createdAt === entry.createdAt && entrySignature(item) === entrySignature(entry))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (matching.length <= 1) return [entry];
  const index = matching.findIndex((item) => item.id === entry.id);
  if (index < 0) return [entry];
  let start = index, end = index;
  while (start > 0 && adjacentYmd(matching[start - 1].date, 1) === matching[start].date) start -= 1;
  while (end < matching.length - 1 && adjacentYmd(matching[end].date, 1) === matching[end + 1].date) end += 1;
  return matching.slice(start, end + 1);
}
function entryRangeGroup(entry) {
  if (!entry) return { entries: [], ids: new Set(), start: selectedDate, end: selectedDate, excludedDates: [], groupId: '' };
  let entries = [entry];
  if (entry.rangeGroupId) {
    entries = state.entries.filter((item) => item.rangeGroupId === entry.rangeGroupId).sort((a, b) => a.date.localeCompare(b.date));
  } else {
    entries = contiguousLegacyGroup(entry);
  }
  const first = entries[0] || entry;
  const last = entries[entries.length - 1] || entry;
  const start = entry.rangeStart || first.date || entry.date;
  const end = entry.rangeEnd || last.date || entry.date;
  const included = new Set(entries.map((item) => item.date));
  const excluded = entry.excludedDates?.length ? entry.excludedDates : dateList(start, end).filter((date) => !included.has(date));
  return { entries, ids: new Set(entries.map((item) => item.id)), start, end, excludedDates: excluded, groupId: entry.rangeGroupId || '' };
}
function editingGroupIds() {
  const entry = editingId ? state.entries.find((item) => item.id === editingId) : null;
  return entryRangeGroup(entry).ids;
}
function expenseItems() { return normalizeExpenseItems(state.settings.expenseItems); }
function companyOptions() { return companyPresets().map((item) => item.name).sort((a, b) => a.localeCompare(b, 'ja')); }
function companyPresets() { return normalizeCompanyRates(state.settings.companyRates, state.settings.companies); }
function companyPresetByName(name) { return companyPresets().find((item) => item.name === name); }
function companyOfficialName(name) { return companyPresetByName(name)?.officialName || name; }
function rateForPresetShift(preset, shift) { if (!preset) return 0; return shift === 'night' ? num(preset.nightRate) : num(preset.dayRate); }
function subcontractEnabled() { return state.settings.showSubcontract !== false; }
function yearEntries() { const year = cursor.getFullYear(); return state.entries.filter((entry) => fromYmd(entry.date).getFullYear() === year); }
function sumBy(entries, selector) { return entries.reduce((sum, entry) => sum + selector(entry), 0); }
function rateFieldValue(value) { return num(value) ? String(num(value)) : ''; }
function settingListValues(hiddenId) { return (document.getElementById(hiddenId)?.value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
function writeSettingList(hiddenId, values) { const hidden = document.getElementById(hiddenId); if (hidden) hidden.value = values.join('\n'); }
function renderEditableList(listId, hiddenId) {
  const list = document.getElementById(listId); if (!list) return;
  const values = settingListValues(hiddenId);
  list.innerHTML = values.length ? values.map((label, index) => `<span class="setting-chip">${escapeHtml(label)}<button type="button" data-remove-setting-item="${hiddenId}" data-remove-index="${index}" aria-label="削除">×</button></span>`).join('') : '<div class="empty-inline">まだ登録がありません</div>';
}
function companyPresetValues() {
  try { return normalizeCompanyRates(JSON.parse(document.getElementById('st-company-presets')?.value || '[]')); } catch (error) { return []; }
}
function writeCompanyPresetValues(presets) {
  const normalized = normalizeCompanyRates(presets);
  const hidden = document.getElementById('st-company-presets'); if (hidden) hidden.value = JSON.stringify(normalized);
  writeSettingList('st-companies', normalized.map((item) => item.name));
}
function companyRateText(preset) {
  const parts = [];
  if (num(preset.dayRate)) parts.push(`日 ${yen(preset.dayRate)}`);
  if (num(preset.nightRate)) parts.push(`夜 ${yen(preset.nightRate)}`);
  if (num(preset.otRate)) parts.push(`残 ${yen(preset.otRate)}`);
  return parts.join(' / ') || '単価未設定';
}
function renderCompanyPresetList() {
  const list = document.getElementById('st-company-list'); if (!list) return;
  const presets = companyPresetValues();
  list.innerHTML = presets.length ? presets.map((preset, index) => `
    <div class="company-rate-card">
      <div class="company-rate-edit">
        <input class="st-input company-rate-name-input" data-company-preset-field="name" data-company-preset-id="${escapeHtml(preset.id)}" value="${escapeHtml(preset.name)}" placeholder="カレンダー表示名">
        <input class="st-input company-rate-name-input" data-company-preset-field="officialName" data-company-preset-id="${escapeHtml(preset.id)}" value="${escapeHtml(preset.officialName || preset.name)}" placeholder="請求書・出面表の正式名称">
        <input class="st-input" type="number" inputmode="numeric" data-company-preset-field="dayRate" data-company-preset-id="${escapeHtml(preset.id)}" value="${rateFieldValue(preset.dayRate)}" placeholder="日勤">
        <input class="st-input" type="number" inputmode="numeric" data-company-preset-field="nightRate" data-company-preset-id="${escapeHtml(preset.id)}" value="${rateFieldValue(preset.nightRate)}" placeholder="夜勤">
        <input class="st-input" type="number" inputmode="numeric" data-company-preset-field="otRate" data-company-preset-id="${escapeHtml(preset.id)}" value="${rateFieldValue(preset.otRate)}" placeholder="残業">
      </div>
      <button type="button" data-remove-company-preset="${index}" aria-label="削除">×</button>
    </div>`).join('') : '<div class="empty-inline">まだ登録がありません</div>';
}
function markSettingsSections(sections) {
  const list = Array.isArray(sections) ? sections : [sections];
  const now = new Date().toISOString();
  state.settings.settingUpdatedAt = { ...(state.settings.settingUpdatedAt || {}) };
  list.filter(Boolean).forEach((section) => { state.settings.settingUpdatedAt[section] = now; });
  state.settings.updatedAt = now;
}
function settingsSectionTime(settings, section) {
  return Date.parse(settings?.settingUpdatedAt?.[section] || settings?.updatedAt || '') || 0;
}
function mergeCompanyPresetLists(localSettings, remoteSettings) {
  const localTime = settingsSectionTime(localSettings, 'companies');
  const remoteTime = settingsSectionTime(remoteSettings, 'companies');
  const byName = new Map();
  const mergeItem = (preset, sourceTime) => {
    const key = String(preset.name || '').trim().toLowerCase();
    if (!key) return;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, { ...preset, _time: sourceTime });
      return;
    }
    const incomingIsNewer = sourceTime >= existing._time;
    const preferred = incomingIsNewer ? preset : existing;
    const fallback = incomingIsNewer ? existing : preset;
    byName.set(key, {
      id: existing.id || preset.id || crypto.randomUUID(),
      name: preferred.name || fallback.name,
      officialName: preferred.officialName || fallback.officialName || preferred.name || fallback.name,
      dayRate: num(preferred.dayRate) || num(fallback.dayRate),
      nightRate: num(preferred.nightRate) || num(fallback.nightRate),
      otRate: num(preferred.otRate) || num(fallback.otRate),
      _time: Math.max(existing._time || 0, sourceTime || 0),
    });
  };
  normalizeCompanyRates(localSettings.companyRates, localSettings.companies).forEach((preset) => mergeItem(preset, localTime));
  normalizeCompanyRates(remoteSettings.companyRates, remoteSettings.companies).forEach((preset) => mergeItem(preset, remoteTime));
  return [...byName.values()].map(({ _time, ...preset }) => preset).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}
function mergeSettingsBySection(localSettings, remoteSettings) {
  const local = normalizeState({ settings: localSettings }).settings;
  const remote = normalizeState({ settings: remoteSettings }).settings;
  const merged = { ...local };
  Object.entries(SETTINGS_SECTIONS).forEach(([section, keys]) => {
    if (section === 'companies') {
      const companyRates = mergeCompanyPresetLists(local, remote);
      merged.companyRates = companyRates;
      merged.companies = companyRates.map((item) => item.name);
      return;
    }
    const source = settingsSectionTime(remote, section) > settingsSectionTime(local, section) ? remote : local;
    keys.forEach((key) => { merged[key] = clone(source[key]); });
  });
  merged.settingUpdatedAt = { ...(local.settingUpdatedAt || {}) };
  Object.keys(SETTINGS_SECTIONS).forEach((section) => {
    const localTime = settingsSectionTime(local, section);
    const remoteTime = settingsSectionTime(remote, section);
    merged.settingUpdatedAt[section] = remoteTime > localTime ? remote.settingUpdatedAt?.[section] || remote.updatedAt || '' : local.settingUpdatedAt?.[section] || local.updatedAt || '';
  });
  merged.updatedAt = new Date(Math.max(Date.parse(local.updatedAt || '') || 0, Date.parse(remote.updatedAt || '') || 0, ...Object.values(merged.settingUpdatedAt).map((value) => Date.parse(value || '') || 0))).toISOString();
  return merged;
}
function updateCompanyPresetField(id, field, value) {
  const values = companyPresetValues();
  const item = values.find((preset) => preset.id === id); if (!item) return;
  if (field === 'name') {
    const oldName = item.name;
    const nextName = value.trim();
    if (!nextName) return;
    item.name = nextName;
    item.officialName = item.officialName || oldName;
    state.entries = state.entries.map((entry) => entry.company === oldName ? { ...entry, company: nextName, updatedAt: new Date().toISOString() } : entry);
    if (selectedCompany === oldName) selectedCompany = nextName;
  } else if (field === 'officialName') {
    item.officialName = value.trim();
  } else {
    item[field] = num(value);
  }
  writeCompanyPresetValues(values);
  scheduleSettingsAutosave({ section: 'companies' });
}
function renderSettingListEditors() { renderCompanyPresetList(); renderEditableList('st-expense-list', 'st-expenses'); }
function addCompanyPreset() {
  const nameInput = document.getElementById('st-company-new'); if (!nameInput) return;
  const name = nameInput.value.trim(); if (!name) return;
  const next = companyPresetValues().filter((item) => item.name !== name);
  next.push({ id: crypto.randomUUID(), name, officialName: document.getElementById('st-company-official-new')?.value.trim() || name, dayRate: num(document.getElementById('st-company-day-new')?.value), nightRate: num(document.getElementById('st-company-night-new')?.value), otRate: num(document.getElementById('st-company-ot-new')?.value) });
  writeCompanyPresetValues(next);
  ['st-company-new', 'st-company-official-new', 'st-company-day-new', 'st-company-night-new', 'st-company-ot-new'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderCompanyPresetList();
  scheduleSettingsAutosave({ immediate: true, section: 'companies' });
}
function addSettingListItem(hiddenId, inputId) {
  const input = document.getElementById(inputId); if (!input) return;
  const value = input.value.trim(); if (!value) return;
  const values = [...new Set([...settingListValues(hiddenId), value])];
  writeSettingList(hiddenId, values); input.value = ''; renderSettingListEditors();
  scheduleSettingsAutosave({ immediate: true, section: 'expenses' });
}
function showSaveFeedback(message) {
  const el = document.getElementById('save-status'); if (!el) { alert(message); return; }
  el.textContent = message; el.classList.add('show');
  window.clearTimeout(showSaveFeedback.timer);
  showSaveFeedback.timer = window.setTimeout(() => el.classList.remove('show'), 2200);
}
function guessReceiptCategory(name) {
  const text = String(name || '').toLowerCase();
  if (/parking|駐車|パーキング/.test(text)) return '駐車場代';
  if (/hotel|宿|旅館/.test(text)) return '宿泊費';
  if (/gas|fuel|ガソリン|燃料/.test(text)) return 'ガソリン代';
  if (/train|bus|taxi|交通|電車|バス|タクシー/.test(text)) return '交通費';
  if (/資材|材料|工具|tool/.test(text)) return '資材代';
  return expenseItems()[0]?.label || 'その他';
}
function monthEntries() { const key = monthKey(cursor); return state.entries.filter((entry) => monthKey(entry.date) === key).sort((a, b) => a.date.localeCompare(b.date)); }
function dayEntries(ymd) { return state.entries.filter((entry) => entry.date === ymd).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
function calcEntry(entry) {
  const qty = qtyValue(entry.qty), unitRate = num(entry.unitRate), otHours = num(entry.otHours), otRate = num(entry.otRate);
  const labor = qty * unitRate, overtime = otHours * otRate;
  const expenses = expenseItems().reduce((sum, item) => sum + num(entry.expenses?.[item.id]), 0);
  const subtotal = labor + overtime + expenses;
  const paymentAmount = entry.type === 'sub' ? num(entry.paymentAmount) : 0;
  const subcontractPay = entry.type === 'sub' ? (paymentAmount || subtotal) : 0;
  const subcontractDiff = entry.type === 'sub' ? subtotal - subcontractPay : 0;
  return { qty, unitRate, otHours, otRate, labor, overtime, expenses, subtotal, paymentAmount, subcontractPay, subcontractDiff };
}
function salesTotalForEntry(entry) {
  const parts = { ...DEFAULT_SETTINGS.salesTotalParts, ...(state.settings.salesTotalParts || {}) };
  const calc = calcEntry(entry);
  return (parts.labor ? calc.labor : 0) + (parts.overtime ? calc.overtime : 0) + (parts.expenses ? calc.expenses : 0);
}
function shiftLabel(shift) { return { day: '日勤', night: '夜勤', trip: '出張' }[shift] || '日勤'; }
function shiftClass(shift) { return { day: 'day', night: 'night', trip: 'trip' }[shift] || 'day'; }
function typeLabel(type) { return type === 'sub' ? '外注' : '自分'; }
function pickSelectedCompany() { const companies = getInvoiceCompanies(); if (!companies.length) { selectedCompany = ''; return companies; } if (!companies.includes(selectedCompany)) selectedCompany = companies[0]; return companies; }
function getInvoiceCompanies() { return [...new Set(monthEntries().filter((entry) => entry.type === 'self').map((entry) => entry.company).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja')); }
function companyInvoiceMode(company) { return state.settings.companyInvoiceModes?.[company] || 'with'; }
function setCompanyInvoiceMode(company, mode) { state.settings.companyInvoiceModes[company] = mode; saveState(); }
function companyEventTitle(entry) { return [entry.company, entry.site].filter(Boolean).join(' / ') || '現場予定'; }
function adjacentYmd(ymd, offset) { const d = fromYmd(ymd); d.setDate(d.getDate() + offset); return toYmd(d); }
function hasAdjacentCompany(ymd, entry) {
  if (!entry.company) return false;
  return dayEntries(ymd).some((item) => item.company === entry.company && item.shift === entry.shift);
}
function calendarTaskClass(entry, ymd, dayOfWeek) {
  const classes = ['cal-task', shiftClass(entry.shift), entry.type === 'sub' ? 'sub' : ''];
  if (dayOfWeek !== 0 && hasAdjacentCompany(adjacentYmd(ymd, -1), entry)) classes.push('cont-left');
  if (dayOfWeek !== 6 && hasAdjacentCompany(adjacentYmd(ymd, 1), entry)) classes.push('cont-right');
  return classes.filter(Boolean).join(' ');
}

function renderAll() { renderNav(); renderHeaders(); renderCalendar(); renderDayEntries(); renderSubScreen(); renderInvoiceScreen(); renderSettings(); renderSyncScreen(); renderReceiptScreen(); }
function renderNav() {
  if (activeScreen === 'sub' && !subcontractEnabled()) activeScreen = 'cal';
  if (activeScreen !== 'cal') isDayModalOpen = false;
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active', 'print-active'));
  document.getElementById(`sc-${activeScreen}`)?.classList.add('active');
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.screen === activeScreen));
  syncMenuClones();
  document.querySelectorAll('[data-screen="sub"],[data-screen-link="sub"]').forEach((el) => el.classList.toggle('hidden', !subcontractEnabled()));
  document.getElementById('fab-sub')?.classList.toggle('hidden', !subcontractEnabled());
  document.querySelectorAll('.top-menu').forEach((menu) => menu.classList.add('hidden'));
}
function syncMenuClones() {
  const subItem = subcontractEnabled() ? '<button class="top-menu-item" data-screen-link="sub">外注</button>' : '';
  const template = `
    <button class="top-menu-item" data-screen-link="cal">カレンダー</button>
    ${subItem}
    <button class="top-menu-item" data-screen-link="inv">請求</button>
    <button class="top-menu-item" data-screen-link="sync">Google同期</button>
    <button class="top-menu-item" data-screen-link="receipt">領収書</button>
    <button class="top-menu-item" data-screen-link="st">設定</button>
    <button class="top-menu-item" data-sales-toggle>${state.settings.showSales ? '売上を隠す' : '売上を表示'}</button>`;
  document.querySelectorAll('.top-menu').forEach((menu) => { menu.innerHTML = template; });
}
function renderHeaders() {
  const monthText = fmtMonth(cursor);
  const version = document.getElementById('app-version-badge'); if (version) version.textContent = APP_VERSION;
  document.getElementById('cal-sub').textContent = `${monthText} ・ 予定 ${monthEntries().length}件`;
  document.getElementById('sub-sub').textContent = `${monthText}の外注出面`;
  document.getElementById('inv-sub').textContent = `${monthText}の会社別帳票`;
  ['cal', 'sub', 'inv'].forEach((prefix) => { const el = document.getElementById(`${prefix}-mnav`); if (el) el.textContent = monthText; });
}
function renderCalendar() {
  const grid = document.getElementById('cal-grid');
  const monthStart = startOfMonth(cursor), startDay = monthStart.getDay();
  const firstCell = new Date(monthStart); firstCell.setDate(firstCell.getDate() - startDay);
  const rows = ['日', '月', '火', '水', '木', '金', '土'].map((label) => `<div class="cal-dow">${label}</div>`);
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(firstCell); date.setDate(firstCell.getDate() + i);
    const ymd = toYmd(date); const items = dayEntries(ymd);
    const classes = ['cal-day'];
    if (date.getMonth() !== cursor.getMonth()) classes.push('other');
    if (ymd === selectedDate) classes.push('sel');
    if (ymd === toYmd(new Date())) classes.push('today');
    if (date.getDay() === 0) classes.push('sun'); if (date.getDay() === 6) classes.push('sat');
    const displayedItems = [...items].sort((a, b) => companyEventTitle(a).localeCompare(companyEventTitle(b), 'ja') || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    const lines = displayedItems.slice(0, 4).map((entry) => `<div class="${calendarTaskClass(entry, ymd, date.getDay())}">${escapeHtml(companyEventTitle(entry))}</div>`).join('');
    const hiddenCount = Math.max(0, items.length - 4);
    const more = hiddenCount ? `<div class="more-chip" aria-label="ほかに${hiddenCount}件">… +${hiddenCount}</div>` : '';
    rows.push(`<button class="${classes.join(' ')}" data-date="${ymd}"><span class="dn">${date.getDate()}</span><div class="task-stack">${lines}</div>${more}</button>`);
  }
  grid.innerHTML = rows.join('');
  renderSummary();
}
function renderSummary() {
  const selfEntries = monthEntries().filter((entry) => entry.type === 'self');
  const yearSelfEntries = yearEntries().filter((entry) => entry.type === 'self');
  const monthQty = sumBy(selfEntries, (entry) => calcEntry(entry).qty);
  const yearQty = sumBy(yearSelfEntries, (entry) => calcEntry(entry).qty);
  const monthSalesAmount = sumBy(selfEntries, salesTotalForEntry);
  const yearSalesAmount = sumBy(yearSelfEntries, salesTotalForEntry);
  const hidden = !state.settings.showSales;
  document.getElementById('sum-grid').innerHTML = `
    <div class="sum-card"><div class="sl">今月の人工</div><div class="sv green">${qtyLabel(monthQty)}</div></div>
    <div class="sum-card"><div class="sl">今月の売上</div><div class="sv ${hidden ? 'hidden-amount' : ''}">${yen(monthSalesAmount, hidden)}</div></div>
    <div class="sum-card"><div class="sl">${cursor.getFullYear()}年の人工</div><div class="sv green">${qtyLabel(yearQty)}</div></div>
    <div class="sum-card"><div class="sl">${cursor.getFullYear()}年の売上</div><div class="sv ${hidden ? 'hidden-amount' : ''}">${yen(yearSalesAmount, hidden)}</div></div>`;
}
function renderDayEntries() {
  const legacy = document.getElementById('day-entries');
  if (legacy) legacy.innerHTML = '';
  const modal = document.getElementById('day-modal-bg');
  const title = document.getElementById('day-modal-title');
  const body = document.getElementById('day-modal-body');
  if (!modal || !title || !body) return;
  const entries = dayEntries(selectedDate);
  title.textContent = `${fmtDateJP(selectedDate)}（${weekdayLabel(selectedDate)}）`;
  if (!entries.length) {
    body.innerHTML = `<div class="day-mini-empty"><div class="empty" style="padding:22px 10px 8px"><div>この日の予定はありません</div><p>追加ボタンから登録できます。</p></div><button class="btn-primary" type="button" data-add-date="${selectedDate}">予定を追加</button></div>`;
    modal.classList.toggle('open', activeScreen === 'cal' && isDayModalOpen);
    return;
  }
  body.innerHTML = `<div class="day-mini-list">${entries.map((entry) => {
    const isSub = entry.type === 'sub';
    return `<div class="day-mini-card ${shiftClass(entry.shift)} ${isSub ? 'sub' : ''}"><div class="day-mini-row"><div><div class="day-mini-site">${escapeHtml(entry.site || '現場名未入力')}</div><div class="day-mini-company">${escapeHtml(entry.company || '会社名未入力')} ・ ${isSub ? escapeHtml(entry.workerName || '外注職人') : '自分'} ・ ${shiftLabel(entry.shift)}</div></div><div class="pill ${isSub ? 'sub' : shiftClass(entry.shift)}">${isSub ? '外注' : shiftLabel(entry.shift)}</div></div><div class="day-mini-actions"><button class="day-mini-btn" type="button" data-edit-entry="${entry.id}">編集</button><button class="day-mini-btn del" type="button" data-del-entry="${entry.id}">削除</button></div></div>`;
  }).join('')}<button class="btn-primary" type="button" data-add-date="${selectedDate}">予定を追加</button></div>`;
  modal.classList.toggle('open', activeScreen === 'cal' && isDayModalOpen);
}

function openDayModal(date) {
  selectedDate = date;
  if (monthKey(selectedDate) !== monthKey(cursor)) cursor = startOfMonth(fromYmd(selectedDate));
  isDayModalOpen = true;
  renderAll();
}

function closeDayModal() {
  isDayModalOpen = false;
  document.getElementById('day-modal-bg')?.classList.remove('open');
}
function renderSubScreen() {
  const body = document.getElementById('sub-body');
  const monthlySubs = monthEntries().filter((entry) => entry.type === 'sub');
  const groups = {};
  monthlySubs.forEach((entry) => {
    const name = entry.workerName || '名称未入力';
    if (!groups[name]) groups[name] = { days: 0, total: 0, pay: 0, diff: 0, companies: new Set(), entries: [] };
    const calc = calcEntry(entry);
    groups[name].days += qtyValue(entry.qty); groups[name].total += calc.subtotal; groups[name].pay += calc.subcontractPay; groups[name].diff += calc.subcontractDiff; groups[name].entries.push(entry); if (entry.company) groups[name].companies.add(entry.company);
  });
  const people = Object.entries(groups).sort((a, b) => b[1].pay - a[1].pay);
  const hidden = !state.settings.showSales;
  if (!people.length) { body.innerHTML = `<div class="sub-total-grid"><div class="sub-stat"><div class="k">外注人数</div><div class="v">0人</div></div><div class="sub-stat"><div class="k">支払合計</div><div class="v">${yen(0, hidden)}</div></div></div><div class="empty"><div class="icon">👷</div><div>外注の記録はまだありません</div><p>右下の＋から追加できます。</p></div>`; return; }
  const totalPay = people.reduce((sum, [, info]) => sum + info.pay, 0);
  const totalDiff = people.reduce((sum, [, info]) => sum + info.diff, 0);
  const totalDays = people.reduce((sum, [, info]) => sum + info.days, 0);
  body.innerHTML = `<div class="sub-total-grid"><div class="sub-stat"><div class="k">外注人数</div><div class="v">${people.length}人</div></div><div class="sub-stat"><div class="k">支払合計</div><div class="v ${hidden ? 'hidden-amount' : ''}">${yen(totalPay, hidden)}</div></div><div class="sub-stat"><div class="k">差額合計</div><div class="v ${hidden ? 'hidden-amount' : ''}">${yen(totalDiff, hidden)}</div></div><div class="sub-stat"><div class="k">人工合計</div><div class="v">${qtyLabel(totalDays)}</div></div></div><div class="btn-row" style="padding:0 16px 10px"><button class="btn-primary" data-export-sub-payments>支払いCSV出力</button></div>${people.map(([name, info]) => `<div class="sub-card"><div class="sub-card-hd"><div><div class="sub-card-name">${escapeHtml(name)}</div><div class="sub-card-sub">${[...info.companies].join(' / ') || '会社未入力'}</div></div><div><div class="sub-card-amt ${hidden ? 'hidden-amount' : ''}">${yen(info.pay, hidden)}</div><div class="sub-card-meta">${qtyLabel(info.days)}人工 / 差額 ${yen(info.diff, hidden)}</div></div></div><div class="sub-card-foot">${info.entries.slice(0, 4).map((entry) => { const calc = calcEntry(entry); return `<span class="etag">${fmtDateJP(entry.date)} ${escapeHtml(entry.site || '現場')} 支払 ${yen(calc.subcontractPay, hidden)}</span>`; }).join('')}</div></div>`).join('')}`;
}
const DEMEN_EXPENSE_LABELS = ['交通費', '駐車場代', '宿泊代', 'ガソリン代', '資材等', '他諸経費'];
function invoiceDateLabel() {
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  return `${last.getFullYear()}年${last.getMonth() + 1}月${last.getDate()}日`;
}
function entriesForInvoiceCompany() {
  return monthEntries().filter((entry) => entry.type === 'self' && entry.company === selectedCompany);
}
function invoiceTotals(entries) {
  const rows = entries.map((entry) => ({ entry, calc: calcEntry(entry) }));
  const qty = sumBy(entries, (entry) => calcEntry(entry).qty);
  const labor = sumBy(entries, (entry) => calcEntry(entry).labor);
  const otHours = sumBy(entries, (entry) => calcEntry(entry).otHours);
  const overtime = sumBy(entries, (entry) => calcEntry(entry).overtime);
  const expenseColumns = DEMEN_EXPENSE_LABELS.map((label, index) => ({ label, item: expenseItems()[index] || { id: `exp${index + 1}`, label } }));
  const expenses = expenseColumns.map((col) => ({ ...col, total: sumBy(entries, (entry) => num(entry.expenses?.[col.item.id])) }));
  const expenseTotal = expenses.reduce((sum, item) => sum + item.total, 0);
  const subtotal = labor + overtime;
  const tax = state.settings.invoiceEnabled ? Math.round(subtotal * (num(state.settings.taxRate) / 100)) : 0;
  return { rows, qty, labor, otHours, overtime, expenses, expenseTotal, subtotal, tax, total: subtotal + tax + expenseTotal };
}
function buildInvoiceSheet(entries, totals, hidden) {
  const s = state.settings;
  const invoiceCompany = companyOfficialName(selectedCompany);
  const laborRate = entries.find((entry) => calcEntry(entry).unitRate)?.unitRate || 0;
  const otRate = entries.find((entry) => calcEntry(entry).otRate)?.otRate || 0;
  const stamp = s.stampImage ? `<img class="invoice-stamp" src="${s.stampImage}" alt="印鑑">` : '';
  const senderAddress = [s.postalCode ? `〒 ${escapeHtml(s.postalCode)}` : '', s.address ? escapeHtml(s.address) : ''].filter(Boolean).join(' ');
  const expenseRows = totals.expenses.map((item) => `<tr><td></td><td colspan="2" class="left">${escapeHtml(item.label)}</td><td></td><td></td><td></td><td class="right">${item.total ? yenPlain(item.total, hidden) : ''}</td><td></td></tr>`).join('');
  return `
    <div class="invoice-scroll">
      <div class="invoice-sheet" id="print-invoice-box">
        <div class="invoice-title">御　請　求　書</div>
        <div class="invoice-date">${invoiceDateLabel()}</div>
        <div class="invoice-to"><span>${escapeHtml(invoiceCompany)}</span><b>御中</b></div>
        <div class="invoice-message">　　下記のとおりご請求申し上げます</div>
        <div class="invoice-sender">
          ${stamp}
          <strong>${escapeHtml(s.companyName || s.name || '')}</strong>
          <span>${senderAddress}</span>
          <span>${s.tel ? `TEL ${escapeHtml(s.tel)}` : ''}</span>
          <span>${s.invoiceNo ? `登録番号：${escapeHtml(s.invoiceNo)}` : ''}</span>
        </div>
        <div class="invoice-amount"><span>御請求金額</span><strong>${yen(totals.total, hidden)}</strong></div>
        <div class="invoice-tax-note">※税込</div>
        <table class="invoice-table">
          <thead><tr><th>項目</th><th colspan="2">名称・形状・寸法</th><th>数量</th><th>単位</th><th>単価</th><th>金額</th><th>備考</th></tr></thead>
          <tbody>
            <tr><td>${cursor.getMonth() + 1}月</td><td colspan="2" class="left">別紙出面表参照</td><td>${qtyLabel(totals.qty)}</td><td>人工</td><td class="right">${laborRate ? yenPlain(laborRate, hidden) : ''}</td><td class="right">${yenPlain(totals.labor, hidden)}</td><td></td></tr>
            <tr><td></td><td colspan="2" class="left">残業</td><td>${totals.otHours || ''}</td><td>h</td><td class="right">${otRate ? yenPlain(otRate, hidden) : ''}</td><td class="right">${totals.overtime ? yenPlain(totals.overtime, hidden) : ''}</td><td></td></tr>
            <tr><td></td><td colspan="2" class="right">小計</td><td></td><td></td><td></td><td class="right">${yenPlain(totals.subtotal, hidden)}</td><td></td></tr>
            <tr><td></td><td colspan="2" class="right">消費税${num(s.taxRate)}%</td><td></td><td></td><td></td><td class="right">${yenPlain(totals.tax, hidden)}</td><td></td></tr>
            <tr><td></td><td colspan="2" class="center">諸経費</td><td></td><td></td><td></td><td></td><td></td></tr>
            ${expenseRows}
            <tr><td></td><td colspan="2" class="right">小計</td><td></td><td></td><td></td><td class="right">${yenPlain(totals.expenseTotal, hidden)}</td><td></td></tr>
            <tr class="invoice-total-row"><td></td><td colspan="4" class="center">合　　計（内税）</td><td></td><td class="right">${yenPlain(totals.total, hidden)}</td><td></td></tr>
          </tbody>
        </table>
        <div class="invoice-bank">
          <strong>振込先口座</strong>
          <span>銀行名　${escapeHtml(s.bank || '')}</span>
          <span>支店名　${escapeHtml(s.branch || '')}</span>
          <span>口座番号　${escapeHtml(s.accountNo || '')}</span>
          <span>口座名義　${escapeHtml(s.accountName || '')}</span>
        </div>
      </div>
    </div>`;
}
function dayInvoiceSummary(entries, day, expenseColumns) {
  const dayItems = entries.filter((entry) => Number(entry.date.slice(8, 10)) === day);
  const sites = [...new Set(dayItems.map((entry) => entry.site).filter(Boolean))].join(' / ');
  const qty = sumBy(dayItems, (entry) => calcEntry(entry).qty);
  const unitRate = dayItems.find((entry) => calcEntry(entry).unitRate)?.unitRate || 0;
  const labor = sumBy(dayItems, (entry) => calcEntry(entry).labor);
  const otHours = sumBy(dayItems, (entry) => calcEntry(entry).otHours);
  const otRate = dayItems.find((entry) => calcEntry(entry).otRate)?.otRate || 0;
  const overtime = sumBy(dayItems, (entry) => calcEntry(entry).overtime);
  const expenses = expenseColumns.map((col) => sumBy(dayItems, (entry) => num(entry.expenses?.[col.item.id])));
  const total = labor + overtime + expenses.reduce((sum, value) => sum + value, 0);
  return { dayItems, sites, qty, unitRate, labor, otHours, otRate, overtime, expenses, total };
}
function buildDemenSheet(entries, totals, hidden) {
  const expenseColumns = totals.expenses;
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const expenseHeaders = `${DEMEN_EXPENSE_LABELS.map((label) => `<th>${escapeHtml(label)}</th>`).join('')}<th>金　額</th>`;
  const shiftOrder = { day: 1, trip: 2, night: 3 };
  const demenRow = (day, entry = null) => {
    if (!entry) return `<tr><td>${day}</td><td class="left"></td><td></td><td class="right"></td><td class="right"></td><td></td><td class="right"></td><td class="right"></td>${expenseColumns.map(() => '<td class="right"></td>').join('')}<td class="right"></td></tr>`;
    const calc = calcEntry(entry);
    const expenses = expenseColumns.map((col) => num(entry.expenses?.[col.item.id]));
    const siteClass = entry.shift === 'night' ? 'left demen-night-site' : 'left';
    return `<tr><td>${day}</td><td class="${siteClass}">${escapeHtml(entry.site || '')}</td><td>${calc.qty || ''}</td><td class="right">${calc.unitRate ? yenPlain(calc.unitRate, hidden) : ''}</td><td class="right">${calc.labor ? yenPlain(calc.labor, hidden) : ''}</td><td>${calc.otHours || ''}</td><td class="right">${calc.otRate ? yenPlain(calc.otRate, hidden) : ''}</td><td class="right">${calc.overtime ? yenPlain(calc.overtime, hidden) : ''}</td>${expenses.map((value) => `<td class="right">${value ? yenPlain(value, hidden) : ''}</td>`).join('')}<td class="right">${calc.subtotal ? yenPlain(calc.subtotal, hidden) : ''}</td></tr>`;
  };
  const bodyRows = Array.from({ length: days }, (_, index) => {
    const day = index + 1;
    const dayItems = entries
      .filter((entry) => Number(entry.date.slice(8, 10)) === day)
      .sort((a, b) => (shiftOrder[a.shift] || 9) - (shiftOrder[b.shift] || 9) || String(a.site || '').localeCompare(String(b.site || ''), 'ja'));
    return dayItems.length ? dayItems.map((entry) => demenRow(day, entry)).join('') : demenRow(day);
  }).join('');
  return `
    <div class="tbl-wrap demen-sheet-wrap" id="print-demen-wrap">
      <table class="demen demen-sheet">
        <thead>
          <tr class="demen-title-row"><th colspan="4" class="left demen-company-name">${escapeHtml(companyOfficialName(selectedCompany) || '')}</th><th class="demen-title-main">${cursor.getMonth() + 1}</th><th colspan="3" class="left demen-title-main">月 出面表</th><th colspan="5"></th><th class="right demen-title-name">氏名：</th><th class="demen-title-name">${escapeHtml(state.settings.name || '')}</th></tr>
          <tr><th>日</th><th>現場名</th><th>人工</th><th>人工単価</th><th>人工合計</th><th>残業h</th><th>残業単価</th><th>残業合計</th>${expenseHeaders}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
        <tfoot>
          <tr><td></td><td class="right">小計</td><td>${qtyLabel(totals.qty)}</td><td></td><td class="right">${yenPlain(totals.labor, hidden)}</td><td>${totals.otHours || ''}</td><td></td><td class="right">${totals.overtime ? yenPlain(totals.overtime, hidden) : ''}</td>${totals.expenses.map((item) => `<td class="right">${item.total ? yenPlain(item.total, hidden) : ''}</td>`).join('')}<td class="right">${yenPlain(totals.labor + totals.overtime + totals.expenseTotal, hidden)}</td></tr>
          <tr class="demen-grand-row"><td colspan="9"></td><td colspan="3" class="right">合計</td><td colspan="3" class="right">${yenPlain(totals.labor + totals.overtime + totals.expenseTotal, hidden)}</td></tr>
        </tfoot>
      </table>
    </div>`;
}
function renderInvoiceScreen() {
  const tabs = document.getElementById('co-tabs');
  const body = document.getElementById('inv-body');
  const companies = pickSelectedCompany();
  if (!companies.length) { tabs.innerHTML = ''; body.innerHTML = `<div class="empty"><div class="icon">🧾</div><div>この月の請求対象はまだありません</div><p>自分の予定を入力するとここに会社別帳票が出ます。</p></div>`; return; }
  tabs.innerHTML = companies.map((company) => `<button class="co-chip ${company === selectedCompany ? 'active' : ''}" data-company="${escapeHtml(company)}">${escapeHtml(company)}</button>`).join('');
  const entries = entriesForInvoiceCompany();
  const totals = invoiceTotals(entries);
  const hidden = !state.settings.showSales;
  body.innerHTML = `<div class="btn-row invoice-actions" style="padding:0 16px 10px"><button class="btn-primary" data-print-invoice>請求書印刷</button><button class="btn-gold" data-print-demen>出面表印刷</button><button class="btn-secondary" data-export-invoice>請求CSV</button><button class="btn-secondary" data-export-demen>出面CSV</button></div>${buildInvoiceSheet(entries, totals, hidden)}${buildDemenSheet(entries, totals, hidden)}`;
}
function expenseTotals(entries) {
  return expenseItems().map((item) => ({
    ...item,
    total: entries.reduce((sum, entry) => sum + num(entry.expenses?.[item.id]), 0),
  })).filter((item) => item.total > 0);
}
function renderExpenseRows(title, rows) {
  if (!rows.length) return `<div class="expense-group"><div class="expense-group-title">${escapeHtml(title)}</div><div class="expense-empty">経費入力なし</div></div>`;
  return `<div class="expense-group"><div class="expense-group-title">${escapeHtml(title)}</div>${rows.map((row) => `<div class="expense-row"><span>${escapeHtml(row.label)}</span><strong>${yen(row.total, !state.settings.showSales)}</strong></div>`).join('')}</div>`;
}
function renderSyncScreen() {
  const month = monthEntries();
  const sub = document.getElementById('sync-sub'); if (sub) sub.textContent = '出力と引き継ぎ';
  const rangeStart = document.getElementById('google-export-start');
  const rangeEnd = document.getElementById('google-export-end');
  if (rangeStart && !rangeStart.value) rangeStart.value = toYmd(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  if (rangeEnd && !rangeEnd.value) rangeEnd.value = toYmd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const rangeEntries = calendarRangeEntries();
  const calendarCount = document.getElementById('calendar-export-count'); if (calendarCount) calendarCount.textContent = `${calendarExportGroups(rangeEntries).length}件`;
  const backupStatus = document.getElementById('backup-status'); if (backupStatus) backupStatus.textContent = `${state.entries.length}予定`;
  const clientInput = document.getElementById('google-client-id'); if (clientInput && !clientInput.value) clientInput.value = state.settings.googleClientId || '';
  const driveStatus = document.getElementById('drive-sync-status'); if (driveStatus) driveStatus.textContent = googleAccessToken ? 'ログイン済み' : (state.settings.googleClientId ? '設定済み' : '未設定');
  const log = document.getElementById('sync-log'); if (log && !log.textContent) log.textContent = 'PCで変更したら「この端末から送る」。スマホで開いたら「クラウドから受け取る」。スマホで変更した時は逆に使います';
}
function renderReceiptScreen() {
  const sub = document.getElementById('receipt-sub'); if (sub) sub.textContent = `${state.receipts?.length || 0}件`;
  const monthExpenses = expenseTotals(monthEntries());
  const yearExpenses = expenseTotals(yearEntries());
  const monthExpenseTotal = monthExpenses.reduce((sum, item) => sum + item.total, 0);
  const yearExpenseTotal = yearExpenses.reduce((sum, item) => sum + item.total, 0);
  const expenseTotal = document.getElementById('receipt-expense-total'); if (expenseTotal) expenseTotal.textContent = `今月 ${yen(monthExpenseTotal, !state.settings.showSales)}`;
  const summary = document.getElementById('receipt-expense-summary-body');
  if (summary) summary.innerHTML = `<div class="expense-summary">${renderExpenseRows('今月', monthExpenses)}${renderExpenseRows(`${cursor.getFullYear()}年`, yearExpenses)}</div><div class="expense-year-total">年間合計 <strong>${yen(yearExpenseTotal, !state.settings.showSales)}</strong></div>`;
  const body = document.getElementById('receipt-body'); if (!body) return;
  const receipts = state.receipts || [];
  if (!receipts.length) { body.innerHTML = '<div class="empty"><div>領収書はまだありません</div></div>'; return; }
  body.innerHTML = '<div class="receipt-list">' + receipts.map((receipt) => `<div class="receipt-card"><div class="receipt-main"><div class="receipt-name">${escapeHtml(receipt.fileName || '領収書')}</div><div class="receipt-meta">${escapeHtml(receipt.status)} ・ ${escapeHtml((receipt.importedAt || '').slice(0, 10))}</div></div><div class="receipt-fields"><input class="receipt-date" type="date" data-receipt-date="${receipt.id}" value="${escapeHtml(receipt.date || '')}"><input class="receipt-amount" type="number" inputmode="numeric" min="0" step="1" data-receipt-amount="${receipt.id}" value="${num(receipt.amount) || ''}" placeholder="金額"></div><select class="receipt-select" data-receipt-category="${receipt.id}">${expenseItems().map((item) => `<option value="${escapeHtml(item.label)}" ${item.label === receipt.category ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select><button class="btn-secondary receipt-apply" type="button" data-apply-receipt="${receipt.id}">予定へ入力</button><button class="receipt-del" type="button" data-del-receipt="${receipt.id}">×</button></div>`).join('') + '</div>';
}
function renderSettings() {
  const s = state.settings;
  const map = { 'st-name': s.name, 'st-postal': s.postalCode, 'st-addr': s.address, 'st-tel': s.tel, 'st-co': s.companyName, 'st-bank': s.bank, 'st-branch': s.branch, 'st-accno': s.accountNo, 'st-accname': s.accountName, 'st-invno': s.invoiceNo };
  Object.entries(map).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value ?? ''; });
  document.getElementById('st-tax').value = String(s.taxRate);
  const presets = normalizeCompanyRates(s.companyRates, s.companies);
  document.getElementById('st-companies').value = presets.map((item) => item.name).join('\n');
  const companyPresetStore = document.getElementById('st-company-presets'); if (companyPresetStore) companyPresetStore.value = JSON.stringify(presets);
  document.getElementById('st-expenses').value = expenseItems().map((item) => item.label).join('\n');
  document.getElementById('tgl-inv').classList.toggle('on', !!s.invoiceEnabled);
  document.getElementById('tgl-subcontract')?.classList.toggle('on', subcontractEnabled());
  const salesParts = { ...DEFAULT_SETTINGS.salesTotalParts, ...(s.salesTotalParts || {}) };
  document.getElementById('tgl-sales-labor')?.classList.toggle('on', !!salesParts.labor);
  document.getElementById('tgl-sales-overtime')?.classList.toggle('on', !!salesParts.overtime);
  document.getElementById('tgl-sales-expenses')?.classList.toggle('on', !!salesParts.expenses);
  document.getElementById('inv-no-row').classList.toggle('hidden', !s.invoiceEnabled);
  const stampPreview = document.getElementById('stamp-preview');
  if (stampPreview) {
    stampPreview.src = s.stampImage || '';
    stampPreview.classList.toggle('hidden', !s.stampImage);
  }
  renderSettingListEditors();
}
function createDefaultEntry(type, date) {
  return { id: '', date, type, shift: 'day', company: '', site: '', workerName: '', qty: 1, unitRate: '', paymentAmount: '', otHours: 0, otRate: '', expenses: Object.fromEntries(expenseItems().map((item) => [item.id, 0])), notes: '', invoiceMode: 'with' };
}
function renderRangeExclusions(selectedDates = null) {
  const wrap = document.getElementById('range-exclude-wrap');
  if (!wrap) return;
  const startDate = document.getElementById('f-date')?.value;
  const endDate = document.getElementById('f-end-date')?.value || startDate;
  const previous = selectedDates || [...wrap.querySelectorAll('[data-range-exclude]:checked')].map((input) => input.value);
  const excluded = new Set(previous);
  const dates = dateList(startDate, endDate);
  if (dates.length <= 1) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = `
    <div class="range-exclude-title">除外する日</div>
    <div class="range-exclude-list">
      ${dates.map((date) => `<label class="range-exclude-chip ${excluded.has(date) ? 'checked' : ''}"><input type="checkbox" data-range-exclude value="${date}" ${excluded.has(date) ? 'checked' : ''}>${escapeHtml(shortDateLabel(date))}</label>`).join('')}
    </div>`;
}
function ensureDatePicker() {
  if (document.getElementById('date-picker-bg')) return;
  const picker = document.createElement('div');
  picker.id = 'date-picker-bg';
  picker.className = 'date-picker-bg';
  document.body.appendChild(picker);
}
function renderDatePicker() {
  const picker = document.getElementById('date-picker-bg');
  if (!picker) return;
  const monthStart = startOfMonth(datePickerCursor);
  const first = new Date(monthStart);
  first.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    const ymd = toYmd(date);
    const classes = ['date-picker-day'];
    if (date.getMonth() !== datePickerCursor.getMonth()) classes.push('other');
    if (ymd === datePickerValue) classes.push('selected');
    if (date.getDay() === 0) classes.push('sun');
    if (typeof window.ninqHolidayName === 'function' && window.ninqHolidayName(ymd)) classes.push('holiday');
    cells.push(`<button class="${classes.join(' ')}" type="button" data-date-pick="${ymd}">${date.getDate()}</button>`);
  }
  picker.innerHTML = `
    <div class="date-picker">
      <div class="date-picker-head">
        <button type="button" data-date-picker-prev>‹</button>
        <strong>${fmtMonth(datePickerCursor)}</strong>
        <button type="button" data-date-picker-next>›</button>
      </div>
      <div class="date-picker-week">${['月', '火', '水', '木', '金', '土', '日'].map((day) => `<span>${day}</span>`).join('')}</div>
      <div class="date-picker-grid">${cells.join('')}</div>
      <div class="date-picker-actions">
        <button class="btn-secondary" type="button" data-date-picker-cancel>キャンセル</button>
        <button class="btn-primary" type="button" data-date-picker-ok>OK</button>
      </div>
    </div>`;
}
function openDatePicker(input) {
  ensureDatePicker();
  activeDatePickerInput = input;
  datePickerValue = input.value || selectedDate || toYmd(new Date());
  datePickerCursor = startOfMonth(fromYmd(datePickerValue));
  renderDatePicker();
  document.getElementById('date-picker-bg')?.classList.add('open');
}
function closeDatePicker() {
  document.getElementById('date-picker-bg')?.classList.remove('open');
  activeDatePickerInput = null;
}
function commitDatePicker() {
  if (activeDatePickerInput) {
    activeDatePickerInput.value = datePickerValue;
    activeDatePickerInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closeDatePicker();
}
function currentFormSubtotal() {
  const qty = qtyValue(document.getElementById('f-qty')?.value);
  const unitRate = num(document.getElementById('f-rate')?.value);
  const otHours = num(document.getElementById('f-ot-hours')?.value);
  const otRate = num(document.getElementById('f-ot-rate')?.value);
  const expenses = [...document.querySelectorAll('[data-expense-id]')].reduce((sum, input) => sum + num(input.value), 0);
  return qty * unitRate + otHours * otRate + expenses;
}
function updateSubcontractDiff() {
  const wrap = document.getElementById('sub-pay-wrap');
  if (!wrap) return;
  const isSub = document.querySelector('[data-entry-type].active')?.dataset.entryType === 'sub';
  wrap.classList.toggle('hidden', !isSub);
  if (!isSub) return;
  const subtotal = currentFormSubtotal();
  const payment = num(document.getElementById('f-payment-amount')?.value);
  const diff = subtotal - (payment || subtotal);
  const salesEl = document.getElementById('sub-sales-preview');
  const diffEl = document.getElementById('sub-diff-preview');
  if (salesEl) salesEl.textContent = yen(subtotal);
  if (diffEl) diffEl.value = yen(diff);
}
function openModal(type, id = null) {
  if (type === 'sub' && !subcontractEnabled()) type = 'self';
  editingId = id;
  const entry = id ? state.entries.find((item) => item.id === id) : createDefaultEntry(type, selectedDate);
  if (!entry) return;
  const editRange = id ? entryRangeGroup(entry) : null;
  const startValue = editRange?.start || entry.date;
  const endValue = editRange?.end || entry.date;
  const isSub = entry.type === 'sub' || type === 'sub';
  const expenseFields = expenseItems().map((item) => `<div class="field"><label>${escapeHtml(item.label)}</label><input type="number" min="0" step="1" data-expense-id="${item.id}" value="${num(entry.expenses?.[item.id]) || ''}"></div>`).join('');
  const typeButtons = `<button class="type-btn ${entry.type === 'self' ? 'active' : ''}" data-entry-type="self" type="button">自分</button>${subcontractEnabled() || entry.type === 'sub' ? `<button class="type-btn ${entry.type === 'sub' ? 'active' : ''}" data-entry-type="sub" type="button">外注職人</button>` : ''}`;
  const companyChoices = companyOptions();
  const companyOptionsHtml = companyChoices.map((name) => `<option value="${escapeHtml(name)}" ${name === entry.company ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('');
  const companyPickBlock = `<div class="company-combo"><select id="f-company-select"><option value="">選択</option>${companyOptionsHtml}</select><input id="f-company" value="${escapeHtml(entry.company)}" placeholder="自由入力できます"></div>`;
  document.getElementById('modal-title').textContent = id ? '予定を編集' : '予定を追加';
  document.getElementById('modal-body').innerHTML = `
    <div class="type-sel">${typeButtons}</div>
    <form id="entry-form">
      <div class="field-r2">
        <div class="field"><label>開始日</label><input id="f-date" class="date-picker-input" type="text" inputmode="none" readonly data-date-picker value="${escapeHtml(startValue)}"></div>
        <div class="field"><label>終了日</label><input id="f-end-date" class="date-picker-input" type="text" inputmode="none" readonly data-date-picker value="${escapeHtml(endValue)}"></div>
      </div>
      <div class="range-exclude-wrap" id="range-exclude-wrap"></div>
      ${isSub ? `<div class="field" id="worker-wrap"><label>職人名</label><input id="f-worker" value="${escapeHtml(entry.workerName)}" placeholder="佐藤大工"></div>` : `<div class="field hidden" id="worker-wrap"><label>職人名</label><input id="f-worker" value="${escapeHtml(entry.workerName)}"></div>`}
      <div class="field"><label>会社名</label>${companyPickBlock}</div>
      <div class="field"><label>現場名</label><input id="f-site" value="${escapeHtml(entry.site)}" placeholder="空欄でも保存できます"></div>
      <div class="field-r2"><div class="field"><label>勤務区分</label><select id="f-shift"><option value="day" ${entry.shift === 'day' ? 'selected' : ''}>日勤</option><option value="night" ${entry.shift === 'night' ? 'selected' : ''}>夜勤</option><option value="trip" ${entry.shift === 'trip' ? 'selected' : ''}>出張</option></select></div><div class="field"><label>人工</label><input id="f-qty" type="number" min="0" step="0.5" value="${entry.qty}"></div></div>
      <div class="field-r3"><div class="field"><label>単価</label><input id="f-rate" type="number" min="0" step="1" value="${rateFieldValue(entry.unitRate)}"></div><div class="field"><label>残業時間</label><input id="f-ot-hours" type="number" min="0" step="0.5" value="${num(entry.otHours) || ''}"></div><div class="field"><label>残業単価</label><input id="f-ot-rate" type="number" min="0" step="1" value="${rateFieldValue(entry.otRate)}"></div></div>
      <div class="${isSub ? '' : 'hidden'}" id="sub-pay-wrap">
        <div class="field-r2"><div class="field"><label>支払金額</label><input id="f-payment-amount" type="number" min="0" step="1" value="${rateFieldValue(entry.paymentAmount)}" placeholder="実際に払う金額"></div><div class="field"><label>差額</label><input id="sub-diff-preview" readonly value=""></div></div>
        <div class="sub-pay-note">売上計算 <strong id="sub-sales-preview">¥0</strong> との差額を表示します</div>
      </div>
      <div class="sec-hd" style="padding:0 0 8px">経費</div><div class="field-r2">${expenseFields}</div>
      <div class="field"><label>メモ</label><textarea id="f-notes" placeholder="注意点やメモ">${escapeHtml(entry.notes)}</textarea></div>
      <div class="btn-row entry-actions"><button class="btn-secondary" type="button" id="cancel-entry-btn">キャンセル</button><button class="btn-primary" type="submit">保存</button></div>
    </form>`;
  renderRangeExclusions(editRange?.excludedDates || []);
  updateSubcontractDiff();
  document.getElementById('modal-bg').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-bg').classList.remove('open');
  editingId = null;
}
function applyCompanyRate(name) {
  const preset = companyPresetByName(name);
  if (!preset) return;
  const shift = document.getElementById('f-shift')?.value || 'day';
  const rate = rateForPresetShift(preset, shift);
  const rateInput = document.getElementById('f-rate');
  const otRateInput = document.getElementById('f-ot-rate');
  if (rateInput && num(rate)) rateInput.value = rateFieldValue(rate);
  if (otRateInput && num(preset.otRate)) otRateInput.value = rateFieldValue(preset.otRate);
}
function collectEntryForm() {
  const type = document.querySelector('[data-entry-type].active')?.dataset.entryType || 'self';
  const startDate = document.getElementById('f-date').value;
  const endDate = document.getElementById('f-end-date')?.value || startDate;
  if (!startDate) throw new Error('開始日を入力してください');
  if (fromYmd(endDate) < fromYmd(startDate)) throw new Error('終了日は開始日以降にしてください');
  const original = editingId ? state.entries.find((item) => item.id === editingId) : null;
  const createdAt = original?.createdAt || new Date().toISOString();
  const base = {
    type, shift: document.getElementById('f-shift').value,
    company: document.getElementById('f-company').value.trim(), site: document.getElementById('f-site').value.trim(), workerName: document.getElementById('f-worker').value.trim(),
    qty: num(document.getElementById('f-qty').value), unitRate: num(document.getElementById('f-rate').value), paymentAmount: type === 'sub' ? num(document.getElementById('f-payment-amount')?.value) : 0, otHours: num(document.getElementById('f-ot-hours').value), otRate: num(document.getElementById('f-ot-rate').value),
    expenses: {}, notes: document.getElementById('f-notes').value.trim(), invoiceMode: 'with', createdAt, updatedAt: new Date().toISOString()
  };
  document.querySelectorAll('[data-expense-id]').forEach((input) => { base.expenses[input.dataset.expenseId] = num(input.value); });
  const excludedDates = [...document.querySelectorAll('[data-range-exclude]:checked')].map((input) => input.value);
  const excluded = new Set(excludedDates);
  const allDates = dateList(startDate, endDate);
  const dates = allDates.filter((date) => !excluded.has(date));
  if (!dates.length) throw new Error('登録する日がありません。除外日を減らしてください');
  const isRange = allDates.length > 1;
  const rangeGroupId = isRange ? (original?.rangeGroupId || crypto.randomUUID()) : '';
  return dates.map((date) => ({
    ...base,
    id: editingId && original?.date === date ? editingId : crypto.randomUUID(),
    date,
    rangeGroupId,
    rangeStart: isRange ? startDate : '',
    rangeEnd: isRange ? endDate : '',
    excludedDates: isRange ? excludedDates : [],
    expenses: { ...base.expenses }
  }));
}
function upsertEntry(entry) {
  state.entries = state.entries.filter((item) => item.id !== entry.id);
  state.entries.push(entry);
  if (state.deletedEntryIds) delete state.deletedEntryIds[entry.id];
  selectedDate = entry.date; cursor = startOfMonth(fromYmd(entry.date));
  saveState(); renderAll(); scheduleDriveAutoSync();
}
function tombstoneEntryIds(ids) {
  state.deletedEntryIds = { ...(state.deletedEntryIds || {}) };
  const now = new Date().toISOString();
  ids.forEach((id) => { if (id) state.deletedEntryIds[id] = now; });
}
function upsertEntries(entries) {
  const ids = new Set(entries.map((entry) => entry.id));
  const oldIds = editingId ? editingGroupIds() : new Set();
  tombstoneEntryIds([...oldIds].filter((id) => !ids.has(id)));
  state.entries = state.entries.filter((item) => !ids.has(item.id) && !oldIds.has(item.id));
  state.entries.push(...entries);
  state.deletedEntryIds = { ...(state.deletedEntryIds || {}) };
  ids.forEach((id) => delete state.deletedEntryIds[id]);
  selectedDate = entries[0].date;
  cursor = startOfMonth(fromYmd(entries[0].date));
  saveState(); renderAll(); scheduleDriveAutoSync();
}
function saveGoogleSettings({ feedback = true, render = true, touch = true } = {}) {
  state.settings.googleClientId = document.getElementById('google-client-id')?.value.trim() || '';
  state.settings.googleCalendarId = document.getElementById('google-calendar-id')?.value.trim() || 'primary';
  state.settings.googleStoreMode = document.getElementById('google-store-mode')?.value || 'local';
  if (touch) markSettingsSections('google');
  saveState();
  if (render) renderAll();
  if (feedback) setSyncLog('Google設定を保存しました');
}
function setSyncLog(message) { const log = document.getElementById('sync-log'); if (log) log.textContent = message; }
function scheduleDriveAutoSync() {
  window.clearTimeout(driveSyncTimer);
  driveSyncTimer = null;
  if (state.settings.googleClientId) setSyncLog('端末内に保存しました。別端末で使う時は「この端末から送る」を押してください');
}
function localModifiedAt(targetState = state) {
  const dates = [
    targetState.settings?.updatedAt,
    ...(targetState.entries || []).flatMap((entry) => [entry.updatedAt, entry.createdAt]),
    ...(targetState.receipts || []).flatMap((receipt) => [receipt.updatedAt, receipt.importedAt]),
  ].filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : new Date(0).toISOString();
}
function syncPayload() {
  return { app: 'NINQ', version: 2, syncedAt: new Date().toISOString(), modifiedAt: localModifiedAt(), state: normalizeState(state) };
}
function remotePayloadModifiedAt(payload) {
  if (payload?.modifiedAt) return payload.modifiedAt;
  return localModifiedAt(normalizeState(payload?.state || payload || {}));
}
function rememberDriveSync(payload = syncPayload()) {
  saveSyncMeta({
    lastCloudModifiedAt: remotePayloadModifiedAt(payload),
    lastLocalModifiedAt: localModifiedAt(),
    lastSyncedAt: new Date().toISOString(),
  });
}
function hasLocalChangesSinceSync() {
  return isAfterDate(localModifiedAt(), loadSyncMeta().lastLocalModifiedAt);
}
function loadGoogleIdentity() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-identity]');
    if (existing) { existing.addEventListener('load', resolve, { once: true }); existing.addEventListener('error', reject, { once: true }); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = resolve;
    script.onerror = () => reject(new Error('Googleログインの読み込みに失敗しました'));
    document.head.appendChild(script);
  });
}
async function getDriveToken(prompt = '') {
  const clientId = document.getElementById('google-client-id')?.value.trim() || state.settings.googleClientId;
  if (!clientId) throw new Error('GoogleクライアントIDを入力して保存してください');
  await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    googleTokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error) { reject(new Error(response.error)); return; }
        googleAccessToken = response.access_token;
        const status = document.getElementById('drive-sync-status'); if (status) status.textContent = 'ログイン済み';
        resolve(googleAccessToken);
      },
    });
    googleTokenClient.requestAccessToken({ prompt });
  });
}
async function driveFetch(url, options = {}, retry = true) {
  const token = googleAccessToken || await getDriveToken(driveAuthPrompt);
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  if (response.status === 401 && retry) {
    googleAccessToken = '';
    await getDriveToken(driveAuthPrompt);
    return driveFetch(url, options, false);
  }
  if (!response.ok) throw new Error(await response.text() || `Google Driveエラー ${response.status}`);
  return response;
}
async function findDriveSyncFile() {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    fields: 'files(id,name,modifiedTime)',
    q: `name='${DRIVE_SYNC_FILE}' and 'appDataFolder' in parents and trashed=false`,
  });
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`);
  const data = await response.json();
  return data.files?.[0] || null;
}
function multipartBody(metadata, content) {
  const boundary = `ninq_${Date.now()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${content}\r\n--${boundary}--`;
  return { boundary, body };
}
async function createDriveSyncFile(content) {
  const { boundary, body } = multipartBody({ name: DRIVE_SYNC_FILE, parents: ['appDataFolder'], mimeType: 'application/json' }, content);
  const response = await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,modifiedTime', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return response.json();
}
async function updateDriveSyncFile(fileId, content) {
  const response = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,modifiedTime`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: content,
  });
  return response.json();
}
async function readDriveSyncFile(fileId) {
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return response.json();
}
async function pushLocalDriveState() {
  const file = await findDriveSyncFile();
  const payload = syncPayload();
  const content = JSON.stringify(payload, null, 2);
  const result = !file ? await createDriveSyncFile(content) : await updateDriveSyncFile(file.id, content);
  rememberDriveSync(payload);
  return result;
}
function newerByDate(a, b, dateKeys) {
  const aTime = Math.max(...dateKeys.map((key) => Date.parse(a?.[key] || '')).filter(Number.isFinite), 0);
  const bTime = Math.max(...dateKeys.map((key) => Date.parse(b?.[key] || '')).filter(Number.isFinite), 0);
  return aTime >= bTime ? a : b;
}
function mergeById(localItems = [], remoteItems = [], dateKeys = ['updatedAt', 'createdAt']) {
  const map = new Map();
  localItems.forEach((item) => map.set(item.id, item));
  remoteItems.forEach((item) => map.set(item.id, map.has(item.id) ? newerByDate(map.get(item.id), item, dateKeys) : item));
  return [...map.values()];
}
function mergeDeletedEntryIds(localDeleted = {}, remoteDeleted = {}) {
  return { ...(remoteDeleted || {}), ...(localDeleted || {}) };
}
function mergeEntriesWithDeletes(localEntries = [], remoteEntries = [], localDeleted = {}, remoteDeleted = {}) {
  const deleted = mergeDeletedEntryIds(localDeleted, remoteDeleted);
  const merged = mergeById(localEntries, remoteEntries);
  return merged.filter((entry) => {
    const deletedAt = Date.parse(deleted[entry.id] || '') || 0;
    const entryAt = Math.max(Date.parse(entry.updatedAt || '') || 0, Date.parse(entry.createdAt || '') || 0);
    return !deletedAt || entryAt > deletedAt;
  });
}
function mergeDriveState(remotePayload) {
  const remoteState = normalizeState(remotePayload.state || remotePayload);
  const deletedEntryIds = mergeDeletedEntryIds(state.deletedEntryIds, remoteState.deletedEntryIds);
  return normalizeState({
    settings: mergeSettingsBySection(state.settings, remoteState.settings),
    entries: mergeEntriesWithDeletes(state.entries, remoteState.entries, state.deletedEntryIds, remoteState.deletedEntryIds),
    receipts: mergeById(state.receipts || [], remoteState.receipts || [], ['updatedAt', 'importedAt']),
    deletedEntryIds,
  });
}
async function loginGoogleDrive() {
  try {
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    await getDriveToken('consent');
    setSyncLog('Googleログインしました。送る/受け取るが使えます');
  } catch (error) {
    setSyncLog(error.message || 'Googleログインに失敗しました');
  }
}
async function sendDeviceToDrive() {
  if (activeScreen === 'st') flushSettingsAutosave();
  window.clearTimeout(driveSyncTimer);
  driveSyncTimer = null;
  if (driveSyncInFlight) { setSyncLog('処理中です。少し待ってからもう一度押してください'); return; }
  driveSyncInFlight = true;
  const previousPrompt = driveAuthPrompt;
  try {
    driveAuthPrompt = 'consent';
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    setSyncLog('この端末のデータをクラウドへ送っています...');
    await getDriveToken(googleAccessToken ? '' : driveAuthPrompt);
    await pushLocalDriveState();
    setSyncLog(`この端末から送りました。予定 ${state.entries.length}件`);
  } catch (error) {
    setSyncLog(error.message || '送信に失敗しました');
  } finally {
    driveAuthPrompt = previousPrompt;
    driveSyncInFlight = false;
  }
}
async function receiveDeviceFromDrive() {
  if (activeScreen === 'st') flushSettingsAutosave();
  window.clearTimeout(driveSyncTimer);
  driveSyncTimer = null;
  if (driveSyncInFlight) { setSyncLog('処理中です。少し待ってからもう一度押してください'); return; }
  if (hasLocalChangesSinceSync() && !confirm('この端末の未送信の変更を、クラウドのデータで置き換えます。受け取りますか？')) return;
  driveSyncInFlight = true;
  const previousPrompt = driveAuthPrompt;
  try {
    driveAuthPrompt = 'consent';
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    setSyncLog('クラウドからデータを受け取っています...');
    await getDriveToken(googleAccessToken ? '' : driveAuthPrompt);
    const file = await findDriveSyncFile();
    if (!file) { setSyncLog('クラウドにNINQデータがまだありません。先に別端末で「この端末から送る」を押してください'); return; }
    const remotePayload = await readDriveSyncFile(file.id);
    state = normalizeState(remotePayload.state || remotePayload);
    saveState();
    rememberDriveSync(remotePayload);
    renderAll();
    setSyncLog(`クラウドから受け取りました。予定 ${state.entries.length}件`);
  } catch (error) {
    setSyncLog(error.message || '受け取りに失敗しました');
  } finally {
    driveAuthPrompt = previousPrompt;
    driveSyncInFlight = false;
  }
}
async function syncGoogleDrive({ auto = false, reason = '' } = {}) {
  if (activeScreen === 'st') flushSettingsAutosave();
  window.clearTimeout(driveSyncTimer);
  driveSyncTimer = null;
  if (driveSyncInFlight) {
    driveSyncQueued = true;
    return;
  }
  driveSyncInFlight = true;
  const previousPrompt = driveAuthPrompt;
  try {
    driveAuthPrompt = auto ? '' : 'consent';
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    setSyncLog(auto && reason === 'save' ? '変更をGoogle Driveへ保存中です...' : (auto ? 'Google Driveから最新データを確認中です...' : 'Google Driveと同期中です...'));
    await getDriveToken(googleAccessToken ? '' : driveAuthPrompt);
    const file = await findDriveSyncFile();
    if (!file) {
      await pushLocalDriveState();
      setSyncLog(auto ? '同期ファイルを作成しました' : 'この端末のデータをGoogle Driveに保存しました');
      return;
    }
    const remotePayload = await readDriveSyncFile(file.id);
    const meta = loadSyncMeta();
    const remoteModifiedAt = remotePayloadModifiedAt(remotePayload);
    const remoteChanged = isAfterDate(remoteModifiedAt, meta.lastCloudModifiedAt);
    const localChanged = hasLocalChangesSinceSync();

    if (auto && reason === 'save') {
      if (remoteChanged) {
        if (localChanged) {
          setSyncLog('別端末の変更があります。勝手に上書きせず止めました。「今すぐ同期」を押してください');
          return;
        }
        state = normalizeState(remotePayload.state || remotePayload);
        saveState();
        rememberDriveSync(remotePayload);
        renderAll();
        setSyncLog('クラウド側が新しかったため取得しました');
        return;
      }
      await pushLocalDriveState();
      setSyncLog(`変更を保存しました。予定 ${state.entries.length}件`);
      return;
    }

    if (auto && remoteChanged && localChanged) {
      setSyncLog('PCとスマホの両方に未同期の変更があります。勝手に上書きせず止めました');
      return;
    }

    if (remoteChanged && !localChanged) {
      state = normalizeState(remotePayload.state || remotePayload);
      saveState();
      rememberDriveSync(remotePayload);
      renderAll();
      setSyncLog(`${auto ? '起動時にクラウドから取得しました。' : 'クラウドから取得しました。'}予定 ${state.entries.length}件`);
      return;
    }

    if (localChanged && !remoteChanged) {
      await pushLocalDriveState();
      setSyncLog(`${auto ? '端末の変更をクラウドへ保存しました。' : 'クラウドへ保存しました。'}予定 ${state.entries.length}件`);
      return;
    }

    if (remoteChanged && localChanged) {
      state = mergeDriveState(remotePayload);
      saveState();
      const payload = syncPayload();
      await updateDriveSyncFile(file.id, JSON.stringify(payload, null, 2));
      rememberDriveSync(payload);
      renderAll();
      setSyncLog(`両方の変更をまとめました。予定 ${state.entries.length}件`);
      return;
    }

    rememberDriveSync(remotePayload);
    setSyncLog(`${auto ? 'クラウドと同じ状態です。' : '同期済みです。'}予定 ${state.entries.length}件`);
  } catch (error) {
    setSyncLog(auto ? '自動同期できませんでした。Googleログインしてください' : (error.message || 'Google Drive同期に失敗しました'));
  } finally {
    driveAuthPrompt = previousPrompt;
    driveSyncInFlight = false;
    if (driveSyncQueued) {
      driveSyncQueued = false;
      scheduleDriveAutoSync({ delay: 800, message: '続けて変更をクラウドへ保存します...' });
    }
  }
}
function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function icsEscape(value) { return String(value || '').replaceAll('\\', '\\\\').replaceAll(';', '\\;').replaceAll(',', '\\,').replace(/\r?\n/g, '\\n'); }
function icsDate(ymd) { return String(ymd || '').replaceAll('-', ''); }
function icsStamp() { return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
function calendarDescription(entry) {
  const calc = calcEntry(entry);
  const lines = [`区分: ${typeLabel(entry.type)} / ${shiftLabel(entry.shift)}`];
  if (entry.workerName) lines.push(`職人名: ${entry.workerName}`);
  if (entry.company) lines.push(`会社名: ${entry.company}`);
  if (entry.site) lines.push(`現場名: ${entry.site}`);
  if (calc.qty) lines.push(`人工: ${calc.qty}`);
  if (entry.notes) lines.push(`メモ: ${entry.notes}`);
  return lines.join('\n');
}
function calendarExportKey(entry) {
  const company = String(entry.company || '').trim();
  const site = String(entry.site || '').trim();
  if (company && site) return [entry.type || 'self', entry.shift || 'day', company, site, entry.workerName || ''].join('\u001f');
  if (entry.rangeGroupId) return `range:${entry.rangeGroupId}`;
  return `single:${entry.id}`;
}
function calendarExportGroups(entries) {
  const byKey = new Map();
  entries.forEach((entry) => {
    const key = calendarExportKey(entry);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(entry);
  });
  const groups = [];
  byKey.forEach((items) => {
    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    let current = null;
    sorted.forEach((entry) => {
      if (!current || adjacentYmd(current.end, 1) !== entry.date) {
        current = { start: entry.date, end: entry.date, entries: [entry] };
        groups.push(current);
        return;
      }
      current.end = entry.date;
      current.entries.push(entry);
    });
  });
  return groups.sort((a, b) => a.start.localeCompare(b.start) || companyEventTitle(a.entries[0]).localeCompare(companyEventTitle(b.entries[0]), 'ja'));
}
function calendarGroupDescription(group) {
  const base = calendarDescription(group.entries[0]);
  return group.entries.length > 1 ? `${base}\n期間: ${group.start}〜${group.end}` : base;
}
function calendarExportTitle(group) {
  const entry = group.entries[0];
  const title = companyEventTitle(entry);
  return entry.shift === 'night' ? `🌙 ${title}` : title;
}
function calendarExportColor(group) {
  return group.entries[0]?.shift === 'night' ? '#5B4BC4' : '#FFD45A';
}
function googleCalendarUrl(entry) {
  const group = calendarExportGroups(state.entries).find((item) => item.entries.some((groupEntry) => groupEntry.id === entry.id)) || { start: entry.date, end: entry.date, entries: [entry] };
  const endDate = fromYmd(group.end); endDate.setDate(endDate.getDate() + 1);
  const params = new URLSearchParams({ action: 'TEMPLATE', text: calendarExportTitle(group), dates: `${icsDate(group.start)}/${icsDate(toYmd(endDate))}`, details: calendarGroupDescription(group) });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
function buildIcs(entries) {
  const stamp = icsStamp();
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//NINQ//Calendar Export//JA', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
  calendarExportGroups(entries).forEach((group) => {
    const endDate = fromYmd(group.end); endDate.setDate(endDate.getDate() + 1);
    const uid = group.entries.length > 1 ? group.entries.map((entry) => entry.id).join('-') : group.entries[0].id;
    lines.push('BEGIN:VEVENT', `UID:${icsEscape(uid)}@ninq`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(group.start)}`, `DTEND;VALUE=DATE:${icsDate(toYmd(endDate))}`, `SUMMARY:${icsEscape(calendarExportTitle(group))}`, `DESCRIPTION:${icsEscape(calendarGroupDescription(group))}`, `COLOR:${calendarExportColor(group)}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR', '');
  return lines.join('\r\n');
}
function calendarRangeValues() {
  const monthStart = toYmd(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  const monthEnd = toYmd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  return {
    start: document.getElementById('google-export-start')?.value || monthStart,
    end: document.getElementById('google-export-end')?.value || monthEnd,
  };
}
function calendarRangeEntries() {
  const { start, end } = calendarRangeValues();
  if (!start || !end || end < start) return [];
  return state.entries.filter((entry) => entry.date >= start && entry.date <= end).sort((a, b) => a.date.localeCompare(b.date));
}
function exportRangeCalendarIcs() {
  const { start, end } = calendarRangeValues();
  if (!start || !end) { setSyncLog('開始日と終了日を選んでください'); return; }
  if (end < start) { setSyncLog('終了日は開始日以降にしてください'); return; }
  const entries = calendarRangeEntries();
  if (!entries.length) { setSyncLog(`${start}〜${end}の予定がありません`); return; }
  const groups = calendarExportGroups(entries);
  downloadText(`${start}_${end}_NINQ.ics`, buildIcs(entries), 'text/calendar;charset=utf-8;');
  setSyncLog(`${start}〜${end}の予定${groups.length}件を出力しました`);
  renderSyncScreen();
}
function openSelectedDayGoogleCalendar() {
  const entries = dayEntries(selectedDate);
  if (!entries.length) { setSyncLog('選択日の予定がありません'); return; }
  window.open(googleCalendarUrl(entries[0]), '_blank');
  setSyncLog(entries.length > 1 ? '選択日の先頭予定をGoogleカレンダーで開きました' : '選択日の予定をGoogleカレンダーで開きました');
}
function exportBackupJson() {
  const payload = { app: 'NINQ', version: 1, exportedAt: new Date().toISOString(), state: normalizeState(state) };
  downloadText(`ninq-backup-${toYmd(new Date())}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8;');
  setSyncLog('バックアップを書き出しました');
}
function importBackupJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      state = normalizeState(payload.state || payload);
      saveState();
      renderAll();
      showSaveFeedback('データを読み込みました');
      setSyncLog('バックアップを読み込みました');
    } catch (error) {
      alert('バックアップを読み込めませんでした');
    }
  };
  reader.readAsText(file, 'utf-8');
}
function guessReceiptDate(name) {
  const text = String(name || '');
  const ymd = text.match(/(20\d{2})[-_.年]?(\d{1,2})[-_.月]?(\d{1,2})/);
  if (ymd) return `${ymd[1]}-${String(Number(ymd[2])).padStart(2, '0')}-${String(Number(ymd[3])).padStart(2, '0')}`;
  const md = text.match(/(?:^|[^\d])(\d{1,2})[-_.月](\d{1,2})(?:日|[^\d]|$)/);
  if (md) return `${cursor.getFullYear()}-${String(Number(md[1])).padStart(2, '0')}-${String(Number(md[2])).padStart(2, '0')}`;
  return '';
}
function guessReceiptAmount(name) {
  const match = String(name || '').match(/(?:¥|円|amount|amt)?\s*(\d{3,6})(?:円|yen)?/i);
  return match ? num(match[1]) : 0;
}
function updateReceiptField(id, patch) {
  const item = (state.receipts || []).find((receipt) => receipt.id === id);
  if (!item) return;
  Object.assign(item, patch, { status: patch.status || item.status });
  saveState();
}
function applyReceiptToEntry(id) {
  const receipt = (state.receipts || []).find((item) => item.id === id);
  if (!receipt) return;
  if (!receipt.date) { alert('領収書の日付を入れてください'); return; }
  if (!num(receipt.amount)) { alert('領収書の金額を入れてください'); return; }
  const entry = dayEntries(receipt.date)[0];
  if (!entry) { alert('同じ日付の予定がありません'); return; }
  const expense = expenseItems().find((item) => item.label === receipt.category) || expenseItems()[0];
  if (!expense) return;
  entry.expenses = { ...(entry.expenses || {}) };
  entry.expenses[expense.id] = num(entry.expenses[expense.id]) + num(receipt.amount);
  entry.updatedAt = new Date().toISOString();
  receipt.status = '予定へ入力済み';
  receipt.appliedEntryId = entry.id;
  saveState();
  renderAll();
  scheduleDriveAutoSync();
  showSaveFeedback('領収書を予定へ入力しました');
}
function handleReceiptFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  state.receipts = [...(state.receipts || []), ...list.map((file) => normalizeReceipt({ fileName: file.name, importedAt: new Date().toISOString(), category: guessReceiptCategory(file.name), date: guessReceiptDate(file.name), amount: guessReceiptAmount(file.name), status: '仕分け候補' }))];
  saveState(); renderReceiptScreen(); scheduleDriveAutoSync({ message: '領収書をクラウドへ保存します...' });
}
function persistSettingsFromForm({ render = false, feedback = '', sections = [] } = {}) {
  const linesToObjects = (text, previous) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((label, index) => ({ id: previous[index]?.id || `exp${index + 1}`, label }));
  const companyRates = companyPresetValues();
  const salesTotalParts = {
    labor: document.getElementById('tgl-sales-labor')?.classList.contains('on') !== false,
    overtime: document.getElementById('tgl-sales-overtime')?.classList.contains('on') !== false,
    expenses: document.getElementById('tgl-sales-expenses')?.classList.contains('on') === true,
  };
  state.settings = { ...state.settings, name: document.getElementById('st-name').value.trim(), postalCode: document.getElementById('st-postal').value.trim(), address: document.getElementById('st-addr').value.trim(), tel: document.getElementById('st-tel').value.trim(), companyName: document.getElementById('st-co').value.trim(), bank: document.getElementById('st-bank').value.trim(), branch: document.getElementById('st-branch').value.trim(), accountNo: document.getElementById('st-accno').value.trim(), accountName: document.getElementById('st-accname').value.trim(), invoiceNo: document.getElementById('st-invno').value.trim(), invoiceEnabled: document.getElementById('tgl-inv').classList.contains('on'), showSubcontract: document.getElementById('tgl-subcontract')?.classList.contains('on') !== false, salesTotalParts, taxRate: num(document.getElementById('st-tax').value || 10), stampImage: state.settings.stampImage || '', defaultDayRate: 0, defaultNightRate: 0, defaultOtRate: 0, companyRates, companies: companyRates.map((item) => item.name), expenseItems: linesToObjects(document.getElementById('st-expenses').value, expenseItems()) };
  markSettingsSections(sections.length ? sections : Object.keys(SETTINGS_SECTIONS).filter((section) => section !== 'google'));
  state.entries = state.entries.map((entry) => { const nextExpenses = {}; expenseItems().forEach((item) => { nextExpenses[item.id] = num(entry.expenses?.[item.id]); }); return { ...entry, expenses: nextExpenses }; });
  saveState();
  if (render) renderAll();
  if (feedback) showSaveFeedback(feedback);
  scheduleDriveAutoSync({ message: '設定をクラウドへ保存します...' });
}
function saveSettings() {
  window.clearTimeout(settingsAutosaveTimer);
  settingsAutosaveTimer = null;
  settingsAutosaveSections.clear();
  persistSettingsFromForm({ render: true, feedback: '設定を保存しました' });
}
function scheduleSettingsAutosave({ immediate = false, section = '', sections = [] } = {}) {
  if (!document.getElementById('sc-st')) return;
  window.clearTimeout(settingsAutosaveTimer);
  [section, ...sections].filter(Boolean).forEach((item) => settingsAutosaveSections.add(item));
  const save = () => {
    const targetSections = [...settingsAutosaveSections];
    settingsAutosaveSections.clear();
    settingsAutosaveTimer = null;
    persistSettingsFromForm({ render: false, feedback: '自動保存しました', sections: targetSections });
  };
  if (immediate) { save(); return; }
  settingsAutosaveTimer = window.setTimeout(save, 900);
}
function flushSettingsAutosave() {
  if (!settingsAutosaveTimer) return;
  window.clearTimeout(settingsAutosaveTimer);
  const targetSections = [...settingsAutosaveSections];
  settingsAutosaveSections.clear();
  settingsAutosaveTimer = null;
  persistSettingsFromForm({ render: false, sections: targetSections });
}
function handleStampFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    state.settings.stampImage = String(reader.result || '');
    markSettingsSections('invoice');
    saveState();
    renderAll();
    scheduleDriveAutoSync({ message: '印鑑設定をクラウドへ保存します...' });
    showSaveFeedback('印鑑を登録しました');
  };
  reader.readAsDataURL(file);
}
function clearStampImage() {
  state.settings.stampImage = '';
  markSettingsSections('invoice');
  saveState();
  renderAll();
  scheduleDriveAutoSync({ message: '印鑑設定をクラウドへ保存します...' });
  showSaveFeedback('印鑑を削除しました');
}
function deleteEntry(id) {
  const target = state.entries.find((entry) => entry.id === id);
  if (!target) return;
  state.entries = state.entries.filter((entry) => entry.id !== id);
  tombstoneEntryIds([id]);
  if (target.rangeGroupId) {
    const groupItems = state.entries.filter((entry) => entry.rangeGroupId === target.rangeGroupId);
    const nextExcluded = [...new Set([
      ...(target.excludedDates || []),
      target.date,
      ...groupItems.flatMap((entry) => entry.excludedDates || []),
    ])].sort();
    state.entries = state.entries.map((entry) => (
      entry.rangeGroupId === target.rangeGroupId
        ? { ...entry, excludedDates: nextExcluded, updatedAt: new Date().toISOString() }
        : entry
    ));
  }
  saveState(); renderAll(); scheduleDriveAutoSync();
}
function gcalEntry(id) {
  const entry = state.entries.find((item) => item.id === id); if (!entry) return;
  window.open(googleCalendarUrl(entry), '_blank');
}
function csvCell(value) { const text = String(value ?? ''); return `"${text.replaceAll('"', '""')}"`; }
function downloadCsv(filename, rows) { const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`; const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function exportDemenCsv() {
  const rows = [['日付', '会社名', '現場名', '区分', '人工', '単価', '人工計', '残業h', '残業計', ...expenseItems().map((item) => item.label), '合計']];
  monthEntries().filter((entry) => entry.type === 'self' && entry.company === selectedCompany).forEach((entry) => {
    const calc = calcEntry(entry);
    rows.push([entry.date, entry.company, entry.site, shiftLabel(entry.shift), calc.qty, calc.unitRate, calc.labor, calc.otHours, calc.overtime, ...expenseItems().map((item) => num(entry.expenses?.[item.id])), calc.subtotal]);
  });
  downloadCsv(`${monthKey(cursor)}_${selectedCompany}_出面表.csv`, rows);
}
function exportSubPaymentsCsv() {
  const rows = [['日付', '職人名', '会社名', '現場名', '勤務', '人工', '単価', '売上計算', '支払金額', '差額', 'メモ']];
  monthEntries().filter((entry) => entry.type === 'sub').forEach((entry) => {
    const calc = calcEntry(entry);
    rows.push([entry.date, entry.workerName || '', entry.company, entry.site, shiftLabel(entry.shift), calc.qty, calc.unitRate, calc.subtotal, calc.subcontractPay, calc.subcontractDiff, entry.notes || '']);
  });
  downloadCsv(`${monthKey(cursor)}_外注支払い.csv`, rows);
}
function exportInvoiceCsv() {
  const totals = invoiceTotals(entriesForInvoiceCompany());
  downloadCsv(`${monthKey(cursor)}_${selectedCompany}_請求書.csv`, [['請求先', companyOfficialName(selectedCompany)], ['対象月', fmtMonth(cursor)], ['売上（税別）', totals.subtotal], ['消費税', totals.tax], ['諸経費', totals.expenseTotal], ['合計', totals.total]]);
}
function printView(kind) {
  const screen = document.getElementById('sc-inv'); screen.classList.add('print-active');
  if (kind === 'invoice') document.getElementById('print-demen-wrap')?.classList.add('hidden'); else document.getElementById('print-invoice-box')?.classList.add('hidden');
  window.print();
  document.getElementById('print-demen-wrap')?.classList.remove('hidden'); document.getElementById('print-invoice-box')?.classList.remove('hidden'); screen.classList.remove('print-active');
}
function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { if (activeScreen === 'st') flushSettingsAutosave(); activeScreen = button.dataset.screen; renderAll(); }));
  const salesToggle = document.getElementById('toggle-sales-btn');
  if (salesToggle) salesToggle.addEventListener('click', () => { state.settings.showSales = !state.settings.showSales; markSettingsSections('display'); saveState(); renderAll(); scheduleDriveAutoSync({ message: '表示設定をクラウドへ保存します...' }); });
  ['prev-month-btn', 'sub-prev-month-btn', 'inv-prev-month-btn'].forEach((id) => document.getElementById(id).addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); if (monthKey(selectedDate) !== monthKey(cursor)) selectedDate = toYmd(cursor); renderAll(); }));
  ['next-month-btn', 'sub-next-month-btn', 'inv-next-month-btn'].forEach((id) => document.getElementById(id).addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); if (monthKey(selectedDate) !== monthKey(cursor)) selectedDate = toYmd(cursor); renderAll(); }));
  document.getElementById('fab-main').addEventListener('click', () => { closeDayModal(); openModal('self'); });
  document.getElementById('fab-sub').addEventListener('click', () => { if (!subcontractEnabled()) return; closeDayModal(); openModal('sub'); });
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('add-company-btn')?.addEventListener('click', addCompanyPreset);
  document.getElementById('add-expense-btn')?.addEventListener('click', () => addSettingListItem('st-expenses', 'st-expense-new'));
  ['st-company-new', 'st-company-day-new', 'st-company-night-new', 'st-company-ot-new'].forEach((id) => document.getElementById(id)?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addCompanyPreset(); } }));
  document.getElementById('st-expense-new')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addSettingListItem('st-expenses', 'st-expense-new'); } });
  document.getElementById('save-google-settings-btn')?.addEventListener('click', saveGoogleSettings);
  document.getElementById('google-login-btn')?.addEventListener('click', loginGoogleDrive);
  document.getElementById('drive-send-device-btn')?.addEventListener('click', sendDeviceToDrive);
  document.getElementById('drive-receive-device-btn')?.addEventListener('click', receiveDeviceFromDrive);
  document.getElementById('google-export-range-btn')?.addEventListener('click', exportRangeCalendarIcs);
  document.getElementById('google-open-selected-day-btn')?.addEventListener('click', openSelectedDayGoogleCalendar);
  document.getElementById('backup-export-btn')?.addEventListener('click', exportBackupJson);
  document.getElementById('backup-import-btn')?.addEventListener('click', () => document.getElementById('backup-file')?.click());
  document.getElementById('backup-file')?.addEventListener('change', (event) => { importBackupJson(event.target.files?.[0]); event.target.value = ''; });
  document.getElementById('receipt-pick-btn')?.addEventListener('click', () => document.getElementById('receipt-file')?.click());
  document.getElementById('receipt-file')?.addEventListener('change', (event) => { handleReceiptFiles(event.target.files); event.target.value = ''; });
  document.getElementById('stamp-pick-btn')?.addEventListener('click', () => document.getElementById('st-stamp-file')?.click());
  document.getElementById('st-stamp-file')?.addEventListener('change', (event) => { handleStampFile(event.target.files?.[0]); event.target.value = ''; });
  document.getElementById('stamp-clear-btn')?.addEventListener('click', clearStampImage);
  document.getElementById('tgl-inv').addEventListener('click', () => { document.getElementById('tgl-inv').classList.toggle('on'); document.getElementById('inv-no-row').classList.toggle('hidden', !document.getElementById('tgl-inv').classList.contains('on')); scheduleSettingsAutosave({ immediate: true, section: 'invoice' }); });
  document.getElementById('tgl-subcontract')?.addEventListener('click', () => { document.getElementById('tgl-subcontract').classList.toggle('on'); scheduleSettingsAutosave({ immediate: true, section: 'display' }); });
  ['tgl-sales-labor', 'tgl-sales-overtime', 'tgl-sales-expenses'].forEach((id) => document.getElementById(id)?.addEventListener('click', () => { document.getElementById(id).classList.toggle('on'); scheduleSettingsAutosave({ immediate: true, section: 'display' }); }));
  document.getElementById('modal-bg').addEventListener('click', (event) => { if (event.target.id === 'modal-bg') closeModal(); });
  document.addEventListener('click', (event) => {
    if (event.target.id === 'date-picker-bg' || event.target.matches('[data-date-picker-cancel]')) { closeDatePicker(); return; }
    if (event.target.matches('[data-date-picker-ok]')) { commitDatePicker(); return; }
    if (event.target.matches('[data-date-picker-prev]')) { datePickerCursor = new Date(datePickerCursor.getFullYear(), datePickerCursor.getMonth() - 1, 1); renderDatePicker(); return; }
    if (event.target.matches('[data-date-picker-next]')) { datePickerCursor = new Date(datePickerCursor.getFullYear(), datePickerCursor.getMonth() + 1, 1); renderDatePicker(); return; }
    const datePick = event.target.closest('[data-date-pick]');
    if (datePick) { datePickerValue = datePick.dataset.datePick; datePickerCursor = startOfMonth(fromYmd(datePickerValue)); renderDatePicker(); return; }
    const datePickerInput = event.target.closest('[data-date-picker]');
    if (datePickerInput) { openDatePicker(datePickerInput); return; }
    const removeCompanyPreset = event.target.closest('[data-remove-company-preset]');
    if (removeCompanyPreset) { const values = companyPresetValues().filter((_, index) => index !== Number(removeCompanyPreset.dataset.removeCompanyPreset)); writeCompanyPresetValues(values); renderCompanyPresetList(); scheduleSettingsAutosave({ immediate: true, section: 'companies' }); return; }
    const removeSettingItem = event.target.closest('[data-remove-setting-item]');
    if (removeSettingItem) { const hiddenId = removeSettingItem.dataset.removeSettingItem; const index = Number(removeSettingItem.dataset.removeIndex); const values = settingListValues(hiddenId).filter((_, itemIndex) => itemIndex !== index); writeSettingList(hiddenId, values); renderSettingListEditors(); scheduleSettingsAutosave({ immediate: true, section: 'expenses' }); return; }
    const closeDayButton = event.target.closest('[data-close-day-modal]');
    if (closeDayButton || event.target.id === 'day-modal-bg') { closeDayModal(); return; }
    const menuButton = event.target.closest('#menu-toggle-btn,[data-menu-open]');
    if (menuButton) {
      const menu = menuButton.closest('.topbar').querySelector('.top-menu');
      menu.classList.toggle('hidden');
      return;
    }
    const screenLink = event.target.closest('[data-screen-link]');
    if (screenLink) { if (activeScreen === 'st') flushSettingsAutosave(); activeScreen = screenLink.dataset.screenLink; if (activeScreen !== 'cal') closeDayModal(); renderAll(); return; }
    const otherSales = event.target.closest('[data-sales-toggle]');
    if (otherSales) { state.settings.showSales = !state.settings.showSales; markSettingsSections('display'); saveState(); renderAll(); scheduleDriveAutoSync({ message: '表示設定をクラウドへ保存します...' }); return; }
    const dayButton = event.target.closest('.cal-day');
    if (dayButton) { openDayModal(dayButton.dataset.date); return; }
    const addDate = event.target.closest('[data-add-date]');
    if (addDate) { selectedDate = addDate.dataset.addDate; closeDayModal(); openModal('self'); return; }
    const editButton = event.target.closest('[data-edit-entry]'); if (editButton) { closeDayModal(); openModal('self', editButton.dataset.editEntry); return; }
    const delButton = event.target.closest('[data-del-entry]'); if (delButton) { if (confirm('この予定を削除しますか？')) deleteEntry(delButton.dataset.delEntry); return; }
    const companySelect = event.target.closest('#f-company-select');
    if (companySelect) { const input = document.getElementById('f-company'); if (input && companySelect.value) { input.value = companySelect.value; applyCompanyRate(companySelect.value); updateSubcontractDiff(); } return; }
    const applyReceipt = event.target.closest('[data-apply-receipt]');
    if (applyReceipt) { applyReceiptToEntry(applyReceipt.dataset.applyReceipt); return; }
    const delReceipt = event.target.closest('[data-del-receipt]');
    if (delReceipt) { state.receipts = (state.receipts || []).filter((receipt) => receipt.id !== delReceipt.dataset.delReceipt); saveState(); renderAll(); scheduleDriveAutoSync({ message: '領収書をクラウドへ保存します...' }); return; }
    const companyChip = event.target.closest('[data-company]'); if (companyChip) { selectedCompany = companyChip.dataset.company; renderInvoiceScreen(); return; }
    if (event.target.matches('#cancel-entry-btn')) { closeModal(); return; }
    if (event.target.matches('[data-export-demen]')) exportDemenCsv();
    if (event.target.matches('[data-export-invoice]')) exportInvoiceCsv();
    if (event.target.matches('[data-export-sub-payments]')) exportSubPaymentsCsv();
    if (event.target.matches('[data-print-demen]')) printView('demen');
    if (event.target.matches('[data-print-invoice]')) printView('invoice');
    if (event.target.matches('[data-entry-type]')) {
      if (event.target.dataset.entryType === 'sub' && !subcontractEnabled()) return;
      document.querySelectorAll('[data-entry-type]').forEach((button) => button.classList.remove('active')); event.target.classList.add('active');
      document.getElementById('worker-wrap').classList.toggle('hidden', event.target.dataset.entryType !== 'sub');
      updateSubcontractDiff();
      return;
    }
    if (!event.target.closest('.top-menu') && !event.target.closest('.ghost-icon-btn')) {
      document.querySelectorAll('.top-menu').forEach((menu) => menu.classList.add('hidden'));
    }
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'f-date' || event.target.id === 'f-end-date') { renderRangeExclusions(); return; }
    if (event.target.id === 'google-export-start' || event.target.id === 'google-export-end') { renderSyncScreen(); return; }
    if (event.target.matches('#st-tax')) { scheduleSettingsAutosave({ immediate: true, section: 'invoice' }); return; }
    if (event.target.matches('[data-range-exclude]')) { event.target.closest('.range-exclude-chip')?.classList.toggle('checked', event.target.checked); return; }
    if (event.target.id === 'f-company-select') { const input = document.getElementById('f-company'); if (input && event.target.value) { input.value = event.target.value; applyCompanyRate(event.target.value); updateSubcontractDiff(); } return; }
    if (event.target.matches('[data-receipt-category]')) { updateReceiptField(event.target.dataset.receiptCategory, { category: event.target.value, status: '確認済み' }); renderAll(); return; }
    if (event.target.matches('[data-receipt-date]')) { updateReceiptField(event.target.dataset.receiptDate, { date: event.target.value, status: '確認済み' }); return; }
    if (event.target.matches('[data-receipt-amount]')) { updateReceiptField(event.target.dataset.receiptAmount, { amount: num(event.target.value), status: '確認済み' }); return; }
    if (event.target.id === 'f-company') {
      const select = document.getElementById('f-company-select'); if (select) select.value = companyOptions().includes(event.target.value.trim()) ? event.target.value.trim() : '';
    }
    if (event.target.id === 'f-shift') { applyCompanyRate(document.getElementById('f-company')?.value.trim()); updateSubcontractDiff(); }
  });

  document.addEventListener('input', (event) => {
    if (event.target.matches('#st-name,#st-postal,#st-addr,#st-tel,#st-co')) scheduleSettingsAutosave({ section: 'profile' });
    if (event.target.matches('#st-bank,#st-branch,#st-accno,#st-accname')) scheduleSettingsAutosave({ section: 'bank' });
    if (event.target.matches('#st-invno')) scheduleSettingsAutosave({ section: 'invoice' });
    if (event.target.matches('[data-company-preset-field]')) updateCompanyPresetField(event.target.dataset.companyPresetId, event.target.dataset.companyPresetField, event.target.value);
    if (event.target.matches('#entry-form input, #entry-form textarea, #entry-form select')) updateSubcontractDiff();
  });
  window.addEventListener('beforeunload', flushSettingsAutosave);

  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'entry-form') return;
    event.preventDefault();
    try { const entries = collectEntryForm(); upsertEntries(entries); closeModal(); } catch (error) { alert(error.message || '保存に失敗しました'); }
  });
}

function registerPwa() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('sw failed', error)); }
function init() { bindEvents(); renderAll(); registerPwa(); }
document.addEventListener('DOMContentLoaded', init);
