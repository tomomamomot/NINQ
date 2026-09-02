
const STORE_KEY = 'ninq-v2';
const SYNC_META_KEY = 'ninq-sync-meta-v1';
const SYNC_PENDING_KEY = 'ninq-sync-pending-v1';
const LEGACY_STORE_KEYS = [['s', 'hokunin3'].join(''), ['g', 'enba-box-v2'].join('')];
const DRIVE_SYNC_FILE = 'ninq-sync.json';
const GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const APP_VERSION = 'v2026.09.03-1';
const FIREBASE_POLL_INTERVAL_MS = 45000;
const RECEIPT_REMOVAL_AT = '2026-07-18T00:00:00.000Z';
const DEFAULT_EXPENSE_ITEMS = ['交通費', '駐車場代', '宿泊費', 'ガソリン代', '資材代', 'その他'];
const DAY_MODAL_OVERTIME_ID = 'overtime';
const DEFAULT_DAY_MODAL_ITEMS = ['exp1', 'exp2', 'exp4', 'exp5', DAY_MODAL_OVERTIME_ID];
const DEFAULT_SETTINGS = {
  name: '', postalCode: '', address: '', tel: '', companyName: '', bank: '', branch: '', accountNo: '', accountName: '',
  invoiceNo: '', invoiceEnabled: true, taxRate: 10, stampImage: '', invoiceFontSize: '1',
  defaultDayRate: 0, defaultNightRate: 0, defaultOtRate: 0,
  companies: [], companyRates: [], deletedCompanyPresetIds: {}, expenseItems: DEFAULT_EXPENSE_ITEMS.map((label, index) => ({ id: `exp${index + 1}`, label })), dayModalItems: DEFAULT_DAY_MODAL_ITEMS,
  companyInvoiceModes: {}, showSales: true, showSubcontract: true, uiSize: '1', fontChoice: 'system', googleClientId: '', googleCalendarId: 'primary', googleStoreMode: 'local', googleAccountEmail: '', googleSyncEnabled: false, googleConflictMode: 'newer',
  salesTotalParts: { labor: true, overtime: true, expenses: false }, settingUpdatedAt: {},
};
const DEFAULT_STATE = { entries: [], receipts: [], deletedEntryIds: {}, deletedReceiptIds: {}, settings: DEFAULT_SETTINGS };
const SETTINGS_SECTIONS = {
  profile: ['name', 'postalCode', 'address', 'tel', 'companyName'],
  bank: ['bank', 'branch', 'accountNo', 'accountName'],
  invoice: ['invoiceNo', 'invoiceEnabled', 'taxRate', 'stampImage', 'companyInvoiceModes', 'invoiceFontSize'],
  companies: ['companies', 'companyRates', 'deletedCompanyPresetIds'],
  expenses: ['expenseItems', 'dayModalItems'],
  display: ['showSales', 'showSubcontract', 'salesTotalParts', 'uiSize', 'fontChoice'],
  google: ['googleClientId', 'googleCalendarId', 'googleStoreMode', 'googleAccountEmail', 'googleSyncEnabled', 'googleConflictMode'],
};

let state = loadState();
let cursor = startOfMonth(new Date());
let selectedDate = toYmd(new Date());
let selectedCompany = '';
let invoiceViewMode = 'monthly';
let expandedAnnualMonth = '';
const ALL_COMPANIES_KEY = '__all__';
let activeScreen = 'cal';
let editingId = null;
let isDayModalOpen = false;
let activeDatePickerInput = null;
let datePickerValue = selectedDate;
let datePickerCursor = startOfMonth(new Date());
const googleTokenClients = new Map();
const googleAccessTokens = new Map();
let settingsAutosaveTimer = null;
let settingsAutosaveSections = new Set();
let driveAuthPrompt = '';
let driveSyncTimer = null;
let driveSyncInFlight = false;
let driveSyncQueued = false;
let firebaseUser = null;
let firebaseSyncInFlight = false;
let firebaseSyncQueued = false;
let firebaseSyncTimer = null;
let firebaseInitStarted = false;
let firebasePollTimer = null;
let firebasePollingStarted = false;
let isSheetPageOpen = false;
let sheetPinchStart = null;
let sheetDragStart = null;
let sheetZoom = 1;
let sheetSelection = null;
let sheetMouseSelecting = false;
let printCleanupTimer = null;
let openCompanyPresetId = '';
let expenseQuickEditTarget = null;
let expenseQuickViewportBound = false;

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const normalized = normalizeState(JSON.parse(raw));
      localStorage.setItem(STORE_KEY, JSON.stringify(normalized));
      return normalized;
    }
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
function fontSizeLevel(value) {
  const legacy = { normal: '1', large: '2', xlarge: '3' };
  const next = legacy[value] || String(value || '1');
  return ['1', '2', '3', '4', '5', '6'].includes(next) ? next : '1';
}
function fontSizeOptions(selected) {
  const current = fontSizeLevel(selected);
  return ['1', '2', '3', '4', '5', '6'].map((level) => `<option value="${level}" ${level === current ? 'selected' : ''}>${level}</option>`).join('');
}
function normalizeState(source) {
  const settings = { ...clone(DEFAULT_SETTINGS), ...(source.settings || {}) };
  settings.companies = Array.isArray(settings.companies) ? settings.companies.filter(Boolean) : [];
  settings.companyRates = normalizeCompanyRates(settings.companyRates, settings.companies);
  settings.companies = settings.companyRates.map((item) => item.name);
  settings.expenseItems = normalizeExpenseItems(settings.expenseItems);
  settings.dayModalItems = normalizeDayModalItems(settings.dayModalItems, settings.expenseItems);
  settings.companyInvoiceModes = settings.companyInvoiceModes && typeof settings.companyInvoiceModes === 'object' ? settings.companyInvoiceModes : {};
  settings.deletedCompanyPresetIds = settings.deletedCompanyPresetIds && typeof settings.deletedCompanyPresetIds === 'object' ? settings.deletedCompanyPresetIds : {};
  settings.salesTotalParts = { ...DEFAULT_SETTINGS.salesTotalParts, ...(settings.salesTotalParts || {}) };
  settings.uiSize = fontSizeLevel(settings.uiSize);
  if (!['system', 'thin', 'meiryo', 'gothic', 'rounded'].includes(settings.fontChoice)) settings.fontChoice = DEFAULT_SETTINGS.fontChoice;
  settings.invoiceFontSize = fontSizeLevel(settings.invoiceFontSize);
  if (!['newer', 'confirm'].includes(settings.googleConflictMode)) settings.googleConflictMode = DEFAULT_SETTINGS.googleConflictMode;
  settings.settingUpdatedAt = settings.settingUpdatedAt && typeof settings.settingUpdatedAt === 'object' ? settings.settingUpdatedAt : {};
  const entries = Array.isArray(source.entries) ? source.entries.map((item) => {
    const entry = normalizeEntry(item);
    entry.company = companyCanonicalNameFromPresets(entry.company, settings.companyRates);
    return entry;
  }) : [];
  const deletedEntryIds = source.deletedEntryIds && typeof source.deletedEntryIds === 'object' ? source.deletedEntryIds : {};
  const deletedReceiptIds = { ...(source.deletedReceiptIds && typeof source.deletedReceiptIds === 'object' ? source.deletedReceiptIds : {}) };
  (Array.isArray(source.receipts) ? source.receipts : []).forEach((receipt) => {
    const id = String(receipt?.id || '').trim();
    if (!id) return;
    const removedAt = new Date(Math.max(Date.now(), dateTime(RECEIPT_REMOVAL_AT), dateTime(receipt?.updatedAt) + 1, dateTime(receipt?.importedAt) + 1)).toISOString();
    if (dateTime(deletedReceiptIds[id]) < dateTime(removedAt)) deletedReceiptIds[id] = removedAt;
  });
  return { entries, receipts: [], deletedEntryIds, deletedReceiptIds, settings };
}
function normalizeExpenseItems(items) {
  const list = Array.isArray(items) ? items : [];
  const mapped = list.map((item, index) => typeof item === 'string' ? { id: `exp${index + 1}`, label: item } : { id: item.id || `exp${index + 1}`, label: item.label || `項目${index + 1}` }).filter((item) => item.label.trim());
  return mapped.length ? mapped : clone(DEFAULT_SETTINGS.expenseItems);
}
function normalizeDayModalItems(items, availableExpenses = DEFAULT_SETTINGS.expenseItems) {
  const available = new Set([...normalizeExpenseItems(availableExpenses).map((item) => item.id), DAY_MODAL_OVERTIME_ID]);
  const source = Array.isArray(items) ? items : DEFAULT_DAY_MODAL_ITEMS;
  return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))].filter((id) => available.has(id));
}
function closingDayValue(value) {
  const day = Math.trunc(num(value));
  return day >= 1 && day <= 31 ? day : 0;
}
function closingDayLabel(value) { return closingDayValue(value) ? `${closingDayValue(value)}日締め` : '月末締め'; }
function closingDayOptions(selected = 0) {
  const current = closingDayValue(selected);
  return [`<option value="0" ${current === 0 ? 'selected' : ''}>月末締め</option>`, ...Array.from({ length: 31 }, (_, index) => {
    const day = index + 1;
    return `<option value="${day}" ${current === day ? 'selected' : ''}>${day}日締め</option>`;
  })].join('');
}
function companySheetNameFromOfficial(name) {
  const value = String(name || '').trim();
  const stripped = value
    .replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|宗教法人|NPO法人|特定非営利活動法人)\s*/u, '')
    .replace(/\s*(株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|公益社団法人|公益財団法人|医療法人|学校法人|社会福祉法人|宗教法人|NPO法人|特定非営利活動法人)$/u, '')
    .replace(/^(㈱|㈲|\(株\)|（株）|\(有\)|（有）)\s*/u, '')
    .replace(/\s*(㈱|㈲|\(株\)|（株）|\(有\)|（有）)$/u, '')
    .trim();
  return stripped || value;
}
function normalizeInvoiceHonorific(value) {
  return String(value || '').trim() === '様' ? '様' : '御中';
}
function normalizeCompanyRates(items, companies = []) {
  const source = Array.isArray(items) ? items : [];
  const mapped = source.map((item) => {
    if (typeof item === 'string') return { id: crypto.randomUUID(), name: item, sheetName: companySheetNameFromOfficial(item), officialName: item, invoiceHonorific: '御中', dayRate: 0, nightRate: 0, otRate: 0, closingDay: 0, updatedAt: '' };
    const name = String(item.name || item.company || '').trim();
    const officialName = String(item.officialName || item.formalName || name).trim();
    const sheetName = String(item.sheetName || item.displayName || companySheetNameFromOfficial(officialName || name)).trim();
    return { id: String(item.id || crypto.randomUUID()), name, sheetName: sheetName || name, officialName, invoiceHonorific: normalizeInvoiceHonorific(item.invoiceHonorific || item.honorific), dayRate: num(item.dayRate), nightRate: num(item.nightRate), otRate: num(item.otRate), closingDay: closingDayValue(item.closingDay), updatedAt: item.updatedAt || '' };
  }).filter((item) => item.name);
  const deduped = [];
  mapped.forEach((item) => {
    const existing = deduped.find((saved) => saved.id === item.id || saved.name === item.name);
    if (existing) {
      existing.officialName = item.officialName || existing.officialName || item.name;
      existing.sheetName = item.sheetName || existing.sheetName || companySheetNameFromOfficial(existing.officialName || item.name);
      existing.invoiceHonorific = item.invoiceHonorific || existing.invoiceHonorific || '御中';
      existing.dayRate = item.dayRate;
      existing.nightRate = item.nightRate;
      existing.otRate = item.otRate;
      existing.closingDay = closingDayValue(item.closingDay);
      existing.updatedAt = newerByDate(existing, item, ['updatedAt']).updatedAt || existing.updatedAt || item.updatedAt || '';
    } else {
      deduped.push(item);
    }
  });
  companies.filter(Boolean).forEach((name) => { if (!deduped.some((item) => item.name === name)) deduped.push({ id: crypto.randomUUID(), name, sheetName: companySheetNameFromOfficial(name), officialName: name, invoiceHonorific: '御中', dayRate: 0, nightRate: 0, otRate: 0, closingDay: 0, updatedAt: '' }); });
  return deduped;
}
function normalizeEntry(entry) {
  const paymentAmountSet = entry.paymentAmountSet !== undefined
    ? !!entry.paymentAmountSet
    : num(entry.paymentAmount) > 0;
  return {
    id: String(entry.id || crypto.randomUUID()), date: entry.date || toYmd(new Date()), type: entry.type || 'self', shift: entry.shift || 'day',
    company: entry.company || '', site: entry.site || '', workerName: entry.workerName || '', qty: qtyValue(entry.qty),
    billingType: entry.billingType === 'contract' ? 'contract' : 'labor', contractAmount: num(entry.contractAmount || 0),
    unitRate: num(entry.unitRate || 0), paymentAmount: num(entry.paymentAmount || 0), paymentAmountSet, otHours: num(entry.otHours || 0), otRate: num(entry.otRate || 0),
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
    companyRates: [...new Set((oldData.entries || []).map((entry) => entry.co).filter(Boolean))].map((name) => ({ id: crypto.randomUUID(), name, officialName: name, dayRate: num(oldSettings.tanka || 0), nightRate: num(oldSettings.ntanka || 0), otRate: num(oldSettings.ottanka || 0), closingDay: 0 })),
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
function saveState(nextState = state) {
  localStorage.setItem(STORE_KEY, JSON.stringify(normalizeState(nextState)));
}
function loadSyncMeta() {
  try {
    return { lastCloudModifiedAt: '', lastLocalModifiedAt: '', lastSyncedAt: '', ...(JSON.parse(localStorage.getItem(SYNC_META_KEY) || '{}')) };
  } catch (error) {
    return { lastCloudModifiedAt: '', lastLocalModifiedAt: '', lastSyncedAt: '' };
  }
}
function saveSyncMeta(meta) { localStorage.setItem(SYNC_META_KEY, JSON.stringify({ ...loadSyncMeta(), ...meta })); }
function loadSyncPending() {
  try {
    return { pending: false, reason: '', at: '', ...(JSON.parse(localStorage.getItem(SYNC_PENDING_KEY) || '{}')) };
  } catch (error) {
    return { pending: false, reason: '', at: '' };
  }
}
function saveSyncPending(pending, reason = '') {
  localStorage.setItem(SYNC_PENDING_KEY, JSON.stringify({ pending: !!pending, reason, at: pending ? new Date().toISOString() : '' }));
}
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
    entry.type || 'self', entry.shift || 'day', entry.billingType || 'labor', entry.company || '', entry.site || '', entry.workerName || '',
    num(entry.qty), num(entry.unitRate), num(entry.contractAmount), num(entry.paymentAmount), num(entry.otHours), num(entry.otRate), entry.notes || '', sortedExpenseText(entry.expenses)
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
function coreExpenseItems() {
  const aliases = [
    { id: 'exp1', label: '交通費', match: /交通/ },
    { id: 'exp2', label: '駐車場代', match: /駐車|parking/i },
    { id: 'exp4', label: 'ガソリン代', match: /ガソリン|燃料|gas|fuel/i },
    { id: 'exp5', label: '資材代', match: /資材|材料|工具|建材|金物|tool/i },
  ];
  const items = expenseItems();
  return aliases.map((alias) => {
    const found = items.find((item) => alias.match.test(item.label || ''));
    return found || { id: alias.id, label: alias.label };
  });
}
function modalExpenseItems() {
  const map = new Map();
  coreExpenseItems().forEach((item) => map.set(item.id, item));
  expenseItems().forEach((item) => map.set(item.id, item));
  return [...map.values()];
}
function dayModalDisplayOptions() {
  return [...expenseItems().map((item) => ({ ...item, kind: 'expense' })), { id: DAY_MODAL_OVERTIME_ID, label: '残業', kind: 'overtime' }];
}
function dayModalDisplayItems() {
  const selected = new Set(normalizeDayModalItems(state.settings.dayModalItems, expenseItems()));
  return dayModalDisplayOptions().filter((item) => selected.has(item.id));
}
function renderEntryExpenseChips(entry) {
  const chips = dayModalDisplayItems().filter((item) => item.kind !== 'overtime' || entry.billingType !== 'contract');
  if (!chips.length) return '';
  return `<div class="day-mini-expenses">${chips.map((item) => {
    const value = item.kind === 'overtime' ? `${num(entry.otHours)}h` : yen(num(entry.expenses?.[item.id]));
    return `<button class="day-mini-expense-chip" type="button" data-expense-entry-id="${escapeHtml(entry.id)}" data-expense-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(value)}</strong></button>`;
  }).join('')}</div>`;
}
function applyDisplayPreferences() {
  cleanupLegacyDisplayPreferences();
  document.body.dataset.uiSize = state.settings.uiSize || DEFAULT_SETTINGS.uiSize;
  document.body.dataset.font = state.settings.fontChoice || DEFAULT_SETTINGS.fontChoice;
}
function cleanupLegacyDisplayPreferences() {
  document.getElementById('ninq-ui-preferences-style')?.remove();
  document.getElementById('ninq-ui-preferences-section')?.remove();
  try {
    localStorage.removeItem('ninq-ui-prefs');
    localStorage.removeItem(['g', 'enba-box-ui-prefs'].join(''));
  } catch (error) {}
}
function companyOptions() { return companyPresets().map((item) => item.name).sort((a, b) => a.localeCompare(b, 'ja')); }
function companyOptionPresets() { return companyPresets().sort((a, b) => String(a.sheetName || a.name).localeCompare(String(b.sheetName || b.name), 'ja')); }
function companyPresets() { return normalizeCompanyRates(state.settings.companyRates, state.settings.companies); }
function companyPresetByName(name) { return companyPresets().find((item) => item.name === name); }
function companyOfficialName(name) { return (companyPresetByName(name) || companyPresetByAnyName(name))?.officialName || name; }
function companyInvoiceHonorific(name) { return normalizeInvoiceHonorific((companyPresetByName(name) || companyPresetByAnyName(name))?.invoiceHonorific); }
function companySheetName(name) { const preset = companyPresetByName(name) || companyPresetByAnyName(name); return preset?.sheetName || companySheetNameFromOfficial(preset?.officialName || name); }
function companyNameLookupKey(value) {
  return companySheetNameFromOfficial(value).replace(/\s+/gu, '').toLocaleLowerCase('ja');
}
function findCompanyPresetByAnyName(value, presets) {
  const key = companyNameLookupKey(value);
  if (!key) return null;
  const items = presets || [];
  const aliasesFor = (item) => [...new Set([item.name, item.sheetName, item.officialName].map(companyNameLookupKey).filter(Boolean))];
  const exact = items.find((item) => aliasesFor(item).includes(key));
  if (exact) return exact;
  const candidates = items.filter((item) => aliasesFor(item).some((alias) => alias.startsWith(key) || key.startsWith(alias)));
  return candidates.length === 1 ? candidates[0] : null;
}
function companyPresetByAnyName(value) {
  return findCompanyPresetByAnyName(value, companyPresets());
}
function companyCanonicalNameFromPresets(value, presets) {
  const key = String(value || '').trim();
  if (!key) return '';
  const preset = findCompanyPresetByAnyName(key, presets);
  return preset?.name || key;
}
function normalizeCompanyInputName(value) { return companyPresetByAnyName(value)?.name || String(value || '').trim(); }
function companyCalendarName(value) { return companyPresetByAnyName(value)?.name || String(value || '').trim(); }
function companyClosingDay(name) { return closingDayValue(companyPresetByName(name)?.closingDay); }
function companyBillingRange(name, baseDate = cursor) {
  const closingDay = companyClosingDay(name);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();
  const monthLast = new Date(year, month + 1, 0);
  const end = closingDay ? new Date(year, month, Math.min(closingDay, monthLast.getDate())) : monthLast;
  const previousMonthLast = new Date(year, month, 0);
  const previousEnd = closingDay ? new Date(previousMonthLast.getFullYear(), previousMonthLast.getMonth(), Math.min(closingDay, previousMonthLast.getDate())) : previousMonthLast;
  const start = new Date(previousEnd);
  start.setDate(start.getDate() + 1);
  return { start: toYmd(start), end: toYmd(end), closingDay };
}
function companyBillingPeriodLabel(name, baseDate = cursor) {
  const range = companyBillingRange(name, baseDate);
  return `${fmtDateJP(range.start)}〜${fmtDateJP(range.end)}（${closingDayLabel(range.closingDay)}）`;
}
function rateForPresetShift(preset, shift) { if (!preset) return 0; return shift === 'night' ? num(preset.nightRate) : num(preset.dayRate); }
function subcontractEnabled() { return state.settings.showSubcontract !== false; }
function yearEntries() { const year = cursor.getFullYear(); return state.entries.filter((entry) => fromYmd(entry.date).getFullYear() === year); }
function sumBy(entries, selector) { return entries.reduce((sum, entry) => sum + selector(entry), 0); }
function rateFieldValue(value) { return num(value) ? String(num(value)) : ''; }
function optionalMoneyFieldValue(value, isSet) { return isSet ? String(num(value)) : ''; }
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
  return `${parts.join(' / ') || '単価未設定'} / ${closingDayLabel(preset.closingDay)}`;
}
function renderCompanyPresetList() {
  const list = document.getElementById('st-company-list'); if (!list) return;
  const presets = companyPresetValues();
  if (openCompanyPresetId && !presets.some((preset) => preset.id === openCompanyPresetId)) openCompanyPresetId = '';
  list.innerHTML = presets.length ? presets.map((preset, index) => `
    <div class="company-rate-card ${preset.id === openCompanyPresetId ? 'open' : ''}">
      <div class="company-rate-summary">
        <button class="company-rate-toggle" type="button" data-toggle-company-preset="${escapeHtml(preset.id)}" aria-expanded="${preset.id === openCompanyPresetId ? 'true' : 'false'}">
          <span class="company-rate-main">${escapeHtml(preset.name)}</span>
          <span class="company-rate-sub">${escapeHtml(preset.officialName || preset.name)}</span>
          <span class="company-rate-meta">${companyRateText(preset)}</span>
        </button>
        <div class="company-rate-actions">
          <button class="company-rate-edit-btn" type="button" data-toggle-company-preset="${escapeHtml(preset.id)}">${preset.id === openCompanyPresetId ? '閉じる' : '編集'}</button>
          <button class="company-rate-delete-btn" type="button" data-remove-company-preset="${index}" aria-label="削除">×</button>
        </div>
      </div>
      <div class="company-rate-edit ${preset.id === openCompanyPresetId ? '' : 'hidden'}">
        <input class="st-input company-rate-name-input" data-company-preset-field="name" data-company-preset-id="${escapeHtml(preset.id)}" value="${escapeHtml(preset.name)}" placeholder="カレンダー表示名">
        <input class="st-input company-rate-name-input" data-company-preset-field="officialName" data-company-preset-id="${escapeHtml(preset.id)}" value="${escapeHtml(preset.officialName || preset.name)}" placeholder="請求書・出面表の正式名称">
        <input class="st-input" type="number" inputmode="numeric" data-company-preset-field="dayRate" data-company-preset-id="${escapeHtml(preset.id)}" value="${rateFieldValue(preset.dayRate)}" placeholder="日勤">
        <input class="st-input" type="number" inputmode="numeric" data-company-preset-field="nightRate" data-company-preset-id="${escapeHtml(preset.id)}" value="${rateFieldValue(preset.nightRate)}" placeholder="夜勤">
        <input class="st-input" type="number" inputmode="numeric" data-company-preset-field="otRate" data-company-preset-id="${escapeHtml(preset.id)}" value="${rateFieldValue(preset.otRate)}" placeholder="残業">
        <select class="st-select company-closing-select" data-company-preset-field="closingDay" data-company-preset-id="${escapeHtml(preset.id)}" aria-label="締め日">${closingDayOptions(preset.closingDay)}</select>
      </div>
    </div>`).join('') : '<div class="empty-inline">まだ登録がありません</div>';
}
renderCompanyPresetList = function renderCompanyPresetList() {
  const list = document.getElementById('st-company-list'); if (!list) return;
  const presets = companyPresetValues();
  if (openCompanyPresetId && !presets.some((preset) => preset.id === openCompanyPresetId)) openCompanyPresetId = '';
  list.innerHTML = presets.length ? presets.map((preset, index) => `
    <div class="company-rate-card ${preset.id === openCompanyPresetId ? 'open' : ''}">
      <div class="company-rate-summary">
        <button class="company-rate-toggle" type="button" data-toggle-company-preset="${escapeHtml(preset.id)}" aria-expanded="${preset.id === openCompanyPresetId ? 'true' : 'false'}">
          <span class="company-rate-main">${escapeHtml(preset.sheetName || preset.name)}</span>
          <span class="company-rate-sub">${escapeHtml(preset.name)} / ${escapeHtml(preset.officialName || preset.name)}</span>
          <span class="company-rate-meta">${companyRateText(preset)}</span>
        </button>
        <div class="company-rate-actions">
          <button class="company-rate-edit-btn" type="button" data-toggle-company-preset="${escapeHtml(preset.id)}">${preset.id === openCompanyPresetId ? '閉じる' : '編集'}</button>
          <button class="company-rate-delete-btn" type="button" data-remove-company-preset="${index}" aria-label="削除">×</button>
        </div>
      </div>
      <div class="company-rate-edit ${preset.id === openCompanyPresetId ? '' : 'hidden'}">
        <input class="st-input company-rate-name-input" data-company-preset-field="sheetName" data-company-preset-id="${escapeHtml(preset.id)}" value="${escapeHtml(preset.sheetName || companySheetNameFromOfficial(preset.officialName || preset.name))}" placeholder="出面表表示名">
        <input class="st-input company-rate-name-input" data-company-preset-field="name" data-company-preset-id="${escapeHtml(preset.id)}" value="${escapeHtml(preset.name)}" placeholder="略名（カレンダー）">
        <input class="st-input company-rate-name-input" data-company-preset-field="officialName" data-company-preset-id="${escapeHtml(preset.id)}" value="${escapeHtml(preset.officialName || preset.name)}" placeholder="請求書正式名称">
        <select class="st-select company-honorific-select" data-company-preset-field="invoiceHonorific" data-company-preset-id="${escapeHtml(preset.id)}" aria-label="請求書敬称"><option value="御中" ${normalizeInvoiceHonorific(preset.invoiceHonorific) === '御中' ? 'selected' : ''}>御中</option><option value="様" ${normalizeInvoiceHonorific(preset.invoiceHonorific) === '様' ? 'selected' : ''}>様</option></select>
        <input class="st-input" type="number" inputmode="numeric" data-company-preset-field="dayRate" data-company-preset-id="${escapeHtml(preset.id)}" value="${rateFieldValue(preset.dayRate)}" placeholder="日勤">
        <input class="st-input" type="number" inputmode="numeric" data-company-preset-field="nightRate" data-company-preset-id="${escapeHtml(preset.id)}" value="${rateFieldValue(preset.nightRate)}" placeholder="夜勤">
        <input class="st-input" type="number" inputmode="numeric" data-company-preset-field="otRate" data-company-preset-id="${escapeHtml(preset.id)}" value="${rateFieldValue(preset.otRate)}" placeholder="残業">
        <select class="st-select company-closing-select" data-company-preset-field="closingDay" data-company-preset-id="${escapeHtml(preset.id)}" aria-label="締め日">${closingDayOptions(preset.closingDay)}</select>
      </div>
    </div>`).join('') : '<div class="empty-inline">まだ登録がありません</div>';
};

function markSettingsSections(sections) {
  const list = Array.isArray(sections) ? sections : [sections];
  const now = new Date().toISOString();
  state.settings.settingUpdatedAt = { ...(state.settings.settingUpdatedAt || {}) };
  list.filter(Boolean).forEach((section) => { state.settings.settingUpdatedAt[section] = now; });
  state.settings.updatedAt = now;
}
function settingsSectionTime(settings, section) {
  const sectionTime = Date.parse(settings?.settingUpdatedAt?.[section] || '') || 0;
  if (sectionTime) return sectionTime;
  const hasSectionTimes = Object.values(settings?.settingUpdatedAt || {})
    .some((value) => (Date.parse(value || '') || 0) > 0);
  return hasSectionTimes ? 0 : (Date.parse(settings?.updatedAt || '') || 0);
}
function mergeTimestampMaps(...maps) {
  const merged = {};
  maps.forEach((map) => Object.entries(map || {}).forEach(([id, value]) => {
    if (!merged[id] || dateTime(value) > dateTime(merged[id])) merged[id] = value;
  }));
  return merged;
}
function mergeCompanyPresetLists(localSettings, remoteSettings) {
  const localTime = settingsSectionTime(localSettings, 'companies');
  const remoteTime = settingsSectionTime(remoteSettings, 'companies');
  const deleted = mergeTimestampMaps(localSettings.deletedCompanyPresetIds, remoteSettings.deletedCompanyPresetIds);
  const merged = [];
  const mergeItem = (preset, sourceTime) => {
    const nameKey = String(preset.name || '').trim().toLowerCase();
    if (!nameKey) return;
    const existingIndex = merged.findIndex((saved) => saved.id === preset.id || String(saved.name || '').trim().toLowerCase() === nameKey);
    const itemTime = dateTime(preset.updatedAt) || sourceTime;
    const deletedAt = Math.max(dateTime(deleted[preset.id]), dateTime(deleted[`name:${nameKey}`]));
    if (deletedAt && deletedAt >= itemTime) return;
    const existing = existingIndex >= 0 ? merged[existingIndex] : null;
    if (!existing) {
      merged.push({ ...preset, _time: itemTime });
      return;
    }
    const incomingIsNewer = itemTime >= existing._time;
    const preferred = incomingIsNewer ? preset : existing;
    const fallback = incomingIsNewer ? existing : preset;
    merged[existingIndex] = {
      id: existing.id || preset.id || crypto.randomUUID(),
      name: preferred.name || fallback.name,
      officialName: preferred.officialName || fallback.officialName || preferred.name || fallback.name,
      sheetName: preferred.sheetName || fallback.sheetName || companySheetNameFromOfficial(preferred.officialName || fallback.officialName || preferred.name || fallback.name),
      invoiceHonorific: normalizeInvoiceHonorific(preferred.invoiceHonorific || fallback.invoiceHonorific),
      dayRate: num(preferred.dayRate),
      nightRate: num(preferred.nightRate),
      otRate: num(preferred.otRate),
      closingDay: closingDayValue(preferred.closingDay),
      updatedAt: preferred.updatedAt || fallback.updatedAt || '',
      _time: Math.max(existing._time || 0, itemTime || 0),
    };
  };
  normalizeCompanyRates(localSettings.companyRates, localSettings.companies).forEach((preset) => mergeItem(preset, localTime));
  normalizeCompanyRates(remoteSettings.companyRates, remoteSettings.companies).forEach((preset) => mergeItem(preset, remoteTime));
  return merged
    .filter((preset) => {
      const nameKey = String(preset.name || '').trim().toLowerCase();
      const deletedAt = Math.max(dateTime(deleted[preset.id]), dateTime(deleted[`name:${nameKey}`]));
      return !deletedAt || dateTime(preset.updatedAt) > deletedAt;
    })
    .map(({ _time, ...preset }) => preset)
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
}
const NONEMPTY_PROTECTED_SETTING_KEYS = new Set([
  'name', 'postalCode', 'address', 'tel', 'companyName',
  'bank', 'branch', 'accountNo', 'accountName',
  'invoiceNo', 'stampImage', 'googleClientId',
]);
function hasMeaningfulSettingValue(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && value !== undefined;
}
function mergeSettingsBySection(localSettings, remoteSettings, { preferRemoteOnTie = false } = {}) {
  const local = normalizeState({ settings: localSettings }).settings;
  const remote = normalizeState({ settings: remoteSettings }).settings;
  const merged = { ...local };
  Object.entries(SETTINGS_SECTIONS).forEach(([section, keys]) => {
    if (section === 'companies') {
      const companyRates = mergeCompanyPresetLists(local, remote);
      merged.companyRates = companyRates;
      merged.companies = companyRates.map((item) => item.name);
      merged.deletedCompanyPresetIds = mergeTimestampMaps(local.deletedCompanyPresetIds, remote.deletedCompanyPresetIds);
      return;
    }
    const localTime = settingsSectionTime(local, section);
    const remoteTime = settingsSectionTime(remote, section);
    const remoteWins = remoteTime > localTime || (preferRemoteOnTie && remoteTime === localTime);
    const source = remoteWins ? remote : local;
    const fallback = remoteWins ? local : remote;
    keys.forEach((key) => {
      const sourceValue = source[key];
      const fallbackValue = fallback[key];
      const preserveFallback = NONEMPTY_PROTECTED_SETTING_KEYS.has(key)
        && !hasMeaningfulSettingValue(sourceValue)
        && hasMeaningfulSettingValue(fallbackValue);
      merged[key] = clone(preserveFallback ? fallbackValue : sourceValue);
    });
  });
  merged.settingUpdatedAt = { ...(local.settingUpdatedAt || {}) };
  Object.keys(SETTINGS_SECTIONS).forEach((section) => {
    const localTime = settingsSectionTime(local, section);
    const remoteTime = settingsSectionTime(remote, section);
    const remoteWins = remoteTime > localTime || (preferRemoteOnTie && remoteTime === localTime);
    merged.settingUpdatedAt[section] = remoteWins ? remote.settingUpdatedAt?.[section] || remote.updatedAt || '' : local.settingUpdatedAt?.[section] || local.updatedAt || '';
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
    item.sheetName = item.sheetName || companySheetNameFromOfficial(item.officialName || oldName);
    state.entries = state.entries.map((entry) => entry.company === oldName ? { ...entry, company: nextName, updatedAt: new Date().toISOString() } : entry);
    if (selectedCompany === oldName) selectedCompany = nextName;
  } else if (field === 'sheetName') {
    item.sheetName = value.trim();
  } else if (field === 'officialName') {
    item.officialName = value.trim();
    item.sheetName = item.sheetName || companySheetNameFromOfficial(item.officialName || item.name);
  } else if (field === 'invoiceHonorific') {
    item.invoiceHonorific = normalizeInvoiceHonorific(value);
  } else {
    item[field] = num(value);
  }
  item.updatedAt = new Date().toISOString();
  if (state.settings.deletedCompanyPresetIds) {
    delete state.settings.deletedCompanyPresetIds[item.id];
    delete state.settings.deletedCompanyPresetIds[`name:${String(item.name || '').trim().toLowerCase()}`];
  }
  writeCompanyPresetValues(values);
  scheduleSettingsAutosave({ section: 'companies' });
}
function ensureCompanySheetNameInput() {
  const nameInput = document.getElementById('st-company-new');
  const officialInput = document.getElementById('st-company-official-new');
  if (nameInput) nameInput.placeholder = '略名 例: マル';
  if (officialInput) officialInput.placeholder = '請求書正式名称 例: 株式会社マルヒロアート';
  if (!nameInput) return;
  if (!document.getElementById('st-company-sheet-new')) {
    const input = document.createElement('input');
    input.id = 'st-company-sheet-new';
    input.className = 'st-input';
    input.placeholder = '出面表表示名 例: マルヒロアート';
    nameInput.insertAdjacentElement('beforebegin', input);
  }
  if (!document.getElementById('st-company-honorific-new') && officialInput) {
    const select = document.createElement('select');
    select.id = 'st-company-honorific-new';
    select.className = 'st-select';
    select.setAttribute('aria-label', '請求書敬称');
    select.innerHTML = '<option value="御中">御中</option><option value="様">様</option>';
    officialInput.insertAdjacentElement('afterend', select);
  }
}
function renderDayModalItemSelector() {
  const list = document.getElementById('st-day-modal-items');
  if (!list) return;
  const selected = new Set(normalizeDayModalItems(state.settings.dayModalItems, expenseItems()));
  list.innerHTML = dayModalDisplayOptions().map((item) => `<label class="setting-check-chip"><input type="checkbox" data-day-modal-item="${escapeHtml(item.id)}" ${selected.has(item.id) ? 'checked' : ''}><span>${escapeHtml(item.label)}</span></label>`).join('');
}
function renderSettingListEditors() { ensureCompanySheetNameInput(); renderCompanyPresetList(); renderEditableList('st-expense-list', 'st-expenses'); renderDayModalItemSelector(); }
function addCompanyPreset() {
  const nameInput = document.getElementById('st-company-new'); if (!nameInput) return;
  const name = nameInput.value.trim(); if (!name) return;
  const current = companyPresetValues();
  const existing = current.find((item) => item.name === name);
  const next = current.filter((item) => item.id !== existing?.id);
  const id = existing?.id || crypto.randomUUID();
  const officialName = document.getElementById('st-company-official-new')?.value.trim() || name;
  const sheetName = document.getElementById('st-company-sheet-new')?.value.trim() || companySheetNameFromOfficial(officialName);
  const invoiceHonorific = normalizeInvoiceHonorific(document.getElementById('st-company-honorific-new')?.value);
  next.push({ id, name, sheetName, officialName, invoiceHonorific, dayRate: num(document.getElementById('st-company-day-new')?.value), nightRate: num(document.getElementById('st-company-night-new')?.value), otRate: num(document.getElementById('st-company-ot-new')?.value), closingDay: closingDayValue(document.getElementById('st-company-closing-new')?.value), updatedAt: new Date().toISOString() });
  state.settings.deletedCompanyPresetIds = { ...(state.settings.deletedCompanyPresetIds || {}) };
  delete state.settings.deletedCompanyPresetIds[id];
  delete state.settings.deletedCompanyPresetIds[`name:${name.toLowerCase()}`];
  writeCompanyPresetValues(next);
  openCompanyPresetId = id;
  ['st-company-new', 'st-company-sheet-new', 'st-company-official-new', 'st-company-day-new', 'st-company-night-new', 'st-company-ot-new'].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ''; });
  const closing = document.getElementById('st-company-closing-new'); if (closing) closing.value = '0';
  const honorific = document.getElementById('st-company-honorific-new'); if (honorific) honorific.value = '御中';
  renderCompanyPresetList();
  scheduleSettingsAutosave({ immediate: true, section: 'companies' });
}
function addSettingListItem(hiddenId, inputId) {
  const input = document.getElementById(inputId); if (!input) return;
  const value = input.value.trim(); if (!value) return;
  const values = [...new Set([...settingListValues(hiddenId), value])];
  writeSettingList(hiddenId, values); input.value = '';
  scheduleSettingsAutosave({ immediate: true, section: 'expenses' });
  renderSettingListEditors();
}
function showSaveFeedback(message) {
  const el = document.getElementById('save-status'); if (!el) { alert(message); return; }
  el.textContent = message; el.classList.add('show');
  window.clearTimeout(showSaveFeedback.timer);
  showSaveFeedback.timer = window.setTimeout(() => el.classList.remove('show'), 2200);
}
function monthEntries() { const key = monthKey(cursor); return state.entries.filter((entry) => monthKey(entry.date) === key).sort((a, b) => a.date.localeCompare(b.date)); }
function dayEntries(ymd) { return state.entries.filter((entry) => entry.date === ymd).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
function calcEntry(entry) {
  const isContract = entry?.billingType === 'contract';
  const contractAnchor = isContract && isContractBillingAnchor(entry);
  const qty = isContract ? 0 : qtyValue(entry.qty), unitRate = isContract ? 0 : num(entry.unitRate), otHours = isContract ? 0 : num(entry.otHours), otRate = isContract || !otHours ? 0 : num(entry.otRate);
  const labor = qty * unitRate, overtime = otHours * otRate;
  const contractAmount = contractAnchor ? num(entry.contractAmount) : 0;
  const expenses = expenseItems().reduce((sum, item) => sum + num(entry.expenses?.[item.id]), 0);
  const subtotal = labor + contractAmount + overtime + expenses;
  const subcontractSales = labor + contractAmount + overtime;
  const paymentAmount = entry.type === 'sub' && (!isContract || contractAnchor) ? num(entry.paymentAmount) : 0;
  const subcontractPay = entry.type === 'sub' ? (entry.paymentAmountSet ? paymentAmount : subcontractSales) : 0;
  const subcontractDiff = entry.type === 'sub' ? subcontractSales - subcontractPay : 0;
  return { qty, unitRate, otHours, otRate, labor, contractAmount, overtime, expenses, subtotal, subcontractSales, paymentAmount, subcontractPay, subcontractDiff, isContract, contractAnchor };
}
function salesTotalForEntry(entry) {
  const parts = { ...DEFAULT_SETTINGS.salesTotalParts, ...(state.settings.salesTotalParts || {}) };
  const calc = calcEntry(entry);
  return calc.contractAmount + (parts.labor ? calc.labor : 0) + (parts.overtime ? calc.overtime : 0) + (parts.expenses ? calc.expenses : 0);
}
function shiftLabel(shift) { return { day: '日勤', night: '夜勤', trip: '出張' }[shift] || '日勤'; }
function shiftClass(shift) { return { day: 'day', night: 'night', trip: 'trip' }[shift] || 'day'; }
function calendarDisplayOrder(entry) {
  if (entry?.type === 'sub') return 3;
  if (String(entry?.shift || 'day') === 'night') return 2;
  return 1;
}
function sortEntriesForCalendarDisplay(items) {
  return [...items].sort((a, b) => calendarDisplayOrder(a) - calendarDisplayOrder(b)
    || String(a.company || '').localeCompare(String(b.company || ''), 'ja')
    || String(a.site || '').localeCompare(String(b.site || ''), 'ja')
    || String(a.workerName || '').localeCompare(String(b.workerName || ''), 'ja')
    || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
}
function shiftSortValue(shift) { return { day: 1, trip: 2, night: 3 }[shift] || 9; }
function sortEntriesForDemen(a, b) {
  return shiftSortValue(a.shift) - shiftSortValue(b.shift)
    || String(a.site || '').localeCompare(String(b.site || ''), 'ja')
    || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
}
function typeLabel(type) { return type === 'sub' ? '外注' : '自分'; }
function billingTypeLabel(entry) { return entry?.billingType === 'contract' ? '請負' : '人工'; }
function contractGroupEntries(entry) {
  if (!entry || entry.billingType !== 'contract') return entry ? [entry] : [];
  if (!entry.rangeGroupId) return [entry];
  const entries = state.entries.filter((item) => item.rangeGroupId === entry.rangeGroupId && item.billingType === 'contract');
  return entries.length ? entries : [entry];
}
function contractBillingDate(entry) {
  return contractGroupEntries(entry).map((item) => item.date).filter(Boolean).sort().at(-1) || entry?.date || '';
}
function isContractBillingAnchor(entry) { return entry?.billingType === 'contract' && entry.date === contractBillingDate(entry); }
function invoiceBillableEntry(entry) { return entry.type === 'self' || entry.type === 'sub'; }
function pickSelectedCompany() {
  const baseCompanies = invoiceViewMode === 'annual' ? getAnnualInvoiceCompanies(cursor.getFullYear()) : getInvoiceCompanies();
  const companies = invoiceViewMode === 'annual' && baseCompanies.length ? [ALL_COMPANIES_KEY, ...baseCompanies] : baseCompanies;
  if (!companies.length) { selectedCompany = ''; return companies; }
  if (!companies.includes(selectedCompany)) selectedCompany = companies[0];
  return companies;
}
function entriesForInvoiceCompanyName(company, baseDate = cursor) {
  const range = companyBillingRange(company, baseDate);
  return state.entries
    .filter((entry) => invoiceBillableEntry(entry) && entry.company === company && entry.date >= range.start && entry.date <= range.end)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function getInvoiceCompanies(baseDate = cursor) {
  return [...new Set(state.entries.filter(invoiceBillableEntry).map((entry) => entry.company).filter(Boolean))]
    .filter((company) => entriesForInvoiceCompanyName(company, baseDate).length)
    .sort((a, b) => a.localeCompare(b, 'ja'));
}
function getAnnualInvoiceCompanies(year) {
  return [...new Set(state.entries.filter(invoiceBillableEntry).map((entry) => entry.company).filter(Boolean))]
    .filter((company) => Array.from({ length: 12 }, (_, month) => entriesForInvoiceCompanyName(company, new Date(year, month, 1)).length).some(Boolean))
    .sort((a, b) => a.localeCompare(b, 'ja'));
}
function companyInvoiceMode(company) { return state.settings.companyInvoiceModes?.[company] || 'with'; }
function setCompanyInvoiceMode(company, mode) { state.settings.companyInvoiceModes[company] = mode; saveState(); }
function companyEventTitle(entry) {
  const title = [companyCalendarName(entry.company), entry.site].filter(Boolean).join(' / ') || '現場予定';
  return entry.billingType === 'contract' ? `請 / ${title}` : title;
}
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

function renderAll() { applyDisplayPreferences(); renderNav(); renderHeaders(); renderCalendar(); renderDayEntries(); renderDesktopSheet(); renderSubScreen(); renderInvoiceScreen(); renderSettings(); renderSyncScreen(); }
function renderNav() {
  if (activeScreen === 'sub' && !subcontractEnabled()) activeScreen = 'cal';
  if (activeScreen !== 'cal') {
    isSheetPageOpen = false;
    if (window.innerWidth < 900) isDayModalOpen = false;
  }
  document.body.classList.toggle('sheet-mobile-open', activeScreen === 'cal' && isSheetPageOpen);
  document.body.classList.toggle('pc-calendar-pinned', activeScreen !== 'cal');
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active', 'print-active', 'printing-invoice', 'printing-demen'));
  document.getElementById(`sc-${activeScreen}`)?.classList.add('active');
  document.getElementById('sc-cal')?.classList.toggle('pc-pinned', activeScreen !== 'cal');
  document.querySelectorAll('.nav-item').forEach((el) => el.classList.toggle('active', el.dataset.screen === activeScreen));
  document.querySelectorAll('[data-screen="sync"]').forEach((el) => { el.textContent = '同期・連携'; });
  syncMenuClones();
  document.querySelectorAll('[data-screen="sub"],[data-screen-link="sub"]').forEach((el) => el.classList.toggle('hidden', !subcontractEnabled()));
  document.getElementById('fab-sub')?.classList.toggle('hidden', !subcontractEnabled());
  document.querySelectorAll('.top-menu').forEach((menu) => menu.classList.add('hidden'));
}
function syncMenuClones() {
  const subItem = subcontractEnabled() ? '<button class="top-menu-item" data-screen-link="sub">外注</button>' : '';
  const template = `
    <button class="top-menu-item" data-screen-link="cal">カレンダー</button>
    <button class="top-menu-item" data-screen-link="inv">請求書、出面表</button>
    <button class="top-menu-item" data-screen-link="sync">同期・連携</button>
    ${subItem}
    <button class="top-menu-item" data-screen-link="st">設定</button>
    <button class="top-menu-item" data-sales-toggle>${state.settings.showSales ? '売上を隠す' : '売上を表示'}</button>`;
  document.querySelectorAll('.top-menu').forEach((menu) => { menu.innerHTML = template; });
}
function renderHeaders() {
  const monthText = fmtMonth(cursor);
  const version = document.getElementById('app-version-badge'); if (version) version.textContent = APP_VERSION;
  document.getElementById('cal-sub').textContent = `${monthText} ・ 予定 ${monthEntries().length}件`;
  document.getElementById('sub-sub').textContent = `${monthText}の外注出面`;
  document.getElementById('inv-sub').textContent = invoiceViewMode === 'annual' ? `${cursor.getFullYear()}年の年次集計` : `${monthText}の会社別帳票`;
  ['cal', 'sub'].forEach((prefix) => { const el = document.getElementById(`${prefix}-mnav`); if (el) el.textContent = monthText; });
  const invoiceNav = document.getElementById('inv-mnav'); if (invoiceNav) invoiceNav.textContent = invoiceViewMode === 'annual' ? `${cursor.getFullYear()}年` : monthText;
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
    const displayedItems = sortEntriesForCalendarDisplay(items);
    const lines = displayedItems.slice(0, 3).map((entry) => `<div class="${calendarTaskClass(entry, ymd, date.getDay())}">${escapeHtml(companyEventTitle(entry))}</div>`).join('');
    const hiddenCount = Math.max(0, items.length - 3);
    const more = hiddenCount ? `<div class="more-chip" aria-label="ほかに${hiddenCount}件">+${hiddenCount}</div>` : '';
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
function desktopSheetExpenseColumns() {
  const map = new Map();
  expenseItems().forEach((item) => map.set(item.id, item));
  coreExpenseItems().forEach((item) => { if (!map.has(item.id)) map.set(item.id, item); });
  return [...map.values()];
}
function desktopSheetInput({ field, value = '', id = '', extra = '', type = 'text' }) {
  return `<input class="desktop-sheet-input ${extra}" type="${type}" data-sheet-field="${field}" value="${escapeHtml(value)}" ${id ? `data-expense-id="${escapeHtml(id)}"` : ''}>`;
}
function desktopSheetCell(content, rowIndex, colIndex, className = '', attrs = '') {
  return `<td class="${className}" data-sheet-cell data-row-index="${rowIndex}" data-col-index="${colIndex}" ${attrs}>${content}</td>`;
}
function desktopSheetColgroup(expenseColumns) {
  const widths = [36, 86, 188, 42, 58, 62, 48, 70, 74, ...expenseColumns.map(() => 64), 86];
  return `<colgroup>${widths.map((width, index) => `<col class="${index === 1 ? 'desktop-sheet-company-col' : ''}" style="width:${width}px">`).join('')}</colgroup>`;
}
function desktopSheetTotals(entries, expenseColumns) {
  const totals = {
    qty: sumBy(entries, (entry) => calcEntry(entry).qty),
    labor: sumBy(entries, (entry) => calcEntry(entry).labor),
    contract: sumBy(entries, (entry) => calcEntry(entry).contractAmount),
    otHours: sumBy(entries, (entry) => calcEntry(entry).otHours),
    overtime: sumBy(entries, (entry) => calcEntry(entry).overtime),
    expenses: expenseColumns.map((item) => ({ ...item, total: sumBy(entries, (entry) => num(entry.expenses?.[item.id])) })),
  };
  totals.expenseTotal = totals.expenses.reduce((sum, item) => sum + item.total, 0);
  totals.grandTotal = totals.labor + totals.contract + totals.overtime + totals.expenseTotal;
  return totals;
}
function desktopSheetFooter(totals, expenseColumns) {
  const expenseTotals = expenseColumns.map((item) => {
    const total = totals.expenses.find((expense) => expense.id === item.id)?.total || 0;
    return `<td class="desktop-sheet-total">${total ? yenPlain(total) : ''}</td>`;
  }).join('');
  const colCount = 10 + expenseColumns.length;
  return `<tfoot>
    <tr class="desktop-sheet-subtotal-row"><td></td><td></td><td class="desktop-sheet-footer-label">小計</td><td>${qtyLabel(totals.qty)}</td><td></td><td class="desktop-sheet-total">${totals.labor ? yenPlain(totals.labor) : ''}</td><td>${totals.otHours || ''}</td><td></td><td class="desktop-sheet-total">${totals.overtime ? yenPlain(totals.overtime) : ''}</td>${expenseTotals}<td class="desktop-sheet-total">${totals.grandTotal ? yenPlain(totals.grandTotal) : ''}</td></tr>
    <tr class="desktop-sheet-grand-row"><td colspan="${Math.max(1, colCount - 3)}"></td><td class="desktop-sheet-footer-label">合計</td><td colspan="2" class="desktop-sheet-total">${totals.grandTotal ? yenPlain(totals.grandTotal) : ''}</td></tr>
  </tfoot>`;
}
function updateDesktopSheetFooter() {
  const footer = document.querySelector('#desktop-sheet-panel .desktop-sheet-table tfoot');
  if (!footer) return;
  const expenseColumns = desktopSheetExpenseColumns();
  const sheetEntries = monthEntries().filter((entry) => entry.type === 'self');
  footer.outerHTML = desktopSheetFooter(desktopSheetTotals(sheetEntries, expenseColumns), expenseColumns);
}
function desktopSheetRow(entry, date, dayLabel, expenseColumns, rowIndex, dayRowspan = 1) {
  const calc = entry ? calcEntry(entry) : null;
  const expenses = entry?.expenses || {};
  const siteClass = entry?.shift === 'night' ? 'desktop-sheet-site night' : 'desktop-sheet-site';
  let colIndex = dayLabel === null ? 1 : 0;
  const cell = (content, className = '') => desktopSheetCell(content, rowIndex, colIndex++, className);
  const dayCell = dayLabel === null ? '' : desktopSheetCell(dayLabel, rowIndex, 0, 'desktop-sheet-day', dayRowspan > 1 ? `rowspan="${dayRowspan}"` : '');
  if (entry?.billingType === 'contract') {
    return `<tr class="desktop-sheet-contract-row" data-sheet-row data-entry-id="${escapeHtml(entry.id)}" data-date="${escapeHtml(date)}">
      ${dayCell}
      ${cell(escapeHtml(companySheetName(entry.company)), 'desktop-sheet-readonly')}
      ${cell(`<span class="desktop-contract-badge">請負</span>${escapeHtml(entry.site || '')}`, `${siteClass} desktop-sheet-readonly`)}
      ${cell('', 'desktop-sheet-readonly')}${cell('', 'desktop-sheet-readonly')}${cell('', 'desktop-sheet-readonly')}
      ${cell('', 'desktop-sheet-readonly')}${cell('', 'desktop-sheet-readonly')}${cell('', 'desktop-sheet-readonly')}
      ${expenseColumns.map((item) => cell(num(expenses[item.id]) ? yenPlain(num(expenses[item.id])) : '', 'desktop-sheet-readonly')).join('')}
      ${cell(calc.subtotal ? yenPlain(calc.subtotal) : '', 'desktop-sheet-total desktop-sheet-readonly')}
    </tr>`;
  }
  return `<tr data-sheet-row data-entry-id="${escapeHtml(entry?.id || '')}" data-date="${escapeHtml(date)}">
    ${dayCell}
    ${cell(desktopSheetInput({ field: 'company', value: entry ? companySheetName(entry.company) : '' }))}
    ${cell(desktopSheetInput({ field: 'site', value: entry?.site || '' }), siteClass)}
    ${cell(desktopSheetInput({ field: 'qty', value: entry ? qtyLabel(calc.qty) : '', extra: 'num', type: 'number' }))}
    ${cell(desktopSheetInput({ field: 'unitRate', value: entry && calc.unitRate ? calc.unitRate : '', extra: 'num', type: 'number' }))}
    ${cell(entry && calc.labor ? yenPlain(calc.labor) : '', 'desktop-sheet-total" data-sheet-total="labor')}
    ${cell(desktopSheetInput({ field: 'otHours', value: entry && calc.otHours ? calc.otHours : '', extra: 'num', type: 'number' }))}
    ${cell(desktopSheetInput({ field: 'otRate', value: entry && calc.otRate ? calc.otRate : '', extra: 'num', type: 'number' }))}
    ${cell(entry && calc.overtime ? yenPlain(calc.overtime) : '', 'desktop-sheet-total" data-sheet-total="overtime')}
    ${expenseColumns.map((item) => cell(desktopSheetInput({ field: 'expense', id: item.id, value: num(expenses[item.id]) || '', extra: 'num', type: 'number' }))).join('')}
    ${cell(entry && calc.subtotal ? yenPlain(calc.subtotal) : '', 'desktop-sheet-total" data-sheet-total="subtotal')}
  </tr>`;
}
function renderDesktopSheet() {
  const panel = document.getElementById('desktop-sheet-panel');
  if (!panel) return;
  sheetSelection = null;
  sheetMouseSelecting = false;
  const expenseColumns = desktopSheetExpenseColumns();
  const sheetEntries = monthEntries().filter((entry) => entry.type === 'self');
  const totals = desktopSheetTotals(sheetEntries, expenseColumns);
  const sheetCompanies = [...new Set(sheetEntries.map((entry) => entry.company).filter(Boolean))];
  const companyTitle = sheetCompanies.length === 1 ? companySheetName(sheetCompanies[0]) : (sheetCompanies.length ? '全会社' : '');
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const rows = [];
  for (let day = 1; day <= days; day += 1) {
    const date = toYmd(new Date(cursor.getFullYear(), cursor.getMonth(), day));
    const entries = dayEntries(date).filter((entry) => entry.type === 'self').sort(sortEntriesForDemen);
    if (!entries.length) rows.push(desktopSheetRow(null, date, day, expenseColumns, rows.length));
    entries.forEach((entry, index) => rows.push(desktopSheetRow(entry, date, index === 0 ? day : null, expenseColumns, rows.length, entries.length)));
  }
  panel.innerHTML = `<div class="desktop-sheet-head"><div><strong>${cursor.getMonth() + 1}月 出面表</strong><span>出力プレビュー / PC編集可</span></div><div class="desktop-sheet-head-actions"><button class="desktop-sheet-menu-btn" type="button" data-menu-open aria-label="メニュー">☰</button><button class="desktop-sheet-close" type="button" data-close-sheet-page>カレンダーへ</button></div></div>
    <div class="desktop-sheet-scroll"><table class="desktop-sheet-table">
      ${desktopSheetColgroup(expenseColumns)}
      <thead>
        <tr class="desktop-sheet-title-row"><th colspan="3" class="left">${escapeHtml(companyTitle)}</th><th colspan="2">${cursor.getMonth() + 1}</th><th colspan="3" class="left">月 出面表</th><th colspan="${expenseColumns.length}"></th><th class="right">氏名：</th><th>${escapeHtml(state.settings.name || '')}</th></tr>
        <tr><th>日</th><th>会社名</th><th>現場名</th><th>人工</th><th>単価</th><th>人工計</th><th>残業h</th><th>残業単価</th><th>残業計</th>${expenseColumns.map((item) => `<th>${escapeHtml(item.label)}</th>`).join('')}<th>金額</th></tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
      ${desktopSheetFooter(totals, expenseColumns)}
    </table></div>`;
  applySheetZoom();
}
function renderDayEntries() {
  const legacy = document.getElementById('day-entries');
  if (legacy) legacy.innerHTML = '';
  const modal = document.getElementById('day-modal-bg');
  const title = document.getElementById('day-modal-title');
  const body = document.getElementById('day-modal-body');
  if (!modal || !title || !body) return;
  const entries = sortEntriesForCalendarDisplay(dayEntries(selectedDate));
  title.textContent = `${fmtDateJP(selectedDate)}（${weekdayLabel(selectedDate)}）`;
  if (!entries.length) {
    body.innerHTML = `<div class="day-mini-empty"><div class="empty" style="padding:22px 10px 8px"><div>この日の予定はありません</div><p>追加ボタンから登録できます。</p></div><button class="btn-primary" type="button" data-add-date="${selectedDate}">予定を追加</button></div>`;
    modal.classList.toggle('open', isDayModalOpen);
    return;
  }
  body.innerHTML = `<div class="day-mini-list">${entries.map((entry) => {
    const isSub = entry.type === 'sub';
    const calc = calcEntry(entry);
    const contractChip = entry.billingType === 'contract' ? `<div class="expense-chip contract-chip">請負 ${yen(num(entry.contractAmount))}${calc.contractAnchor ? '・計上日' : ''}</div>` : '';
    return `<div class="day-mini-card ${shiftClass(entry.shift)} ${isSub ? 'sub' : ''}"><div class="day-mini-row"><div class="day-mini-main"><div class="day-mini-site">${escapeHtml(entry.site || '現場名未入力')}</div><div class="day-mini-company">${escapeHtml(companyCalendarName(entry.company) || '会社名未入力')} ・ ${isSub ? escapeHtml(entry.workerName || '外注職人') : '自分'} ・ ${shiftLabel(entry.shift)} ・ ${billingTypeLabel(entry)}</div></div><div class="day-mini-side"><div class="pill ${isSub ? 'sub' : shiftClass(entry.shift)}">${entry.billingType === 'contract' ? '請負' : (isSub ? '外注' : shiftLabel(entry.shift))}</div>${contractChip}${renderEntryExpenseChips(entry)}</div></div><div class="day-mini-actions"><button class="day-mini-btn" type="button" data-edit-entry="${entry.id}">編集</button><button class="day-mini-btn del" type="button" data-del-entry="${entry.id}">削除</button></div></div>`;
  }).join('')}<button class="btn-primary" type="button" data-add-date="${selectedDate}">予定を追加</button></div>`;
  body.querySelectorAll('[data-expense-entry-id][data-expense-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openExpenseQuickEdit(button.dataset.expenseEntryId, button.dataset.expenseId);
    });
  });
  modal.classList.toggle('open', isDayModalOpen);
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

function expenseItemById(expenseId) {
  if (expenseId === DAY_MODAL_OVERTIME_ID) return { id: DAY_MODAL_OVERTIME_ID, label: '残業時間（h）', kind: 'overtime' };
  return [...coreExpenseItems(), ...expenseItems()].find((item) => item.id === expenseId) || { id: expenseId, label: '経費' };
}

function resetExpenseQuickPosition() {
  const modal = document.getElementById('expense-quick-edit-bg');
  if (!modal) return;
  modal.classList.remove('keyboard-active');
  modal.style.removeProperty('--expense-quick-top');
}

function updateExpenseQuickPosition() {
  const modal = document.getElementById('expense-quick-edit-bg');
  const input = document.getElementById('expense-quick-amount');
  const dialog = modal?.querySelector('.expense-quick-edit');
  if (!modal?.classList.contains('open') || !input || document.activeElement !== input) {
    resetExpenseQuickPosition();
    return;
  }
  modal.classList.add('keyboard-active');
  const viewport = window.visualViewport;
  const visibleHeight = viewport?.height || window.innerHeight || 520;
  const offsetTop = viewport?.offsetTop || 0;
  const dialogHeight = dialog?.offsetHeight || 220;
  const lowestTop = Math.max(72, visibleHeight - dialogHeight - 18);
  const preferredTop = Math.max(104, Math.round(visibleHeight * 0.24));
  const top = Math.round(offsetTop + Math.min(preferredTop, lowestTop));
  modal.style.setProperty('--expense-quick-top', `${top}px`);
}

function ensureExpenseQuickEditModal() {
  let modal = document.getElementById('expense-quick-edit-bg');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'expense-quick-edit-bg';
  modal.className = 'expense-quick-edit-bg';
  modal.innerHTML = `
    <div class="expense-quick-edit" role="dialog" aria-modal="true" aria-labelledby="expense-quick-title">
      <div class="expense-quick-title" id="expense-quick-title">経費を入力</div>
      <div class="expense-quick-actions">
        <button class="btn-secondary" type="button" data-expense-quick-cancel>キャンセル</button>
        <button class="btn-primary" type="button" data-expense-quick-save>保存</button>
      </div>
      <label class="expense-quick-label" for="expense-quick-amount"><span id="expense-quick-name">経費</span></label>
      <input class="expense-quick-input" id="expense-quick-amount" type="number" min="0" step="1" inputmode="numeric">
    </div>`;
  document.body.appendChild(modal);
  const input = modal.querySelector('#expense-quick-amount');
  const saveButton = modal.querySelector('[data-expense-quick-save]');
  saveButton?.addEventListener('pointerdown', (event) => event.preventDefault());
  saveButton?.addEventListener('click', (event) => {
    event.stopPropagation();
    saveExpenseQuickEdit();
  });
  input?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    saveExpenseQuickEdit();
  });
  input?.addEventListener('focus', () => requestAnimationFrame(updateExpenseQuickPosition));
  input?.addEventListener('blur', () => setTimeout(updateExpenseQuickPosition, 120));
  if (!expenseQuickViewportBound) {
    expenseQuickViewportBound = true;
    window.visualViewport?.addEventListener('resize', updateExpenseQuickPosition);
    window.visualViewport?.addEventListener('scroll', updateExpenseQuickPosition);
    window.addEventListener('resize', updateExpenseQuickPosition);
  }
  return modal;
}

function openExpenseQuickEdit(entryId, expenseId) {
  const entry = state.entries.find((item) => item.id === entryId);
  if (!entry) return;
  const expense = expenseItemById(expenseId);
  expenseQuickEditTarget = { entryId, expenseId };
  const modal = ensureExpenseQuickEditModal();
  modal.querySelector('#expense-quick-title').textContent = expense.kind === 'overtime' ? '残業を入力' : '経費を入力';
  modal.querySelector('#expense-quick-name').textContent = expense.label;
  const input = modal.querySelector('#expense-quick-amount');
  input.step = expense.kind === 'overtime' ? '0.5' : '1';
  input.inputMode = expense.kind === 'overtime' ? 'decimal' : 'numeric';
  input.value = expense.kind === 'overtime' ? (num(entry.otHours) || '') : (num(entry.expenses?.[expenseId]) || '');
  modal.classList.add('open');
  requestAnimationFrame(updateExpenseQuickPosition);
  setTimeout(() => { input.focus(); input.select(); updateExpenseQuickPosition(); }, 0);
}

function closeExpenseQuickEdit() {
  expenseQuickEditTarget = null;
  const modal = document.getElementById('expense-quick-edit-bg');
  modal?.classList.remove('open');
  resetExpenseQuickPosition();
}

function saveExpenseQuickEdit() {
  if (!expenseQuickEditTarget) return;
  const entry = state.entries.find((item) => item.id === expenseQuickEditTarget.entryId);
  const input = document.getElementById('expense-quick-amount');
  if (!entry || !input) { closeExpenseQuickEdit(); return; }
  const isOvertime = expenseQuickEditTarget.expenseId === DAY_MODAL_OVERTIME_ID;
  if (isOvertime) entry.otHours = num(input.value);
  else {
    entry.expenses = { ...(entry.expenses || {}) };
    entry.expenses[expenseQuickEditTarget.expenseId] = num(input.value);
  }
  entry.updatedAt = new Date().toISOString();
  closeExpenseQuickEdit();
  saveState();
  renderAll();
  scheduleDriveAutoSync({ delay: 900, message: isOvertime ? '残業をクラウドへ保存します...' : '経費をクラウドへ保存します...' });
}
function openSheetPage() {
  if (activeScreen !== 'cal') return;
  isSheetPageOpen = true;
  closeDayModal();
  document.body.classList.add('sheet-mobile-open');
  sheetZoom = sheetFitZoom();
  applySheetZoom();
}
function closeSheetPage() {
  isSheetPageOpen = false;
  document.body.classList.remove('sheet-mobile-open');
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}
function clampSheetZoom(value) {
  return Math.min(2.2, Math.max(0.32, Number(value) || 1));
}
function sheetFitZoom() {
  const scroll = document.querySelector('#desktop-sheet-panel .desktop-sheet-scroll');
  const table = document.querySelector('#desktop-sheet-panel .desktop-sheet-table');
  if (!scroll || !table) return 1;
  const tableWidth = table.offsetWidth || 920;
  return clampSheetZoom((scroll.clientWidth - 8) / tableWidth);
}
function touchDistance(touches) {
  const a = touches[0], b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}
function applySheetZoom() {
  const table = document.querySelector('#desktop-sheet-panel .desktop-sheet-table');
  if (!table) return;
  table.style.zoom = String(sheetZoom);
}
function clearSheetSelection() {
  document.querySelectorAll('.desktop-sheet-cell-selected').forEach((cell) => cell.classList.remove('desktop-sheet-cell-selected', 'desktop-sheet-cell-anchor'));
}
function setSheetSelection(anchor, focus) {
  if (!anchor || !focus) return;
  const startRow = Number(anchor.dataset.rowIndex), endRow = Number(focus.dataset.rowIndex);
  const startCol = Number(anchor.dataset.colIndex), endCol = Number(focus.dataset.colIndex);
  const minRow = Math.min(startRow, endRow), maxRow = Math.max(startRow, endRow);
  const minCol = Math.min(startCol, endCol), maxCol = Math.max(startCol, endCol);
  sheetSelection = { minRow, maxRow, minCol, maxCol };
  clearSheetSelection();
  document.querySelectorAll('#desktop-sheet-panel [data-sheet-cell]').forEach((cell) => {
    const row = Number(cell.dataset.rowIndex), col = Number(cell.dataset.colIndex);
    const selected = row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
    cell.classList.toggle('desktop-sheet-cell-selected', selected);
  });
  anchor.classList.add('desktop-sheet-cell-anchor');
}
function sheetCellCopyValue(cell) {
  const input = cell.querySelector('[data-sheet-field]');
  return input ? input.value : cell.textContent.trim();
}
function sheetCellAt(row, col) {
  return document.querySelector(`#desktop-sheet-panel [data-row-index="${row}"][data-col-index="${col}"]`);
}
function copySheetSelection(event) {
  if (!sheetSelection || !event.target.closest?.('#desktop-sheet-panel')) return;
  const lines = [];
  for (let row = sheetSelection.minRow; row <= sheetSelection.maxRow; row += 1) {
    const values = [];
    for (let col = sheetSelection.minCol; col <= sheetSelection.maxCol; col += 1) {
      const cell = sheetCellAt(row, col);
      values.push(cell ? sheetCellCopyValue(cell) : '');
    }
    lines.push(values.join('\t'));
  }
  event.clipboardData.setData('text/plain', lines.join('\n'));
  event.preventDefault();
}
function parseSheetClipboard(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t'));
}
function normalizePastedValue(value, input) {
  let text = String(value || '').trim();
  if (input.type === 'number') {
    text = text.replace(/[０-９．，－]/g, (char) => {
      const map = { '．': '.', '，': ',', '－': '-' };
      return map[char] || String.fromCharCode(char.charCodeAt(0) - 0xFEE0);
    }).replace(/[¥￥,\s]/g, '');
  }
  return text;
}
function pasteSheetSelection(event) {
  const panel = event.target.closest?.('#desktop-sheet-panel');
  if (!panel) return;
  const text = event.clipboardData?.getData('text/plain') || '';
  const matrix = parseSheetClipboard(text);
  if (!matrix.length || !matrix.some((row) => row.some((value) => value !== ''))) return;
  const activeCell = event.target.closest?.('[data-sheet-cell]')
    || document.activeElement?.closest?.('[data-sheet-cell]')
    || document.querySelector('#desktop-sheet-panel .desktop-sheet-cell-anchor')
    || (sheetSelection ? sheetCellAt(sheetSelection.minRow, sheetSelection.minCol) : null);
  if (!activeCell) return;
  event.preventDefault();
  const startRow = Number(activeCell.dataset.rowIndex);
  const startCol = Number(activeCell.dataset.colIndex);
  const changedRows = new Set();
  let lastCell = activeCell;
  matrix.forEach((sourceRow, rowOffset) => {
    sourceRow.forEach((value, colOffset) => {
      const cell = sheetCellAt(startRow + rowOffset, startCol + colOffset);
      if (!cell) return;
      lastCell = cell;
      const input = cell.querySelector('[data-sheet-field]');
      if (!input || input.readOnly || input.disabled) return;
      input.value = normalizePastedValue(value, input);
      changedRows.add(input.closest('[data-sheet-row]'));
    });
  });
  changedRows.forEach((row) => {
    updateDesktopSheetRowTotals(row);
    saveDesktopSheetRow(row);
  });
  setSheetSelection(activeCell, lastCell);
}
function renderSubScreen() {
  const body = document.getElementById('sub-body');
  const monthlySubs = monthEntries().filter((entry) => entry.type === 'sub');
  const groups = {};
  monthlySubs.forEach((entry) => {
    const name = entry.workerName || '名称未入力';
    if (!groups[name]) groups[name] = { days: 0, total: 0, pay: 0, diff: 0, companies: new Set(), entries: [] };
    const calc = calcEntry(entry);
    groups[name].days += calc.qty; groups[name].total += calc.subtotal; groups[name].pay += calc.subcontractPay; groups[name].diff += calc.subcontractDiff; groups[name].entries.push(entry); if (entry.company) groups[name].companies.add(entry.company);
  });
  const people = Object.entries(groups).sort((a, b) => b[1].pay - a[1].pay);
  const hidden = !state.settings.showSales;
  if (!people.length) { body.innerHTML = `<div class="sub-total-grid"><div class="sub-stat"><div class="k">外注人数</div><div class="v">0人</div></div><div class="sub-stat"><div class="k">支払合計</div><div class="v">${yen(0, hidden)}</div></div></div><div class="empty"><div class="icon">👷</div><div>外注の記録はまだありません</div><p>右下の＋から追加できます。</p></div>`; return; }
  const totalPay = people.reduce((sum, [, info]) => sum + info.pay, 0);
  const totalDiff = people.reduce((sum, [, info]) => sum + info.diff, 0);
  const totalDays = people.reduce((sum, [, info]) => sum + info.days, 0);
  body.innerHTML = `<div class="sub-total-grid"><div class="sub-stat"><div class="k">外注人数</div><div class="v">${people.length}人</div></div><div class="sub-stat"><div class="k">支払合計</div><div class="v ${hidden ? 'hidden-amount' : ''}">${yen(totalPay, hidden)}</div></div><div class="sub-stat"><div class="k">差額合計</div><div class="v ${hidden ? 'hidden-amount' : ''}">${yen(totalDiff, hidden)}</div></div><div class="sub-stat"><div class="k">人工合計</div><div class="v">${qtyLabel(totalDays)}</div></div></div><div class="btn-row" style="padding:0 16px 10px"><button class="btn-primary" data-export-sub-payments>支払いCSV出力</button></div>${people.map(([name, info]) => `<div class="sub-card"><div class="sub-card-hd"><div><div class="sub-card-name">${escapeHtml(name)}</div><div class="sub-card-sub">${[...info.companies].join(' / ') || '会社未入力'}</div></div><div><div class="sub-card-amt ${hidden ? 'hidden-amount' : ''}">${yen(info.pay, hidden)}</div><div class="sub-card-meta">${qtyLabel(info.days)}人工 / 差額 ${yen(info.diff, hidden)}</div></div></div><div class="sub-card-foot">${info.entries.map((entry) => { const calc = calcEntry(entry); return `<span class="etag">${fmtDateJP(entry.date)} ${escapeHtml(entry.site || '現場')} 支払 ${yen(calc.subcontractPay, hidden)}</span>`; }).join('')}</div></div>`).join('')}`;
}
const DEMEN_EXPENSE_LABELS = ['交通費', '駐車場代', '宿泊代', 'ガソリン代', '資材等', '他諸経費'];
function invoiceDateLabel() {
  const end = fromYmd(companyBillingRange(selectedCompany).end);
  return `${end.getFullYear()}年${end.getMonth() + 1}月${end.getDate()}日`;
}
function entriesForInvoiceCompany() {
  return entriesForInvoiceCompanyName(selectedCompany);
}
const DEMEN_COL_WIDTHS = [34, 210, 44, 70, 72, 54, 78, 78, 68, 74, 68, 74, 68, 78, 82];
const DEMEN_COL_WIDTH_TOTAL = DEMEN_COL_WIDTHS.reduce((sum, width) => sum + width, 0);
function demenColgroup() {
  return `<colgroup>${DEMEN_COL_WIDTHS.map((width) => `<col style="width:${((width / DEMEN_COL_WIDTH_TOTAL) * 100).toFixed(4)}%">`).join('')}</colgroup>`;
}
function invoiceTotals(entries) {
  const rows = entries.map((entry) => ({ entry, calc: calcEntry(entry) }));
  const qty = sumBy(entries, (entry) => calcEntry(entry).qty);
  const labor = sumBy(entries, (entry) => calcEntry(entry).labor);
  const contract = sumBy(entries, (entry) => calcEntry(entry).contractAmount);
  const otHours = sumBy(entries, (entry) => calcEntry(entry).otHours);
  const overtime = sumBy(entries, (entry) => calcEntry(entry).overtime);
  const expenseColumns = DEMEN_EXPENSE_LABELS.map((label, index) => ({ label, item: expenseItems()[index] || { id: `exp${index + 1}`, label } }));
  const expenses = expenseColumns.map((col) => ({ ...col, total: sumBy(entries, (entry) => num(entry.expenses?.[col.item.id])) }));
  const expenseTotal = expenses.reduce((sum, item) => sum + item.total, 0);
  const subtotal = labor + contract + overtime;
  const tax = state.settings.invoiceEnabled ? Math.round(subtotal * (num(state.settings.taxRate) / 100)) : 0;
  return { rows, qty, labor, contract, otHours, overtime, expenses, expenseTotal, subtotal, tax, total: subtotal + tax + expenseTotal };
}
function buildInvoiceSheet(entries, totals, hidden) {
  const s = state.settings;
  const invoiceFontSize = fontSizeLevel(s.invoiceFontSize);
  const invoiceCompany = companyOfficialName(selectedCompany);
  const otRate = entries.find((entry) => calcEntry(entry).otRate)?.otRate || 0;
  const stamp = s.stampImage ? `<img class="invoice-stamp" src="${s.stampImage}" alt="印鑑">` : '';
  const senderPostal = s.postalCode ? `〒 ${escapeHtml(s.postalCode)}` : '';
  const senderAddress = s.address ? escapeHtml(s.address) : '';
  const laborGroups = [
    { label: '別紙出面表参照', entries: entries.filter((entry) => entry.billingType !== 'contract' && entry.shift !== 'night') },
    { label: '夜間', night: true, entries: entries.filter((entry) => entry.billingType !== 'contract' && entry.shift === 'night') },
  ].filter((group) => group.entries.length).flatMap((group) => {
    const rateGroups = new Map();
    group.entries.forEach((entry) => {
      const rate = calcEntry(entry).unitRate;
      const key = String(rate);
      if (!rateGroups.has(key)) rateGroups.set(key, { ...group, rate, entries: [] });
      rateGroups.get(key).entries.push(entry);
    });
    return [...rateGroups.values()];
  });
  const laborRows = laborGroups.map((group, index) => {
    const qty = sumBy(group.entries, (entry) => calcEntry(entry).qty);
    const labor = sumBy(group.entries, (entry) => calcEntry(entry).labor);
    return `<tr class="${group.night ? 'invoice-night-row' : ''}"><td>${index === 0 ? `${cursor.getMonth() + 1}月` : ''}</td><td colspan="2" class="left">${group.label}</td><td>${qty ? qtyLabel(qty) : ''}</td><td>人工</td><td class="right">${group.rate ? yenPlain(group.rate, hidden) : ''}</td><td class="right">${labor ? yenPlain(labor, hidden) : ''}</td><td></td></tr>`;
  }).join('');
  const contractRows = entries.filter((entry) => entry.billingType === 'contract' && calcEntry(entry).contractAnchor).map((entry, index) => {
    const amount = calcEntry(entry).contractAmount;
    return `<tr class="invoice-contract-row"><td>${!laborRows && index === 0 ? `${cursor.getMonth() + 1}月` : ''}</td><td colspan="2" class="left">${escapeHtml(entry.site || '請負工事')}／請負工事</td><td>1</td><td>式</td><td class="right">${yenPlain(amount, hidden)}</td><td class="right">${yenPlain(amount, hidden)}</td><td></td></tr>`;
  }).join('');
  const expenseRows = totals.expenses.map((item) => `<tr><td></td><td colspan="2" class="left">${escapeHtml(item.label)}</td><td></td><td></td><td></td><td class="right">${item.total ? yenPlain(item.total, hidden) : ''}</td><td></td></tr>`).join('');
  const blankRows = Array.from({ length: Math.max(0, 6 - (contractRows.match(/<tr/g) || []).length) }, () => '<tr class="invoice-blank-row"><td></td><td colspan="2"></td><td></td><td></td><td></td><td></td><td></td></tr>').join('');
  return `
    <div class="invoice-scroll">
      <div class="invoice-sheet invoice-size-${invoiceFontSize}" id="print-invoice-box">
        <div class="invoice-title">御　請　求　書</div>
        <div class="invoice-head-grid">
          <div class="invoice-recipient">
            <div class="invoice-to"><span>${escapeHtml(invoiceCompany)}</span><b>${escapeHtml(companyInvoiceHonorific(selectedCompany))}</b></div>
            <div class="invoice-message">　　下記のとおりご請求申し上げます</div>
            <div class="invoice-amount"><span>御請求金額</span><strong>${yen(totals.total, hidden)}</strong></div>
            <div class="invoice-tax-note">※税込</div>
          </div>
          <div class="invoice-meta-block">
            <div class="invoice-date">${invoiceDateLabel()}</div>
            <div class="invoice-period">対象期間：${escapeHtml(companyBillingPeriodLabel(selectedCompany))}</div>
            <div class="invoice-sender">
              <div class="invoice-sender-heading">
                <div class="invoice-sender-identity">
                  <strong>${escapeHtml(s.companyName || s.name || '')}</strong>
                  ${senderPostal ? `<span class="invoice-sender-postal">${senderPostal}</span>` : ''}
                  ${senderAddress ? `<span class="invoice-sender-address">${senderAddress}</span>` : ''}
                  ${s.tel ? `<span>TEL ${escapeHtml(s.tel)}</span>` : ''}
                  ${s.invoiceNo ? `<span>登録番号：${escapeHtml(s.invoiceNo)}</span>` : ''}
                </div>
                ${stamp}
              </div>
            </div>
          </div>
        </div>
        <table class="invoice-table">
          <thead><tr><th>項目</th><th colspan="2">名称・形状・寸法</th><th>数量</th><th>単位</th><th>単価</th><th>金額</th><th>備考</th></tr></thead>
          <tbody>
            ${laborRows}
            ${contractRows}
            <tr><td></td><td colspan="2" class="left">残業</td><td>${totals.otHours || ''}</td><td>h</td><td class="right">${otRate ? yenPlain(otRate, hidden) : ''}</td><td class="right">${totals.overtime ? yenPlain(totals.overtime, hidden) : ''}</td><td></td></tr>
            <tr><td></td><td colspan="2" class="right">小計</td><td></td><td></td><td></td><td class="right">${yenPlain(totals.subtotal, hidden)}</td><td></td></tr>
            <tr><td></td><td colspan="2" class="right">消費税${num(s.taxRate)}%</td><td></td><td></td><td></td><td class="right">${yenPlain(totals.tax, hidden)}</td><td></td></tr>
            <tr><td></td><td colspan="2" class="center">諸経費</td><td></td><td></td><td></td><td></td><td></td></tr>
            ${expenseRows}
            <tr><td></td><td colspan="2" class="right">小計</td><td></td><td></td><td></td><td class="right">${yenPlain(totals.expenseTotal, hidden)}</td><td></td></tr>
            ${blankRows}
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
  const contract = sumBy(dayItems, (entry) => calcEntry(entry).contractAmount);
  const otHours = sumBy(dayItems, (entry) => calcEntry(entry).otHours);
  const otRate = dayItems.find((entry) => calcEntry(entry).otRate)?.otRate || 0;
  const overtime = sumBy(dayItems, (entry) => calcEntry(entry).overtime);
  const expenses = expenseColumns.map((col) => sumBy(dayItems, (entry) => num(entry.expenses?.[col.item.id])));
  const total = labor + contract + overtime + expenses.reduce((sum, value) => sum + value, 0);
  return { dayItems, sites, qty, unitRate, labor, contract, otHours, otRate, overtime, expenses, total };
}
function mergeDemenSelfAndSubEntries(entries) {
  const groups = new Map();
  const output = [];
  entries.forEach((entry) => {
    if (entry.billingType === 'contract') {
      output.push(entry);
      return;
    }
    const calc = calcEntry(entry);
    const key = [entry.date, entry.company, entry.site, entry.shift, calc.unitRate, calc.otRate].join('\u001f');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });
  groups.forEach((items) => {
    const types = new Set(items.map((entry) => entry.type));
    if (!types.has('self') || !types.has('sub')) {
      output.push(...items);
      return;
    }
    const expenseIds = new Set(items.flatMap((entry) => Object.keys(entry.expenses || {})));
    const expenses = Object.fromEntries([...expenseIds].map((id) => [id, sumBy(items, (entry) => num(entry.expenses?.[id]))]));
    output.push({
      ...items[0],
      id: items.map((entry) => entry.id).join('+'),
      type: 'self',
      workerName: '',
      qty: sumBy(items, (entry) => calcEntry(entry).qty),
      otHours: sumBy(items, (entry) => calcEntry(entry).otHours),
      expenses,
      createdAt: items.map((entry) => entry.createdAt || '').filter(Boolean).sort()[0] || items[0].createdAt,
      updatedAt: items.map((entry) => entry.updatedAt || '').filter(Boolean).sort().at(-1) || items[0].updatedAt,
    });
  });
  return output.sort(sortEntriesForDemen);
}
function buildDemenSheet(entries, totals, hidden) {
  const expenseColumns = totals.expenses;
  const demenFontSize = fontSizeLevel(state.settings.invoiceFontSize);
  const billingRange = companyBillingRange(selectedCompany);
  const billingDates = dateList(billingRange.start, billingRange.end);
  const spansMonths = monthKey(billingRange.start) !== monthKey(billingRange.end);
  const expenseHeaders = `${DEMEN_EXPENSE_LABELS.map((label) => `<th>${escapeHtml(label)}</th>`).join('')}<th>金　額</th>`;
  const demenRow = (day, entry = null, dayRowspan = 1) => {
    const dayCell = day === null ? '' : `<td class="demen-day-cell" ${dayRowspan > 1 ? `rowspan="${dayRowspan}"` : ''}>${day}</td>`;
    if (!entry) return `<tr>${dayCell}<td class="left"></td><td></td><td class="right"></td><td class="right"></td><td></td><td class="right"></td><td class="right"></td>${expenseColumns.map(() => '<td class="right"></td>').join('')}<td class="right"></td></tr>`;
    const calc = calcEntry(entry);
    const expenses = expenseColumns.map((col) => num(entry.expenses?.[col.item.id]));
    const siteClass = entry.shift === 'night' ? 'left demen-night-site' : 'left';
    const siteLabel = entry.billingType === 'contract' ? `請負／${entry.site || '現場未入力'}` : (entry.site || '');
    return `<tr class="${entry.shift === 'night' ? 'demen-night-row' : ''} ${entry.billingType === 'contract' ? 'demen-contract-row' : ''}">${dayCell}<td class="${siteClass}">${escapeHtml(siteLabel)}</td><td>${calc.qty || ''}</td><td class="right">${calc.unitRate ? yenPlain(calc.unitRate, hidden) : ''}</td><td class="right">${calc.labor ? yenPlain(calc.labor, hidden) : ''}</td><td>${calc.otHours || ''}</td><td class="right">${calc.otRate ? yenPlain(calc.otRate, hidden) : ''}</td><td class="right">${calc.overtime ? yenPlain(calc.overtime, hidden) : ''}</td>${expenses.map((value) => `<td class="right">${value ? yenPlain(value, hidden) : ''}</td>`).join('')}<td class="right">${calc.subtotal ? yenPlain(calc.subtotal, hidden) : ''}</td></tr>`;
  };
  const bodyRows = billingDates.map((date) => {
    const parsed = fromYmd(date);
    const day = spansMonths ? `${parsed.getMonth() + 1}/${parsed.getDate()}` : parsed.getDate();
    const dayItems = mergeDemenSelfAndSubEntries(entries.filter((entry) => entry.date === date));
    return dayItems.length ? dayItems.map((entry, entryIndex) => demenRow(entryIndex === 0 ? day : null, entry, dayItems.length)).join('') : demenRow(day);
  }).join('');
  return `
    <div class="tbl-wrap demen-sheet-wrap demen-size-${demenFontSize}" id="print-demen-wrap">
      <table class="demen demen-sheet demen-size-${demenFontSize}">
        ${demenColgroup()}
        <thead>
          <tr class="demen-title-row"><th colspan="4" class="demen-title-spacer"></th><th class="demen-title-main">${cursor.getMonth() + 1}</th><th colspan="3" class="left demen-title-main">月 出面表</th><th colspan="4" class="demen-period">${escapeHtml(companyBillingPeriodLabel(selectedCompany))}</th><th class="right demen-title-name demen-title-label">氏名：</th><th colspan="2" class="demen-title-name demen-title-person">${escapeHtml(state.settings.name || '')}</th></tr>
          <tr><th>日</th><th>現場名</th><th>人工</th><th>人工単価</th><th>人工合計</th><th>残業h</th><th>残業単価</th><th>残業合計</th>${expenseHeaders}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
        <tfoot>
          <tr><td></td><td class="right">小計</td><td>${qtyLabel(totals.qty)}</td><td></td><td class="right">${yenPlain(totals.labor, hidden)}</td><td>${totals.otHours || ''}</td><td></td><td class="right">${totals.overtime ? yenPlain(totals.overtime, hidden) : ''}</td>${totals.expenses.map((item) => `<td class="right">${item.total ? yenPlain(item.total, hidden) : ''}</td>`).join('')}<td class="right">${yenPlain(totals.labor + totals.contract + totals.overtime + totals.expenseTotal, hidden)}</td></tr>
          <tr class="demen-grand-row"><td colspan="9"></td><td colspan="3" class="right">合計</td><td colspan="3" class="right">${yenPlain(totals.labor + totals.contract + totals.overtime + totals.expenseTotal, hidden)}</td></tr>
        </tfoot>
      </table>
    </div>`;
}
function annualCompanyMonths(company, year) {
  return Array.from({ length: 12 }, (_, month) => {
    const baseDate = new Date(year, month, 1);
    const range = companyBillingRange(company, baseDate);
    const entries = entriesForInvoiceCompanyName(company, baseDate);
    const totals = invoiceTotals(entries);
    const selfEntries = entries.filter((entry) => entry.type === 'self');
    const subcontractEntries = entries.filter((entry) => entry.type === 'sub');
    return {
      month,
      range,
      entries,
      totals,
      selfQty: sumBy(selfEntries, (entry) => calcEntry(entry).qty),
      subcontractQty: sumBy(subcontractEntries, (entry) => calcEntry(entry).qty),
      subcontractPay: sumBy(subcontractEntries, (entry) => calcEntry(entry).subcontractPay),
      subcontractDiff: sumBy(subcontractEntries, (entry) => calcEntry(entry).subcontractDiff),
    };
  });
}
function annualCompanyTotals(months) {
  return months.reduce((all, month) => ({
    qty: all.qty + month.totals.qty,
    selfQty: all.selfQty + month.selfQty,
    subcontractQty: all.subcontractQty + month.subcontractQty,
    labor: all.labor + month.totals.labor,
    contract: all.contract + month.totals.contract,
    overtime: all.overtime + month.totals.overtime,
    expenses: all.expenses + month.totals.expenseTotal,
    tax: all.tax + month.totals.tax,
    total: all.total + month.totals.total,
    subcontractPay: all.subcontractPay + month.subcontractPay,
    subcontractDiff: all.subcontractDiff + month.subcontractDiff,
  }), { qty: 0, selfQty: 0, subcontractQty: 0, labor: 0, contract: 0, overtime: 0, expenses: 0, tax: 0, total: 0, subcontractPay: 0, subcontractDiff: 0 });
}
function annualMonthDetailHtml(month, hidden) {
  if (!month.entries.length) return '<div class="annual-detail-empty">この締め分の取引はありません</div>';
  const rows = month.entries.map((entry) => {
    const calc = calcEntry(entry);
    const expenseText = expenseItems()
      .map((item) => ({ label: item.label, value: num(entry.expenses?.[item.id]) }))
      .filter((item) => item.value)
      .map((item) => `${item.label} ${yenPlain(item.value, hidden)}`)
      .join(' / ') || 'なし';
    return `<tr>
      <td>${escapeHtml(fmtDateJP(entry.date))}</td>
      <td>${escapeHtml(shiftLabel(entry.shift))}</td>
      <td class="left">${escapeHtml(entry.site || '現場未入力')}</td>
      <td>${escapeHtml(`${typeLabel(entry.type)}・${billingTypeLabel(entry)}`)}</td>
      <td class="left">${escapeHtml(entry.type === 'sub' ? entry.workerName || '職人名未入力' : state.settings.name || '自分')}</td>
      <td>${calc.isContract ? '請負' : qtyLabel(calc.qty)}</td>
      <td class="right">${calc.isContract ? '-' : yenPlain(calc.unitRate, hidden)}</td>
      <td class="right">${calc.otHours ? `${calc.otHours}h / ${yenPlain(calc.overtime, hidden)}` : '-'}</td>
      <td class="left">${escapeHtml(expenseText)}</td>
      <td class="right">${yenPlain(calc.subtotal, hidden)}</td>
      <td class="right">${entry.type === 'sub' ? yenPlain(calc.subcontractPay, hidden) : '-'}</td>
      <td class="right">${entry.type === 'sub' ? yenPlain(calc.subcontractDiff, hidden) : '-'}</td>
    </tr>`;
  }).join('');
  const cards = month.entries.map((entry) => {
    const calc = calcEntry(entry);
    const expenseText = expenseItems()
      .map((item) => ({ label: item.label, value: num(entry.expenses?.[item.id]) }))
      .filter((item) => item.value)
      .map((item) => `${item.label} ${yen(item.value, hidden)}`)
      .join(' / ') || '経費なし';
    return `<div class="annual-entry-card">
      <div class="annual-entry-head"><strong>${escapeHtml(fmtDateJP(entry.date))} ${escapeHtml(shiftLabel(entry.shift))}</strong><span>${escapeHtml(`${typeLabel(entry.type)}・${billingTypeLabel(entry)}`)}</span></div>
      <div class="annual-entry-site">${escapeHtml(entry.site || '現場未入力')}</div>
      <div class="annual-entry-meta">${entry.type === 'sub' ? escapeHtml(entry.workerName || '職人名未入力') : escapeHtml(state.settings.name || '自分')} / ${calc.isContract ? (calc.contractAnchor ? `請負 ${yen(calc.contractAmount, hidden)}（計上）` : '請負（作業日）') : `${qtyLabel(calc.qty)}人工 / 単価 ${yen(calc.unitRate, hidden)}`}</div>
      <div class="annual-entry-meta">残業 ${calc.otHours ? `${calc.otHours}h ${yen(calc.overtime, hidden)}` : 'なし'} / ${escapeHtml(expenseText)}</div>
      <div class="annual-entry-money"><span>売上 ${yen(calc.subtotal, hidden)}</span>${entry.type === 'sub' ? `<span>支払 ${yen(calc.subcontractPay, hidden)} / 差額 ${yen(calc.subcontractDiff, hidden)}</span>` : ''}</div>
    </div>`;
  }).join('');
  return `<div class="annual-detail-table-wrap"><table class="annual-detail-table"><thead><tr><th>日付</th><th>昼夜</th><th>現場</th><th>区分</th><th>職人名</th><th>人工</th><th>単価</th><th>残業</th><th>経費</th><th>売上</th><th>外注支払</th><th>差額</th></tr></thead><tbody>${rows}</tbody></table></div><div class="annual-entry-list">${cards}</div>`;
}
function renderAnnualTransactions(company, hidden) {
  const year = cursor.getFullYear();
  const months = annualCompanyMonths(company, year);
  const total = annualCompanyTotals(months);
  const activeMonth = expandedAnnualMonth === '' ? null : months[Number(expandedAnnualMonth)];
  const desktopRows = months.map((month) => `<tr class="annual-month-row ${activeMonth?.month === month.month ? 'active' : ''}" data-annual-month="${month.month}">
    <td>${month.month + 1}月</td><td>${escapeHtml(fmtDateJP(month.range.start))}<br>${escapeHtml(fmtDateJP(month.range.end))}</td>
    <td>${qtyLabel(month.totals.qty)}</td><td>${qtyLabel(month.selfQty)}</td><td>${qtyLabel(month.subcontractQty)}</td>
    <td class="right">${yenPlain(month.totals.labor, hidden)}</td><td class="right">${yenPlain(month.totals.contract, hidden)}</td><td class="right">${yenPlain(month.totals.overtime, hidden)}</td><td class="right">${yenPlain(month.totals.expenseTotal, hidden)}</td><td class="right">${yenPlain(month.totals.tax, hidden)}</td><td class="right strong">${yenPlain(month.totals.total, hidden)}</td><td class="right">${yenPlain(month.subcontractPay, hidden)}</td><td class="right">${yenPlain(month.subcontractDiff, hidden)}</td>
  </tr>`).join('');
  const cards = months.map((month) => `<button class="annual-month-card ${activeMonth?.month === month.month ? 'active' : ''}" type="button" data-annual-month="${month.month}">
    <span class="annual-month-card-head"><strong>${month.month + 1}月締め分</strong><small>${escapeHtml(fmtDateJP(month.range.start))}〜${escapeHtml(fmtDateJP(month.range.end))}</small></span>
    <span class="annual-month-card-grid"><span>総人工 <b>${qtyLabel(month.totals.qty)}</b></span><span>人工 / 請負売上 <b>${yen(month.totals.labor, hidden)} / ${yen(month.totals.contract, hidden)}</b></span><span>請求合計 <b>${yen(month.totals.total, hidden)}</b></span><span>外注支払 / 差額 <b>${yen(month.subcontractPay, hidden)} / ${yen(month.subcontractDiff, hidden)}</b></span></span>
  </button>`).join('');
  return `<div class="annual-summary-grid">
      <div class="annual-stat"><span>年間請求</span><strong>${yen(total.total, hidden)}</strong><small>人工 ${yen(total.labor, hidden)} / 請負 ${yen(total.contract, hidden)}</small></div>
      <div class="annual-stat"><span>総人工</span><strong>${qtyLabel(total.qty)}</strong><small>自分 ${qtyLabel(total.selfQty)} / 外注 ${qtyLabel(total.subcontractQty)}</small></div>
      <div class="annual-stat"><span>外注支払</span><strong>${yen(total.subcontractPay, hidden)}</strong></div>
      <div class="annual-stat"><span>外注差額</span><strong>${yen(total.subcontractDiff, hidden)}</strong></div>
    </div>
    <div class="annual-table-wrap"><table class="annual-table"><thead><tr><th>月</th><th>対象期間</th><th>総人工</th><th>自分</th><th>外注</th><th>人工売上</th><th>請負売上</th><th>残業</th><th>経費</th><th>消費税</th><th>請求合計</th><th>外注支払</th><th>外注差額</th></tr></thead><tbody>${desktopRows}</tbody><tfoot><tr><th colspan="2">年間合計</th><th>${qtyLabel(total.qty)}</th><th>${qtyLabel(total.selfQty)}</th><th>${qtyLabel(total.subcontractQty)}</th><th class="right">${yenPlain(total.labor, hidden)}</th><th class="right">${yenPlain(total.contract, hidden)}</th><th class="right">${yenPlain(total.overtime, hidden)}</th><th class="right">${yenPlain(total.expenses, hidden)}</th><th class="right">${yenPlain(total.tax, hidden)}</th><th class="right">${yenPlain(total.total, hidden)}</th><th class="right">${yenPlain(total.subcontractPay, hidden)}</th><th class="right">${yenPlain(total.subcontractDiff, hidden)}</th></tr></tfoot></table></div>
    <div class="annual-month-list">${cards}</div>
    ${activeMonth ? `<section class="annual-detail"><div class="annual-detail-head"><div><strong>${activeMonth.month + 1}月締め分の明細</strong><span>${escapeHtml(companyBillingPeriodLabel(company, new Date(year, activeMonth.month, 1)))}</span></div><button type="button" data-annual-month="${activeMonth.month}" aria-label="明細を閉じる">×</button></div>${annualMonthDetailHtml(activeMonth, hidden)}</section>` : ''}`;
}
function allCompanyAnnualMonths(year) {
  const companies = getAnnualInvoiceCompanies(year);
  const byCompany = companies.map((company) => ({ company, months: annualCompanyMonths(company, year) }));
  return Array.from({ length: 12 }, (_, month) => {
    const companyMonths = byCompany.map((item) => ({ company: item.company, ...item.months[month] })).filter((item) => item.entries.length);
    return { month, companyMonths, totals: annualCompanyTotals(companyMonths) };
  });
}
function renderAllCompanyAnnualTransactions(hidden) {
  const year = cursor.getFullYear();
  const months = allCompanyAnnualMonths(year);
  const total = annualCompanyTotals(months.flatMap((month) => month.companyMonths));
  const activeMonth = expandedAnnualMonth === '' ? null : months[Number(expandedAnnualMonth)];
  const desktopRows = months.map((month) => `<tr class="annual-month-row ${activeMonth?.month === month.month ? 'active' : ''}" data-annual-month="${month.month}">
    <td>${month.month + 1}月</td><td>各社締め日基準</td><td>${qtyLabel(month.totals.qty)}</td><td>${qtyLabel(month.totals.selfQty)}</td><td>${qtyLabel(month.totals.subcontractQty)}</td>
    <td class="right">${yenPlain(month.totals.labor, hidden)}</td><td class="right">${yenPlain(month.totals.contract, hidden)}</td><td class="right">${yenPlain(month.totals.overtime, hidden)}</td><td class="right">${yenPlain(month.totals.expenses, hidden)}</td><td class="right">${yenPlain(month.totals.tax, hidden)}</td><td class="right strong">${yenPlain(month.totals.total, hidden)}</td><td class="right">${yenPlain(month.totals.subcontractPay, hidden)}</td><td class="right">${yenPlain(month.totals.subcontractDiff, hidden)}</td>
  </tr>`).join('');
  const cards = months.map((month) => `<button class="annual-month-card ${activeMonth?.month === month.month ? 'active' : ''}" type="button" data-annual-month="${month.month}">
    <span class="annual-month-card-head"><strong>${month.month + 1}月締め分</strong><small>${month.companyMonths.length}社</small></span>
    <span class="annual-month-card-grid"><span>総人工 <b>${qtyLabel(month.totals.qty)}</b></span><span>人工 / 請負売上 <b>${yen(month.totals.labor, hidden)} / ${yen(month.totals.contract, hidden)}</b></span><span>請求合計 <b>${yen(month.totals.total, hidden)}</b></span><span>外注支払 / 差額 <b>${yen(month.totals.subcontractPay, hidden)} / ${yen(month.totals.subcontractDiff, hidden)}</b></span></span>
  </button>`).join('');
  const detail = activeMonth ? activeMonth.companyMonths.map((item) => `<details class="annual-company-detail">
    <summary><span><strong>${escapeHtml(companySheetName(item.company))}</strong><small>${escapeHtml(fmtDateJP(item.range.start))}〜${escapeHtml(fmtDateJP(item.range.end))}</small></span><b>${yen(item.totals.total, hidden)}</b></summary>
    ${annualMonthDetailHtml(item, hidden)}
  </details>`).join('') : '';
  return `<div class="annual-summary-grid">
      <div class="annual-stat"><span>全社年間請求</span><strong>${yen(total.total, hidden)}</strong><small>人工 ${yen(total.labor, hidden)} / 請負 ${yen(total.contract, hidden)}</small></div>
      <div class="annual-stat"><span>総人工</span><strong>${qtyLabel(total.qty)}</strong><small>自分 ${qtyLabel(total.selfQty)} / 外注 ${qtyLabel(total.subcontractQty)}</small></div>
      <div class="annual-stat"><span>外注支払</span><strong>${yen(total.subcontractPay, hidden)}</strong></div>
      <div class="annual-stat"><span>外注差額</span><strong>${yen(total.subcontractDiff, hidden)}</strong></div>
    </div>
    <div class="annual-table-wrap"><table class="annual-table"><thead><tr><th>月</th><th>集計基準</th><th>総人工</th><th>自分</th><th>外注</th><th>人工売上</th><th>請負売上</th><th>残業</th><th>経費</th><th>消費税</th><th>請求合計</th><th>外注支払</th><th>外注差額</th></tr></thead><tbody>${desktopRows}</tbody><tfoot><tr><th colspan="2">全社年間合計</th><th>${qtyLabel(total.qty)}</th><th>${qtyLabel(total.selfQty)}</th><th>${qtyLabel(total.subcontractQty)}</th><th class="right">${yenPlain(total.labor, hidden)}</th><th class="right">${yenPlain(total.contract, hidden)}</th><th class="right">${yenPlain(total.overtime, hidden)}</th><th class="right">${yenPlain(total.expenses, hidden)}</th><th class="right">${yenPlain(total.tax, hidden)}</th><th class="right">${yenPlain(total.total, hidden)}</th><th class="right">${yenPlain(total.subcontractPay, hidden)}</th><th class="right">${yenPlain(total.subcontractDiff, hidden)}</th></tr></tfoot></table></div>
    <div class="annual-month-list">${cards}</div>
    ${activeMonth ? `<section class="annual-detail"><div class="annual-detail-head"><div><strong>${activeMonth.month + 1}月締め分の会社別明細</strong><span>各社の締め日を基準に集計</span></div><button type="button" data-annual-month="${activeMonth.month}" aria-label="明細を閉じる">×</button></div>${detail || '<div class="annual-detail-empty">この月の取引はありません</div>'}</section>` : ''}`;
}
function renderInvoiceScreen() {
  const tabs = document.getElementById('co-tabs');
  const body = document.getElementById('inv-body');
  document.querySelectorAll('[data-invoice-view]').forEach((button) => button.classList.toggle('active', button.dataset.invoiceView === invoiceViewMode));
  const companies = pickSelectedCompany();
  if (!companies.length) { tabs.innerHTML = ''; body.innerHTML = `<div class="empty"><div>この${invoiceViewMode === 'annual' ? '年' : '月'}の請求対象はまだありません</div><p>自分または外注の予定を入力すると会社別に表示されます。</p></div>`; return; }
  tabs.innerHTML = companies.map((company) => `<button class="co-chip ${company === selectedCompany ? 'active' : ''}" data-company="${escapeHtml(company)}">${company === ALL_COMPANIES_KEY ? '全体' : escapeHtml(companySheetName(company))}</button>`).join('');
  const hidden = !state.settings.showSales;
  if (invoiceViewMode === 'annual') {
    body.innerHTML = selectedCompany === ALL_COMPANIES_KEY ? renderAllCompanyAnnualTransactions(hidden) : renderAnnualTransactions(selectedCompany, hidden);
    return;
  }
  const entries = entriesForInvoiceCompany();
  const totals = invoiceTotals(entries);
  const invoiceFontSize = fontSizeLevel(state.settings.invoiceFontSize);
  body.innerHTML = `<div class="invoice-tool-row"><span class="billing-period-label">${escapeHtml(companyBillingPeriodLabel(selectedCompany))}</span><label>請求書フォント<select id="invoice-font-size-select">${fontSizeOptions(invoiceFontSize)}</select></label></div><div class="btn-row invoice-actions" style="padding:0 16px 10px"><button class="btn-primary" data-print-invoice>請求書印刷</button><button class="btn-gold" data-print-demen>出面表印刷</button><button class="btn-secondary" data-export-invoice>請求CSV</button><button class="btn-secondary" data-export-demen>出面CSV</button></div>${buildInvoiceSheet(entries, totals, hidden)}${buildDemenSheet(entries, totals, hidden)}`;
}
function syncStatusText() {
  const pending = loadSyncPending();
  if (!navigator.onLine) return pending.pending ? 'オフライン・未送信あり' : 'オフライン';
  if (firebaseSyncInFlight) return 'NINQクラウド同期中';
  if (firebaseUser) return state.settings.googleSyncEnabled ? 'NINQクラウドON' : 'ログイン済み';
  if (window.NinqFirebaseCloud) return state.settings.googleSyncEnabled ? 'ログイン待ち' : '未ログイン';
  if (driveSyncInFlight) return '同期中';
  if (hasGoogleAccessToken(GOOGLE_DRIVE_SCOPE) || hasGoogleAccessToken(GOOGLE_CALENDAR_SCOPE)) return state.settings.googleSyncEnabled ? '自動同期ON' : 'ログイン済み';
  if (state.settings.googleClientId) return state.settings.googleSyncEnabled ? '自動同期ON・再ログイン待ち' : '設定済み';
  return '未設定';
}
function renderSyncScreen() {
  const month = monthEntries();
  const sub = document.getElementById('sync-sub'); if (sub) sub.textContent = '出力と引き継ぎ';
  const syncTopTitle = document.querySelector('#sc-sync .topbar-title'); if (syncTopTitle) syncTopTitle.textContent = '同期・連携';
  if (sub) sub.textContent = firebaseUser ? '自動同期中' : '初回ログインのみ';
  const calendarSection = document.querySelector('#sc-sync .sync-section:nth-of-type(1)');
  const cloudSection = document.querySelector('#sc-sync .sync-section:nth-of-type(2)');
  if (cloudSection) {
    cloudSection.classList.add('cloud-sync-section');
    let note = cloudSection.querySelector('.cloud-auto-note');
    if (!note) {
      note = document.createElement('div');
      note.className = 'cloud-auto-note';
      cloudSection.querySelector('.sync-section-head')?.after(note);
    }
    note.innerHTML = firebaseUser
      ? '<strong>自動同期が有効です</strong><span>アプリ起動時にクラウド確認、予定や設定の変更後に自動保存します。</span>'
      : '<strong>初回だけログインしてください</strong><span>ログイン後はPC・スマホ間の同期を自動で行います。</span>';
  }
  const syncTitle = document.querySelector('#sc-sync .sync-section:nth-of-type(2) .sync-section-title'); if (syncTitle) syncTitle.textContent = 'NINQクラウド同期';
  const syncDesc = document.querySelector('#sc-sync .sync-section:nth-of-type(2) .sync-section-sub'); if (syncDesc) syncDesc.textContent = '初回だけGoogleログイン。以後はFirebaseへ自動保存します';
  const clientLabel = document.querySelector('label[for="google-client-id"]'); if (clientLabel) clientLabel.textContent = 'Googleカレンダー出力用クライアントID';
  const clientPlaceholder = document.getElementById('google-client-id'); if (clientPlaceholder) clientPlaceholder.placeholder = 'カレンダー出力を使う場合のみ';
  const autoSyncLabel = document.getElementById('google-auto-sync')?.closest('label'); if (autoSyncLabel && autoSyncLabel.lastChild) autoSyncLabel.lastChild.textContent = ' NINQクラウド自動同期を使う';
  const conflictLabel = document.querySelector('label[for="google-conflict-mode"]'); if (conflictLabel) conflictLabel.textContent = 'PC/スマホの両方で変更した時';
  const loginButton = document.getElementById('google-login-btn'); if (loginButton) { loginButton.textContent = firebaseUser ? 'ログイン済み' : 'NINQクラウドにログイン'; loginButton.disabled = !!firebaseUser; loginButton.classList.toggle('cloud-login-done', !!firebaseUser); }
  const sendButton = document.getElementById('drive-send-device-btn'); if (sendButton) sendButton.textContent = 'この端末から送る';
  const receiveButton = document.getElementById('drive-receive-device-btn'); if (receiveButton) receiveButton.textContent = 'NINQクラウドから受け取る';
  const saveSyncButton = document.getElementById('save-google-settings-btn'); if (saveSyncButton) saveSyncButton.textContent = 'Googleカレンダー設定を保存';
  const clientField = document.getElementById('google-client-id')?.closest('.sync-field');
  const conflictField = document.getElementById('google-conflict-mode')?.closest('.sync-field');
  autoSyncLabel?.classList.add('cloud-hidden-setting');
  conflictField?.classList.add('cloud-hidden-setting');
  clientField?.classList.remove('cloud-hidden-setting');
  saveSyncButton?.classList.remove('cloud-hidden-setting');
  if (calendarSection && clientField && saveSyncButton) {
    let authDetails = calendarSection.querySelector('.calendar-auth-details');
    if (!authDetails) {
      authDetails = document.createElement('details');
      authDetails.className = 'calendar-auth-details';
      authDetails.innerHTML = '<summary>Googleカレンダー接続設定</summary><div class="calendar-auth-fields"></div>';
      calendarSection.appendChild(authDetails);
    }
    const authFields = authDetails.querySelector('.calendar-auth-fields');
    if (authFields && !authFields.contains(clientField)) authFields.appendChild(clientField);
    if (authFields && !authFields.contains(saveSyncButton)) authFields.appendChild(saveSyncButton);
    const configured = !!String(state.settings.googleClientId || '').trim();
    const summary = authDetails.querySelector('summary');
    if (summary) summary.textContent = configured ? 'Googleカレンダー接続設定' : 'Googleカレンダー接続設定が必要です';
    if (!configured) authDetails.open = true;
  }
  if (cloudSection && sendButton && receiveButton) {
    let manual = cloudSection.querySelector('.cloud-manual-details');
    if (!manual) {
      manual = document.createElement('details');
      manual.className = 'cloud-manual-details';
      manual.innerHTML = '<summary>非常用の手動操作</summary><div class="cloud-manual-actions"></div>';
      cloudSection.appendChild(manual);
    }
    const manualActions = manual.querySelector('.cloud-manual-actions');
    if (manualActions && !manualActions.contains(sendButton)) manualActions.appendChild(sendButton);
    if (manualActions && !manualActions.contains(receiveButton)) manualActions.appendChild(receiveButton);
  }
  const rangeStart = document.getElementById('google-export-start');
  const rangeEnd = document.getElementById('google-export-end');
  if (rangeStart && !rangeStart.value) rangeStart.value = toYmd(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
  if (rangeEnd && !rangeEnd.value) rangeEnd.value = toYmd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
  const rangeValues = calendarRangeValues();
  const calendarCount = document.getElementById('calendar-export-count'); if (calendarCount) calendarCount.textContent = `${calendarRangeGroups(rangeValues.start, rangeValues.end).length}件`;
  const backupStatus = document.getElementById('backup-status'); if (backupStatus) backupStatus.textContent = `${state.entries.length}予定`;
  const clientInput = document.getElementById('google-client-id'); if (clientInput && !clientInput.value) clientInput.value = state.settings.googleClientId || '';
  const autoSync = document.getElementById('google-auto-sync'); if (autoSync) autoSync.checked = !!state.settings.googleSyncEnabled;
  const conflictMode = document.getElementById('google-conflict-mode'); if (conflictMode) conflictMode.value = state.settings.googleConflictMode || 'newer';
  if (conflictMode) {
    const newer = conflictMode.querySelector('option[value="newer"]'); if (newer) newer.textContent = '新しい方を採用';
    const confirmOption = conflictMode.querySelector('option[value="confirm"]'); if (confirmOption) confirmOption.textContent = '確認して選ぶ';
  }
  const driveStatus = document.getElementById('drive-sync-status'); if (driveStatus) driveStatus.textContent = syncStatusText();
  const pending = loadSyncPending();
  const log = document.getElementById('sync-log'); if (log && !log.textContent) log.textContent = pending.pending ? '未送信の変更があります。オンライン復帰後に自動送信します' : '初回だけGoogleログインすると、以後は起動時取得・保存時送信を自動で試します';
}
function renderSettings() {
  const s = state.settings;
  const map = { 'st-name': s.name, 'st-postal': s.postalCode, 'st-addr': s.address, 'st-tel': s.tel, 'st-co': s.companyName, 'st-bank': s.bank, 'st-branch': s.branch, 'st-accno': s.accountNo, 'st-accname': s.accountName, 'st-invno': s.invoiceNo };
  Object.entries(map).forEach(([id, value]) => { const el = document.getElementById(id); if (el) el.value = value ?? ''; });
  document.getElementById('st-tax').value = String(s.taxRate);
  const presets = normalizeCompanyRates(s.companyRates, s.companies);
  const newClosingDay = document.getElementById('st-company-closing-new');
  if (newClosingDay) newClosingDay.innerHTML = closingDayOptions(newClosingDay.value);
  document.getElementById('st-companies').value = presets.map((item) => item.name).join('\n');
  const companyPresetStore = document.getElementById('st-company-presets'); if (companyPresetStore) companyPresetStore.value = JSON.stringify(presets);
  document.getElementById('st-expenses').value = expenseItems().map((item) => item.label).join('\n');
  document.getElementById('tgl-inv').classList.toggle('on', !!s.invoiceEnabled);
  document.getElementById('tgl-subcontract')?.classList.toggle('on', subcontractEnabled());
  const salesParts = { ...DEFAULT_SETTINGS.salesTotalParts, ...(s.salesTotalParts || {}) };
  document.getElementById('tgl-sales-labor')?.classList.toggle('on', !!salesParts.labor);
  document.getElementById('tgl-sales-overtime')?.classList.toggle('on', !!salesParts.overtime);
  document.getElementById('tgl-sales-expenses')?.classList.toggle('on', !!salesParts.expenses);
  const uiSize = document.getElementById('st-ui-size'); if (uiSize) uiSize.value = fontSizeLevel(s.uiSize);
  const fontChoice = document.getElementById('st-font-choice'); if (fontChoice) fontChoice.value = s.fontChoice || DEFAULT_SETTINGS.fontChoice;
  const invoiceFontSize = document.getElementById('st-invoice-font-size'); if (invoiceFontSize) invoiceFontSize.value = fontSizeLevel(s.invoiceFontSize);
  document.getElementById('inv-no-row').classList.toggle('hidden', !s.invoiceEnabled);
  const stampPreview = document.getElementById('stamp-preview');
  if (stampPreview) {
    stampPreview.src = s.stampImage || '';
    stampPreview.classList.toggle('hidden', !s.stampImage);
  }
  renderSettingListEditors();
}
function createDefaultEntry(type, date) {
  return { id: '', date, type, shift: 'day', billingType: 'labor', contractAmount: 0, company: '', site: '', workerName: '', qty: 1, unitRate: '', paymentAmount: '', paymentAmountSet: false, otHours: 0, otRate: '', expenses: Object.fromEntries(expenseItems().map((item) => [item.id, 0])), notes: '', invoiceMode: 'with' };
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
  if (document.querySelector('[data-billing-type].active')?.dataset.billingType === 'contract') return num(document.getElementById('f-contract-amount')?.value);
  const qty = qtyValue(document.getElementById('f-qty')?.value);
  const unitRate = num(document.getElementById('f-rate')?.value);
  const otHours = num(document.getElementById('f-ot-hours')?.value);
  const otRate = num(document.getElementById('f-ot-rate')?.value);
  return qty * unitRate + otHours * otRate;
}
function updateBillingTypeFields() {
  const isContract = document.querySelector('[data-billing-type].active')?.dataset.billingType === 'contract';
  document.getElementById('labor-qty-wrap')?.classList.toggle('hidden', isContract);
  document.getElementById('labor-rate-wrap')?.classList.toggle('hidden', isContract);
  document.getElementById('contract-amount-wrap')?.classList.toggle('hidden', !isContract);
  updateSubcontractDiff();
}
function updateSubcontractDiff() {
  const wrap = document.getElementById('sub-pay-wrap');
  if (!wrap) return;
  const isSub = document.querySelector('[data-entry-type].active')?.dataset.entryType === 'sub';
  wrap.classList.toggle('hidden', !isSub);
  if (!isSub) return;
  const subtotal = currentFormSubtotal();
  const paymentInput = document.getElementById('f-payment-amount');
  const paymentIsSet = paymentInput && paymentInput.value.trim() !== '';
  const payment = num(paymentInput?.value);
  const diff = subtotal - (paymentIsSet ? payment : subtotal);
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
  const isContract = entry.billingType === 'contract';
  const expenseFields = modalExpenseItems().map((item) => `<div class="field"><label>${escapeHtml(item.label)}</label><input type="number" min="0" step="1" data-expense-id="${item.id}" value="${num(entry.expenses?.[item.id]) || ''}"></div>`).join('');
  const typeButtons = `<button class="type-btn ${entry.type === 'self' ? 'active' : ''}" data-entry-type="self" type="button">自分</button>${subcontractEnabled() || entry.type === 'sub' ? `<button class="type-btn ${entry.type === 'sub' ? 'active' : ''}" data-entry-type="sub" type="button">外注職人</button>` : ''}`;
  const billingButtons = `<button class="type-btn ${!isContract ? 'active' : ''}" data-billing-type="labor" type="button">人工</button><button class="type-btn ${isContract ? 'active' : ''}" data-billing-type="contract" type="button">請負</button>`;
  const entryCompany = normalizeCompanyInputName(entry.company);
  const companyChoices = companyOptionPresets();
  const companyOptionsHtml = companyChoices.map((preset) => `<option value="${escapeHtml(preset.name)}" ${preset.name === entryCompany ? 'selected' : ''}>${escapeHtml(preset.sheetName || preset.name)}</option>`).join('');
  const companyInputValue = companyPresetByAnyName(entry.company)?.sheetName || entry.company;
  const companyPickBlock = `<div class="company-combo"><select id="f-company-select"><option value="">選択</option>${companyOptionsHtml}</select><input id="f-company" value="${escapeHtml(companyInputValue)}" placeholder="法人格なしの会社名を入力できます"></div>`;
  document.getElementById('modal-title').textContent = id ? '予定を編集' : '予定を追加';
  document.getElementById('modal-body').innerHTML = `
    <div class="type-sel">${typeButtons}</div>
    <form id="entry-form">
      <div class="field"><label>売上方式</label><div class="type-sel billing-type-sel">${billingButtons}</div></div>
      <div class="field-r2">
        <div class="field"><label>開始日</label><input id="f-date" class="date-picker-input" type="text" inputmode="none" readonly data-date-picker value="${escapeHtml(startValue)}"></div>
        <div class="field"><label>終了日</label><input id="f-end-date" class="date-picker-input" type="text" inputmode="none" readonly data-date-picker value="${escapeHtml(endValue)}"></div>
      </div>
      <div class="range-exclude-wrap" id="range-exclude-wrap"></div>
      ${isSub ? `<div class="field" id="worker-wrap"><label>職人名</label><input id="f-worker" value="${escapeHtml(entry.workerName)}" placeholder="佐藤大工"></div>` : `<div class="field hidden" id="worker-wrap"><label>職人名</label><input id="f-worker" value="${escapeHtml(entry.workerName)}"></div>`}
      <div class="field"><label>会社名</label>${companyPickBlock}</div>
      <div class="field"><label>現場名</label><input id="f-site" value="${escapeHtml(entry.site)}" placeholder="空欄でも保存できます"></div>
      <div class="field-r2"><div class="field"><label>勤務区分</label><select id="f-shift"><option value="day" ${entry.shift === 'day' ? 'selected' : ''}>日勤</option><option value="night" ${entry.shift === 'night' ? 'selected' : ''}>夜勤</option><option value="trip" ${entry.shift === 'trip' ? 'selected' : ''}>出張</option></select></div><div class="field ${isContract ? 'hidden' : ''}" id="labor-qty-wrap"><label>人工</label><input id="f-qty" type="number" min="0" step="0.5" value="${entry.qty}"></div></div>
      <div class="field-r3 ${isContract ? 'hidden' : ''}" id="labor-rate-wrap"><div class="field"><label>単価</label><input id="f-rate" type="number" min="0" step="1" value="${rateFieldValue(entry.unitRate)}"></div><div class="field"><label>残業時間</label><input id="f-ot-hours" type="number" min="0" step="0.5" value="${num(entry.otHours) || ''}"></div><div class="field"><label>残業単価</label><input id="f-ot-rate" type="number" min="0" step="1" value="${rateFieldValue(entry.otRate)}"></div></div>
      <div class="field ${isContract ? '' : 'hidden'}" id="contract-amount-wrap"><label>請負金額（仕事全体）</label><input id="f-contract-amount" type="number" min="0" step="1" value="${num(entry.contractAmount) || ''}" placeholder="未確定の場合は空欄でも保存できます"><small class="field-note">複数日の場合は最終日に1回だけ売上へ計上します</small></div>
      <div class="${isSub ? '' : 'hidden'}" id="sub-pay-wrap">
        <div class="field-r2"><div class="field"><label>支払金額</label><input id="f-payment-amount" type="number" min="0" step="1" value="${optionalMoneyFieldValue(entry.paymentAmount, entry.paymentAmountSet)}" placeholder="実際に払う金額"></div><div class="field"><label>差額</label><input id="sub-diff-preview" readonly value=""></div></div>
        <div class="sub-pay-note">売上計算 <strong id="sub-sales-preview">¥0</strong> との差額を表示します</div>
      </div>
      <div class="sec-hd" style="padding:0 0 8px">経費</div><div class="field-r2">${expenseFields}</div>
      <div class="field"><label>メモ</label><textarea id="f-notes" placeholder="注意点やメモ">${escapeHtml(entry.notes)}</textarea></div>
      <div class="btn-row entry-actions"><button class="btn-secondary" type="button" id="cancel-entry-btn">キャンセル</button><button class="btn-primary" type="submit">保存</button></div>
    </form>`;
  renderRangeExclusions(editRange?.excludedDates || []);
  updateBillingTypeFields();
  updateSubcontractDiff();
  document.getElementById('modal-bg').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-bg').classList.remove('open');
  editingId = null;
}
function applyCompanyRate(name) {
  const preset = companyPresetByName(name) || companyPresetByAnyName(name);
  if (!preset) return;
  const shift = document.getElementById('f-shift')?.value || 'day';
  const rate = rateForPresetShift(preset, shift);
  const rateInput = document.getElementById('f-rate');
  const otRateInput = document.getElementById('f-ot-rate');
  if (rateInput) rateInput.value = rateFieldValue(rate);
  if (otRateInput) otRateInput.value = rateFieldValue(preset.otRate);
}
function collectEntryForm() {
  const type = document.querySelector('[data-entry-type].active')?.dataset.entryType || 'self';
  const billingType = document.querySelector('[data-billing-type].active')?.dataset.billingType === 'contract' ? 'contract' : 'labor';
  const startDate = document.getElementById('f-date').value;
  const endDate = document.getElementById('f-end-date')?.value || startDate;
  if (!startDate) throw new Error('開始日を入力してください');
  if (fromYmd(endDate) < fromYmd(startDate)) throw new Error('終了日は開始日以降にしてください');
  const original = editingId ? state.entries.find((item) => item.id === editingId) : null;
  const originalRange = original ? entryRangeGroup(original) : null;
  const originalByDate = new Map((originalRange?.entries || []).map((entry) => [entry.date, entry]));
  const createdAt = original?.createdAt || new Date().toISOString();
  const paymentInput = document.getElementById('f-payment-amount');
  const paymentAmountSet = type === 'sub' && !!paymentInput && paymentInput.value.trim() !== '';
  const base = {
    type, billingType, contractAmount: billingType === 'contract' ? num(document.getElementById('f-contract-amount')?.value) : 0, shift: document.getElementById('f-shift').value,
    company: normalizeCompanyInputName(document.getElementById('f-company').value), site: document.getElementById('f-site').value.trim(), workerName: document.getElementById('f-worker').value.trim(),
    qty: billingType === 'contract' ? 0 : num(document.getElementById('f-qty')?.value), unitRate: billingType === 'contract' ? 0 : num(document.getElementById('f-rate')?.value), paymentAmount: type === 'sub' ? num(paymentInput?.value) : 0, paymentAmountSet, otHours: billingType === 'contract' ? 0 : num(document.getElementById('f-ot-hours')?.value), otRate: billingType === 'contract' ? 0 : num(document.getElementById('f-ot-rate')?.value),
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
  const overtimeEditDate = original && dates.includes(original.date) ? original.date : dates[0];
  return dates.map((date) => ({
    ...base,
    id: editingId && originalByDate.has(date) ? originalByDate.get(date).id : crypto.randomUUID(),
    date,
    rangeGroupId,
    rangeStart: isRange ? startDate : '',
    rangeEnd: isRange ? endDate : '',
    excludedDates: isRange ? excludedDates : [],
    otHours: billingType === 'contract' ? 0 : (date === overtimeEditDate ? base.otHours : num(originalByDate.get(date)?.otHours)),
    expenses: editingId && originalRange?.entries.length > 1 && date !== original.date && originalByDate.has(date) ? { ...(originalByDate.get(date).expenses || {}) } : { ...base.expenses }
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
  const clientInput = document.getElementById('google-client-id');
  const enteredClientId = String(clientInput?.value || '').replace(/\s+/g, '');
  if (enteredClientId) {
    state.settings.googleClientId = enteredClientId;
    if (clientInput) clientInput.value = enteredClientId;
  }
  state.settings.googleCalendarId = document.getElementById('google-calendar-id')?.value.trim() || 'primary';
  state.settings.googleStoreMode = document.getElementById('google-store-mode')?.value || 'local';
  state.settings.googleSyncEnabled = !!document.getElementById('google-auto-sync')?.checked;
  state.settings.googleConflictMode = document.getElementById('google-conflict-mode')?.value || 'newer';
  if (touch) markSettingsSections('google');
  saveState();
  if (render) renderAll();
  if (feedback) setSyncLog('Google設定を保存しました');
}
function setSyncLog(message) { const log = document.getElementById('sync-log'); if (log) log.textContent = message; }
function firebaseAvailable() { return !!window.NinqFirebaseCloud; }
function mergeFirebaseState(remotePayload, options = {}) {
  return mergeDriveState(remotePayload, options);
}
function applyRemoteFirebaseState(remotePayload) {
  state = mergeFirebaseState(remotePayload);
  saveState();
  rememberDriveSync(remotePayload);
  saveSyncPending(false);
  renderAll();
}
async function loginFirebaseCloud() {
  try {
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    if (!firebaseAvailable()) throw new Error('Firebaseの読み込み待ちです。数秒後にもう一度押してください');
    setSyncLog('NINQクラウドにログインしています...');
    const user = await window.NinqFirebaseCloud.signIn();
    if (user) firebaseUser = user;
    return firebaseUser;
  } catch (error) {
    setSyncLog(error.message || 'NINQクラウドログインに失敗しました');
    return null;
  }
}
async function sendDeviceToFirebase() {
  if (activeScreen === 'st') flushSettingsAutosave();
  if (!firebaseAvailable()) { setSyncLog('Firebaseの読み込み待ちです。数秒後にもう一度押してください'); return; }
  if (!firebaseUser) { await loginFirebaseCloud(); if (!firebaseUser) return; }
  if (firebaseSyncInFlight) { setSyncLog('処理中です。少し待ってからもう一度押してください'); return; }
  firebaseSyncInFlight = true;
  try {
    setSyncLog('この端末のデータをNINQクラウドへ保存しています...');
    const payload = firebaseSyncPayload();
    await window.NinqFirebaseCloud.writeState(payload);
    rememberDriveSync(payload);
    saveSyncPending(false);
    setSyncLog(`この端末からNINQクラウドへ保存しました。予定 ${state.entries.length}件`);
  } catch (error) {
    saveSyncPending(true, 'save');
    setSyncLog(error.message || 'NINQクラウドへの保存に失敗しました');
  } finally {
    firebaseSyncInFlight = false;
    renderSyncScreen();
  }
}
async function receiveDeviceFromFirebase() {
  if (activeScreen === 'st') flushSettingsAutosave();
  if (!firebaseAvailable()) { setSyncLog('Firebaseの読み込み待ちです。数秒後にもう一度押してください'); return; }
  if (!firebaseUser) { await loginFirebaseCloud(); if (!firebaseUser) return; }
  if (firebaseSyncInFlight) { setSyncLog('処理中です。少し待ってからもう一度押してください'); return; }
  if (hasLocalChangesSinceSync() && !confirm('この端末の未送信の変更を、NINQクラウドのデータで置き換えます。受け取りますか？')) return;
  firebaseSyncInFlight = true;
  try {
    setSyncLog('NINQクラウドからデータを受け取っています...');
    const remotePayload = await window.NinqFirebaseCloud.readState();
    if (!remotePayload) { setSyncLog('NINQクラウドにはまだデータがありません。先に「この端末から送る」を押してください'); return; }
    applyRemoteFirebaseState(remotePayload);
    setSyncLog(`NINQクラウドから受け取りました。予定 ${state.entries.length}件`);
  } catch (error) {
    setSyncLog(error.message || 'NINQクラウドからの受け取りに失敗しました');
  } finally {
    firebaseSyncInFlight = false;
    renderSyncScreen();
  }
}
async function syncFirebaseCloud({ auto = false, reason = '' } = {}) {
  if (activeScreen === 'st') flushSettingsAutosave();
  window.clearTimeout(firebaseSyncTimer);
  firebaseSyncTimer = null;
  if (auto && isEditingSyncSensitiveField()) {
    scheduleFirebaseAutoSync({ delay: 8000, reason });
    return;
  }
  if (auto && (!state.settings.googleSyncEnabled || !firebaseUser)) return;
  if (!firebaseAvailable()) return;
  if (!navigator.onLine) {
    saveSyncPending(true, reason || 'offline');
    setSyncLog('オフラインのためNINQクラウド同期を待機しています');
    renderSyncScreen();
    return;
  }
  if (firebaseSyncInFlight) {
    firebaseSyncQueued = true;
    return;
  }
  firebaseSyncInFlight = true;
  try {
    if (reason !== 'poll') setSyncLog(auto && reason === 'save' ? '変更をNINQクラウドへ保存中です...' : 'NINQクラウドの最新データを確認中です...');
    const remotePayload = await window.NinqFirebaseCloud.readState();
    if (!remotePayload) {
      const payload = firebaseSyncPayload();
      await window.NinqFirebaseCloud.writeState(payload);
      rememberDriveSync(payload);
      saveSyncPending(false);
      setSyncLog('NINQクラウドに初回データを保存しました');
      return;
    }
    const meta = loadSyncMeta();
    const firstCloudSync = !meta.lastSyncedAt && !meta.lastCloudModifiedAt;
    if (firstCloudSync) {
      state = mergeFirebaseState(remotePayload, { preferRemoteSettings: true });
      saveState();
      const payload = firebaseSyncPayload();
      await window.NinqFirebaseCloud.writeState(payload);
      rememberDriveSync(payload);
      saveSyncPending(false);
      renderAll();
      setSyncLog(`初回同期が完了しました。クラウド設定を受け取り、予定${state.entries.length}件を統合しました`);
      return;
    }
    const remoteModifiedAt = remotePayloadModifiedAt(remotePayload);
    const remoteChanged = isAfterDate(remoteModifiedAt, meta.lastCloudModifiedAt);
    const localChanged = hasLocalChangesSinceSync();
    if (remoteChanged && localChanged) {
      const mergedState = mergeFirebaseState(remotePayload);
      state = mergedState;
      saveState();
      const payload = firebaseSyncPayload();
      await window.NinqFirebaseCloud.writeState(payload);
      rememberDriveSync(payload);
      saveSyncPending(false);
      renderAll();
      setSyncLog(`PC/スマホの変更をまとめて保存しました。予定 ${state.entries.length}件`);
      return;
    }
    if (remoteChanged && !localChanged) {
      state = mergeFirebaseState(remotePayload);
      saveState();
      const payload = firebaseSyncPayload();
      await window.NinqFirebaseCloud.writeState(payload);
      rememberDriveSync(payload);
      saveSyncPending(false);
      renderAll();
      setSyncLog(`NINQクラウドから最新データを取得しました。予定 ${state.entries.length}件`);
      return;
    }
    if (localChanged || reason === 'save') {
      const payload = firebaseSyncPayload();
      await window.NinqFirebaseCloud.writeState(payload);
      rememberDriveSync(payload);
      saveSyncPending(false);
      setSyncLog(`変更をNINQクラウドへ保存しました。予定 ${state.entries.length}件`);
      return;
    }
    rememberDriveSync(remotePayload);
    saveSyncPending(false);
    if (reason !== 'poll') setSyncLog(`NINQクラウドと同じ状態です。予定 ${state.entries.length}件`);
  } catch (error) {
    if (auto) saveSyncPending(true, reason || 'retry');
    setSyncLog(auto ? 'NINQクラウド同期を次回オンライン時に再試行します' : (error.message || 'NINQクラウド同期に失敗しました'));
  } finally {
    firebaseSyncInFlight = false;
    renderSyncScreen();
    if (firebaseSyncQueued) {
      firebaseSyncQueued = false;
      scheduleFirebaseAutoSync({ delay: 900, reason: 'save' });
    }
  }
}
function scheduleFirebaseAutoSync({ delay = 1800, message = '', reason = 'save' } = {}) {
  window.clearTimeout(firebaseSyncTimer);
  firebaseSyncTimer = null;
  if (!state.settings.googleSyncEnabled) {
    setSyncLog('端末内に保存しました。自動同期をONにするとNINQクラウドにも保存します');
    return;
  }
  if (!firebaseUser) {
    saveSyncPending(true, reason);
    setSyncLog('端末内に保存しました。NINQクラウドはログイン後に保存します');
    renderSyncScreen();
    return;
  }
  if (!navigator.onLine) {
    saveSyncPending(true, reason);
    setSyncLog('オフラインのため端末内に保存しました。オンライン復帰後に送信します');
    renderSyncScreen();
    return;
  }
  saveSyncPending(true, reason);
  setSyncLog(message || '端末内に保存しました。少し後にNINQクラウドへ自動保存します...');
  const wait = isEditingSyncSensitiveField() ? Math.max(delay, 8000) : delay;
  firebaseSyncTimer = window.setTimeout(() => {
    if (isEditingSyncSensitiveField()) {
      scheduleFirebaseAutoSync({ delay: 8000, reason });
      return;
    }
    syncFirebaseCloud({ auto: true, reason });
  }, wait);
}
function isEditingSyncSensitiveField() {
  const el = document.activeElement;
  if (!el?.matches?.('input, textarea, select, [contenteditable="true"]')) return false;
  if (el.closest('#sc-sync')) return false;
  if (['checkbox', 'radio', 'file', 'button', 'submit'].includes(el.type || '')) return false;
  return true;
}
function scheduleDriveAutoSync({ delay = 1200, message = '', reason = 'save' } = {}) {
  if (firebaseAvailable() || firebaseUser) {
    scheduleFirebaseAutoSync({ delay, message, reason });
    return;
  }
  window.clearTimeout(driveSyncTimer);
  driveSyncTimer = null;
  if (!state.settings.googleSyncEnabled || !state.settings.googleClientId) {
    if (state.settings.googleClientId) setSyncLog('端末内に保存しました。自動同期をONにするとクラウドにも保存します');
    return;
  }
  if (!navigator.onLine) {
    saveSyncPending(true, reason);
    setSyncLog('オフラインのため端末に一時保存しました。オンライン復帰後に自動送信します');
    renderSyncScreen();
    return;
  }
  saveSyncPending(true, reason);
  if (message) setSyncLog(message);
  else setSyncLog('端末内に保存しました。クラウドへ自動保存します...');
  const wait = isEditingSyncSensitiveField() ? Math.max(delay, 8000) : delay;
  driveSyncTimer = window.setTimeout(() => {
    if (isEditingSyncSensitiveField()) {
      scheduleDriveAutoSync({ delay: 8000, reason });
      return;
    }
    syncGoogleDrive({ auto: true, reason });
  }, wait);
}
function localModifiedAt(targetState = state) {
  const dates = [
    targetState.settings?.updatedAt,
    ...(targetState.entries || []).flatMap((entry) => [entry.updatedAt, entry.createdAt]),
    ...Object.values(targetState.deletedEntryIds || {}),
    ...Object.values(targetState.deletedReceiptIds || {}),
  ].filter(Boolean).map((value) => Date.parse(value)).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : new Date(0).toISOString();
}
function syncPayload() {
  return { app: 'NINQ', version: 2, syncedAt: new Date().toISOString(), modifiedAt: localModifiedAt(), state: normalizeState(state) };
}
function firebaseSyncPayload() {
  const payload = syncPayload();
  payload.appVersion = APP_VERSION;
  payload.backend = 'firebase';
  return payload;
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
function googleAccessToken(scope) {
  const saved = googleAccessTokens.get(scope);
  if (!saved || saved.expiresAt <= Date.now() + 60000) {
    googleAccessTokens.delete(scope);
    return '';
  }
  return saved.value;
}
function hasGoogleAccessToken(scope) { return !!googleAccessToken(scope); }
function clearGoogleAccessToken(scope) { googleAccessTokens.delete(scope); }
function googleAuthErrorMessage(error, serviceLabel) {
  const code = error?.type || error?.error || error?.message || '';
  if (code === 'popup_closed' || code === 'access_denied') return `${serviceLabel}の認証がキャンセルされました`;
  if (code === 'popup_failed_to_open') return `${serviceLabel}の認証画面を開けませんでした。ブラウザのポップアップを許可してください`;
  if (code === 'interaction_required' || code === 'login_required') return `${serviceLabel}への再接続が必要です。もう一度ボタンを押してアカウントを選択してください`;
  return `${serviceLabel}の認証に失敗しました${code ? `（${code}）` : ''}`;
}
async function getGoogleToken(scope, prompt = 'select_account', serviceLabel = 'Google') {
  const cached = googleAccessToken(scope);
  if (cached) return cached;
  const clientId = document.getElementById('google-client-id')?.value.trim() || state.settings.googleClientId;
  if (!clientId) throw new Error('GoogleクライアントIDを入力して保存してください');
  await loadGoogleIdentity();
  return new Promise((resolve, reject) => {
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      include_granted_scopes: false,
      callback: (response) => {
        if (response.error) { reject(new Error(googleAuthErrorMessage(response, serviceLabel))); return; }
        const expiresIn = Math.max(0, num(response.expires_in));
        googleAccessTokens.set(scope, { value: response.access_token, expiresAt: Date.now() + expiresIn * 1000 });
        const status = document.getElementById('drive-sync-status'); if (status) status.textContent = 'ログイン済み';
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new Error(googleAuthErrorMessage(error, serviceLabel))),
    });
    googleTokenClients.set(scope, tokenClient);
    tokenClient.requestAccessToken({ prompt });
  });
}
function getDriveToken(prompt = 'select_account') { return getGoogleToken(GOOGLE_DRIVE_SCOPE, prompt, 'Google Drive'); }
function getCalendarToken(prompt = 'select_account') { return getGoogleToken(GOOGLE_CALENDAR_SCOPE, prompt, 'Googleカレンダー'); }
async function driveFetch(url, options = {}) {
  const token = googleAccessToken(GOOGLE_DRIVE_SCOPE) || await getDriveToken(driveAuthPrompt);
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    clearGoogleAccessToken(GOOGLE_DRIVE_SCOPE);
    throw new Error('Google Driveへの再接続が必要です。手動操作からもう一度実行してください');
  }
  if (!response.ok) throw new Error(await response.text() || `Google Driveエラー ${response.status}`);
  return response;
}
async function calendarFetch(url, options = {}) {
  const token = googleAccessToken(GOOGLE_CALENDAR_SCOPE) || await getCalendarToken('select_account');
  const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` } });
  if (response.status === 401) {
    clearGoogleAccessToken(GOOGLE_CALENDAR_SCOPE);
    throw new Error('Googleカレンダーへの再接続が必要です。もう一度「選択期間をGoogle登録」を押してアカウントを選択してください');
  }
  return response;
}
async function googleErrorText(response, fallback) {
  try {
    const data = await response.json();
    return data?.error?.message || fallback;
  } catch (error) {
    return await response.text() || fallback;
  }
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
  return mergeTimestampMaps(localDeleted, remoteDeleted);
}
function mergeEntriesWithDeletes(localEntries = [], remoteEntries = [], localDeleted = {}, remoteDeleted = {}) {
  return mergeItemsWithDeletes(localEntries, remoteEntries, localDeleted, remoteDeleted, ['updatedAt', 'createdAt']);
}
function mergeItemsWithDeletes(localItems = [], remoteItems = [], localDeleted = {}, remoteDeleted = {}, dateKeys = ['updatedAt', 'createdAt']) {
  const deleted = mergeDeletedEntryIds(localDeleted, remoteDeleted);
  const merged = mergeById(localItems, remoteItems, dateKeys);
  return merged.filter((item) => {
    const deletedAt = Date.parse(deleted[item.id] || '') || 0;
    const itemAt = Math.max(...dateKeys.map((key) => Date.parse(item[key] || '') || 0));
    return !deletedAt || itemAt > deletedAt;
  });
}
function mergeDriveState(remotePayload, { preferRemoteSettings = false } = {}) {
  const remoteState = normalizeState(remotePayload.state || remotePayload);
  const deletedEntryIds = mergeDeletedEntryIds(state.deletedEntryIds, remoteState.deletedEntryIds);
  const deletedReceiptIds = mergeDeletedEntryIds(state.deletedReceiptIds, remoteState.deletedReceiptIds);
  return normalizeState({
    settings: mergeSettingsBySection(state.settings, remoteState.settings, { preferRemoteOnTie: preferRemoteSettings }),
    entries: mergeEntriesWithDeletes(state.entries, remoteState.entries, state.deletedEntryIds, remoteState.deletedEntryIds),
    receipts: [],
    deletedEntryIds,
    deletedReceiptIds,
  });
}
function applyRemoteDriveState(remotePayload) {
  state = mergeDriveState(remotePayload);
  saveState();
  rememberDriveSync(remotePayload);
  saveSyncPending(false);
  renderAll();
}
async function pushDriveStateToFile(fileId = '') {
  const payload = syncPayload();
  if (fileId) await updateDriveSyncFile(fileId, JSON.stringify(payload, null, 2));
  else await pushLocalDriveState();
  rememberDriveSync(payload);
  saveSyncPending(false);
  return payload;
}
async function resolveDriveConflict(file, remotePayload, { auto = false } = {}) {
  const remoteModifiedAt = remotePayloadModifiedAt(remotePayload);
  const localTime = dateTime(localModifiedAt());
  const remoteTime = dateTime(remoteModifiedAt);
  const useConfirm = state.settings.googleConflictMode === 'confirm' && !auto;
  if (useConfirm) {
    const keepLocal = confirm('PC/スマホの両方に変更があります。この端末の内容をクラウドへ保存しますか？\n\nOK: この端末を採用\nキャンセル: クラウドを採用');
    if (keepLocal) {
      await pushDriveStateToFile(file.id);
      setSyncLog(`この端末のデータを採用して保存しました。予定 ${state.entries.length}件`);
      return;
    }
    applyRemoteDriveState(remotePayload);
    setSyncLog(`クラウドのデータを採用しました。予定 ${state.entries.length}件`);
    return;
  }
  if (remoteTime > localTime) {
    applyRemoteDriveState(remotePayload);
    setSyncLog(`${auto ? '競合があったため新しいクラウド側を採用しました。' : '新しいクラウド側を採用しました。'}予定 ${state.entries.length}件`);
    return;
  }
  await pushDriveStateToFile(file.id);
  setSyncLog(`${auto ? '競合があったため新しい端末側を保存しました。' : '新しい端末側を保存しました。'}予定 ${state.entries.length}件`);
}
async function loginGoogleDrive() {
  try {
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    await getDriveToken('select_account');
    state.settings.googleSyncEnabled = true;
    markSettingsSections('google');
    saveState();
    const autoSync = document.getElementById('google-auto-sync');
    if (autoSync) autoSync.checked = true;
    setSyncLog('Googleログインしました。自動同期を開始します...');
    await syncGoogleDrive({ auto: true, reason: 'startup' });
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
    driveAuthPrompt = 'select_account';
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    setSyncLog('この端末のデータをクラウドへ送っています...');
    await getDriveToken(driveAuthPrompt);
    await pushDriveStateToFile();
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
    driveAuthPrompt = 'select_account';
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    setSyncLog('クラウドからデータを受け取っています...');
    await getDriveToken(driveAuthPrompt);
    const file = await findDriveSyncFile();
    if (!file) { setSyncLog('クラウドにNINQデータがまだありません。先に別端末で「この端末から送る」を押してください'); return; }
    const remotePayload = await readDriveSyncFile(file.id);
    applyRemoteDriveState(remotePayload);
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
  if (auto && isEditingSyncSensitiveField()) {
    scheduleDriveAutoSync({ delay: 8000, reason });
    return;
  }
  if (auto && (!state.settings.googleSyncEnabled || !state.settings.googleClientId)) return;
  if (auto && !navigator.onLine) {
    saveSyncPending(true, reason || 'offline');
    setSyncLog('オフラインのため同期を待機しています');
    renderSyncScreen();
    return;
  }
  if (driveSyncInFlight) {
    driveSyncQueued = true;
    return;
  }
  driveSyncInFlight = true;
  const previousPrompt = driveAuthPrompt;
  try {
    driveAuthPrompt = auto ? '' : 'select_account';
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    setSyncLog(auto && reason === 'save' ? '変更をGoogle Driveへ保存中です...' : (auto ? 'Google Driveから最新データを確認中です...' : 'Google Driveと同期中です...'));
    await getDriveToken(driveAuthPrompt);
    const file = await findDriveSyncFile();
    if (!file) {
      await pushDriveStateToFile();
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
          await resolveDriveConflict(file, remotePayload, { auto });
          return;
        }
        applyRemoteDriveState(remotePayload);
        setSyncLog('クラウド側が新しかったため取得しました');
        return;
      }
      await pushDriveStateToFile(file.id);
      setSyncLog(`変更を保存しました。予定 ${state.entries.length}件`);
      return;
    }

    if (auto && remoteChanged && localChanged) {
      await resolveDriveConflict(file, remotePayload, { auto });
      return;
    }

    if (remoteChanged && !localChanged) {
      applyRemoteDriveState(remotePayload);
      setSyncLog(`${auto ? '起動時にクラウドから取得しました。' : 'クラウドから取得しました。'}予定 ${state.entries.length}件`);
      return;
    }

    if (localChanged && !remoteChanged) {
      await pushDriveStateToFile(file.id);
      setSyncLog(`${auto ? '端末の変更をクラウドへ保存しました。' : 'クラウドへ保存しました。'}予定 ${state.entries.length}件`);
      return;
    }

    if (remoteChanged && localChanged) {
      await resolveDriveConflict(file, remotePayload, { auto });
      return;
    }

    rememberDriveSync(remotePayload);
    saveSyncPending(false);
    setSyncLog(`${auto ? 'クラウドと同じ状態です。' : '同期済みです。'}予定 ${state.entries.length}件`);
  } catch (error) {
    if (auto) saveSyncPending(true, reason || 'retry');
    setSyncLog(auto ? '自動同期できませんでした。次回オンライン時に再送します。必要ならGoogleログインしてください' : (error.message || 'Google Drive同期に失敗しました'));
  } finally {
    driveAuthPrompt = previousPrompt;
    driveSyncInFlight = false;
    renderSyncScreen();
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
  const lines = [`区分: ${typeLabel(entry.type)} / ${shiftLabel(entry.shift)} / ${billingTypeLabel(entry)}`];
  if (entry.workerName) lines.push(`職人名: ${entry.workerName}`);
  if (entry.company) lines.push(`会社名: ${entry.company}`);
  if (entry.site) lines.push(`現場名: ${entry.site}`);
  if (calc.qty) lines.push(`人工: ${calc.qty}`);
  if (entry.notes) lines.push(`メモ: ${entry.notes}`);
  return lines.join('\n');
}
function calendarExportKey(entry) {
  const company = normalizeCompanyInputName(entry.company);
  const site = String(entry.site || '').trim();
  if (company && site) return [entry.type || 'self', entry.shift || 'day', entry.billingType || 'labor', company, site, entry.workerName || ''].join('\u001f');
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
function calendarGroupOverlapsRange(group, start, end) {
  return !!group && !!start && !!end && group.start <= end && group.end >= start;
}
function calendarGroupExportSignature(group) {
  return [group.start, group.end, calendarExportKey(group.entries[0]), calendarGroupDescription(group)].join('\u001f');
}
function calendarRangeGroups(start, end) {
  if (!start || !end || end < start) return [];
  const seen = new Set();
  return calendarExportGroups(state.entries).filter((group) => {
    if (!calendarGroupOverlapsRange(group, start, end)) return false;
    const signature = calendarGroupExportSignature(group);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
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
function calendarExportColorId(group) {
  return group.entries[0]?.shift === 'night' ? '9' : '5';
}
function base32HexHash(text) {
  let hash = 2166136261;
  String(text).split('').forEach((char) => {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  });
  const alphabet = '0123456789abcdefghijklmnopqrstuv';
  let out = '';
  do {
    out = alphabet[hash & 31] + out;
    hash >>>= 5;
  } while (hash);
  return out.padStart(7, '0');
}
function calendarGroupSourceMarker(group) {
  const rangeIds = [...new Set(group.entries.map((entry) => String(entry.rangeGroupId || '').trim()).filter(Boolean))];
  const source = rangeIds.length === 1
    ? `range:${rangeIds[0]}`
    : `entries:${group.entries.map((entry) => entry.id).sort().join('|')}`;
  return `g${base32HexHash(source)}${base32HexHash(source.split('').reverse().join(''))}`;
}
function calendarGroupLogicalMarker(group) {
  const source = calendarExportKey(group.entries[0]);
  return `k${base32HexHash(source)}${base32HexHash(source.split('').reverse().join(''))}`;
}
function calendarEventId(group) {
  const raw = [group.start, group.end, calendarExportKey(group.entries[0]), group.entries.map((entry) => entry.id).join('|')].join('|');
  return `ninq${base32HexHash(raw)}${base32HexHash(raw.split('').reverse().join(''))}`;
}
function calendarEventBody(group) {
  const endDate = fromYmd(group.end); endDate.setDate(endDate.getDate() + 1);
  return {
    summary: calendarExportTitle(group),
    description: calendarGroupDescription(group),
    start: { date: group.start },
    end: { date: toYmd(endDate) },
    colorId: calendarExportColorId(group),
    extendedProperties: { private: {
      app: 'NINQ',
      ninqRange: `${group.start}_${group.end}`,
      ninqGroup: calendarGroupSourceMarker(group),
      ninqKey: calendarGroupLogicalMarker(group),
    } },
  };
}
function calendarGroupEndExclusive(group) {
  const endDate = fromYmd(group.end);
  endDate.setDate(endDate.getDate() + 1);
  return toYmd(endDate);
}
function isSameGoogleCalendarEvent(event, group) {
  return isNinqGoogleCalendarEvent(event)
    && event?.summary === calendarExportTitle(group)
    && event?.start?.date === group.start
    && event?.end?.date === calendarGroupEndExclusive(group);
}
function isNinqGoogleCalendarEvent(event) {
  return event?.extendedProperties?.private?.app === 'NINQ' || String(event?.id || '').startsWith('ninq');
}
function calendarRangeEndExclusive(end) {
  const date = fromYmd(end);
  date.setDate(date.getDate() + 1);
  return toYmd(date);
}
async function listNinqGoogleCalendarEvents(calendarId, start, end) {
  const encodedCalendarId = encodeURIComponent(calendarId || 'primary');
  const events = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      singleEvents: 'true',
      maxResults: '2500',
      timeMin: `${start}T00:00:00+09:00`,
      timeMax: `${calendarRangeEndExclusive(end)}T00:00:00+09:00`,
      privateExtendedProperty: 'app=NINQ',
      fields: 'nextPageToken,items(id,summary,description,start,end,extendedProperties)',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await calendarFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events?${params.toString()}`);
    if (!response.ok) throw new Error(await googleErrorText(response, `Googleカレンダー確認エラー ${response.status}`));
    const data = await response.json();
    events.push(...(data.items || []).filter(isNinqGoogleCalendarEvent));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return events;
}
function googleCalendarEventOverlapsRange(event, start, end) {
  return !!event?.start?.date && !!event?.end?.date
    && event.start.date < calendarRangeEndExclusive(end)
    && event.end.date > start;
}
function googleCalendarEventOverlapsGroup(event, group) {
  return !!event?.start?.date && !!event?.end?.date
    && event.start.date < calendarGroupEndExclusive(group)
    && event.end.date > group.start;
}
function calendarDescriptionFingerprint(value) {
  return String(value || '').replace(/\n期間:.*$/u, '').trim();
}
function googleCalendarEventMatchScore(event, group) {
  if (!isNinqGoogleCalendarEvent(event)) return -1;
  const privateProps = event?.extendedProperties?.private || {};
  if (privateProps.ninqGroup && privateProps.ninqGroup === calendarGroupSourceMarker(group)) return 500;
  if (isSameGoogleCalendarEvent(event, group)) return 400;
  if (!googleCalendarEventOverlapsGroup(event, group)) return -1;
  if (privateProps.ninqKey && privateProps.ninqKey === calendarGroupLogicalMarker(group)) return 300;
  if (event?.summary === calendarExportTitle(group)
    && calendarDescriptionFingerprint(event?.description) === calendarDescriptionFingerprint(calendarDescription(group.entries[0]))) return 200;
  return -1;
}
function reconcileNinqGoogleCalendarEvents(events, groups, start, end) {
  const remaining = events.filter((event) => googleCalendarEventOverlapsRange(event, start, end));
  const assignments = new Map();
  groups.forEach((group) => {
    let bestIndex = -1;
    let bestScore = -1;
    remaining.forEach((event, index) => {
      const score = googleCalendarEventMatchScore(event, group);
      if (score > bestScore) { bestIndex = index; bestScore = score; }
    });
    if (bestIndex < 0) return;
    assignments.set(group, remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  });
  const duplicates = [];
  const stale = [];
  remaining.forEach((event) => {
    const duplicate = groups.some((group) => googleCalendarEventMatchScore(event, group) >= 200);
    (duplicate ? duplicates : stale).push(event);
  });
  return { assignments, duplicates, stale };
}
async function deleteGoogleCalendarEvent(calendarId, eventId) {
  const encodedCalendarId = encodeURIComponent(calendarId || 'primary');
  const response = await calendarFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(await googleErrorText(response, `Googleカレンダー削除エラー ${response.status}`));
}
async function findExistingGoogleCalendarEvent(calendarId, group) {
  const encodedCalendarId = encodeURIComponent(calendarId || 'primary');
  const params = new URLSearchParams({
    singleEvents: 'true',
    maxResults: '20',
    timeMin: `${group.start}T00:00:00+09:00`,
    timeMax: `${calendarGroupEndExclusive(group)}T00:00:00+09:00`,
    q: calendarExportTitle(group),
    fields: 'items(id,summary,start,end,extendedProperties)',
  });
  const response = await calendarFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events?${params.toString()}`);
  if (!response.ok) throw new Error(await googleErrorText(response, `Googleカレンダー確認エラー ${response.status}`));
  const data = await response.json();
  return (data.items || []).find((event) => isSameGoogleCalendarEvent(event, group)) || null;
}
async function updateGoogleCalendarEvent(calendarId, eventId, group) {
  const encodedCalendarId = encodeURIComponent(calendarId || 'primary');
  const response = await calendarFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(calendarEventBody(group)),
  });
  if (!response.ok) throw new Error(await googleErrorText(response, `Googleカレンダー更新エラー ${response.status}`));
  await response.json();
  return 'updated';
}
async function upsertGoogleCalendarEvent(calendarId, group, assignedEvent = null) {
  const eventId = calendarEventId(group);
  const encodedCalendarId = encodeURIComponent(calendarId || 'primary');
  if (assignedEvent?.id) return updateGoogleCalendarEvent(calendarId, assignedEvent.id, group);
  const existing = await findExistingGoogleCalendarEvent(calendarId, group);
  if (existing) return updateGoogleCalendarEvent(calendarId, existing.id, group);
  const insertBody = { ...calendarEventBody(group), id: eventId };
  let response = await calendarFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodedCalendarId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(insertBody),
  });
  if (response.status === 409) {
    return updateGoogleCalendarEvent(calendarId, eventId, group);
  }
  if (!response.ok) throw new Error(await googleErrorText(response, `Googleカレンダー登録エラー ${response.status}`));
  await response.json();
  return 'created';
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
async function exportRangeCalendarIcs() {
  const { start, end } = calendarRangeValues();
  if (!start || !end) { setSyncLog('開始日と終了日を選んでください'); return; }
  if (end < start) { setSyncLog('終了日は開始日以降にしてください'); return; }
  const groups = calendarRangeGroups(start, end);
  try {
    saveGoogleSettings({ feedback: false, render: false, touch: false });
    await getCalendarToken('select_account');
    const calendarId = state.settings.googleCalendarId || 'primary';
    setSyncLog('Googleカレンダー上のNINQ予定を確認中です...');
    const googleEvents = await listNinqGoogleCalendarEvents(calendarId, start, end);
    const reconciliation = reconcileNinqGoogleCalendarEvents(googleEvents, groups, start, end);
    const staleEvents = reconciliation.stale;
    const result = { created: 0, updated: 0, deleted: 0, cleaned: 0, kept: 0 };
    if (reconciliation.duplicates.length) {
      setSyncLog(`${reconciliation.duplicates.length}件の重複したNINQ予定を整理中です...`);
      for (const event of reconciliation.duplicates) {
        await deleteGoogleCalendarEvent(calendarId, event.id);
        result.deleted += 1;
        result.cleaned += 1;
      }
    }
    if (staleEvents.length) {
      const shouldDelete = confirm(`NINQで削除・変更されたGoogleカレンダー予定が${staleEvents.length}件あります。Googleカレンダーからも削除しますか？\n\nGoogle側で手入力した予定は削除されません。`);
      if (shouldDelete) {
        setSyncLog(`${staleEvents.length}件の不要なNINQ予定をGoogleカレンダーから削除中です...`);
        for (const event of staleEvents) {
          await deleteGoogleCalendarEvent(calendarId, event.id);
          result.deleted += 1;
        }
      } else {
        result.kept = staleEvents.length;
      }
    }
    setSyncLog(`${groups.length}件をGoogleカレンダーへ登録・更新中です...`);
    for (const group of groups) {
      const status = await upsertGoogleCalendarEvent(calendarId, group, reconciliation.assignments.get(group));
      if (status === 'created') result.created += 1;
      else result.updated += 1;
    }
    const keptText = result.kept ? ` / 削除せず残した予定${result.kept}件` : '';
    const cleanedText = result.cleaned ? ` / 重複整理${result.cleaned}件` : '';
    const removedText = result.deleted > result.cleaned ? ` / 削除${result.deleted - result.cleaned}件` : '';
    setSyncLog(`${start}〜${end}をGoogleカレンダーへ反映しました。新規${result.created}件 / 更新${result.updated}件${cleanedText}${removedText}${keptText}`);
    renderSyncScreen();
  } catch (error) {
    setSyncLog(error.message || 'Googleカレンダー登録に失敗しました');
  }
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
function importedCompanyPresetMatch(imported, presets) {
  const aliases = [...new Set([
    imported?.name,
    imported?.sheetName,
    imported?.officialName,
    ...(Array.isArray(imported?.aliases) ? imported.aliases : []),
  ].map((value) => String(value || '').trim()).filter(Boolean))];
  return aliases.map((alias) => findCompanyPresetByAnyName(alias, presets)).find(Boolean) || null;
}
function entryImportSignature(entry) {
  return [
    entry.date || '', entry.type || 'self', entry.shift || 'day', entry.billingType || 'labor',
    companyNameLookupKey(entry.company), String(entry.site || '').trim(), String(entry.workerName || '').trim(),
    num(entry.qty), num(entry.unitRate), num(entry.contractAmount), num(entry.paymentAmount),
    num(entry.otHours), num(entry.otRate), sortedExpenseText(entry.expenses), String(entry.notes || '').trim(),
  ].join('\u001f');
}
function mergeImportPayload(payload) {
  const importedEntries = Array.isArray(payload?.entries) ? payload.entries : [];
  if (!importedEntries.length) throw new Error('追加できる予定がありません');

  const presets = companyPresets().map((preset) => ({ ...preset }));
  const importedPresets = Array.isArray(payload.companyPresets) ? payload.companyPresets : [];
  const companyMap = new Map();
  importedPresets.forEach((imported, index) => {
    const aliases = [...new Set([imported.name, imported.sheetName, imported.officialName, ...(imported.aliases || [])].map((value) => String(value || '').trim()).filter(Boolean))];
    let preset = importedCompanyPresetMatch(imported, presets);
    if (!preset) {
      const name = String(imported.name || imported.sheetName || imported.officialName || '').trim();
      if (!name) return;
      preset = {
        id: String(imported.id || `import-company-${payload?.source?.year || 'data'}-${index + 1}`),
        name,
        sheetName: String(imported.sheetName || name).trim(),
        officialName: String(imported.officialName || name).trim(),
        invoiceHonorific: normalizeInvoiceHonorific(imported.invoiceHonorific),
        dayRate: num(imported.dayRate), nightRate: num(imported.nightRate), otRate: num(imported.otRate), closingDay: closingDayValue(imported.closingDay),
        updatedAt: new Date().toISOString(),
      };
      presets.push(preset);
    }
    aliases.forEach((alias) => companyMap.set(companyNameLookupKey(alias), preset.name));
  });

  const normalizedImported = importedEntries.map((raw) => {
    const entry = normalizeEntry(raw);
    const mappedName = companyMap.get(companyNameLookupKey(entry.company));
    entry.company = mappedName || companyCanonicalNameFromPresets(entry.company, presets);
    return entry;
  });
  const currentById = new Map(state.entries.map((entry) => [entry.id, entry]));
  const currentSignatures = new Set(state.entries.map(entryImportSignature));
  let added = 0;
  let updated = 0;
  let skipped = 0;
  const accepted = [];
  normalizedImported.forEach((entry) => {
    if (currentById.has(entry.id)) {
      updated += 1;
      accepted.push(entry);
      return;
    }
    const signature = entryImportSignature(entry);
    if (currentSignatures.has(signature)) {
      skipped += 1;
      return;
    }
    added += 1;
    accepted.push(entry);
    currentSignatures.add(signature);
  });

  const sourceTitle = String(payload?.source?.title || '取込データ');
  const missingRows = Array.isArray(payload?.validation?.sourceFormulaMissingRows) ? payload.validation.sourceFormulaMissingRows : [];
  const validationNote = missingRows.length
    ? `\n\n元表の金額欄が未計算の${missingRows.length}行は、人工・単価・経費からNINQが計算します。`
    : '';
  const message = `${sourceTitle}を追加します。\n\n新規 ${added}件\n更新 ${updated}件\n重複のため除外 ${skipped}件${validationNote}\n\n現在のデータは残ります。続けますか？`;
  if (!window.confirm(message)) return null;

  exportBackupJson();
  const acceptedIds = new Set(accepted.map((entry) => entry.id));
  const entries = state.entries.filter((entry) => !acceptedIds.has(entry.id));
  entries.push(...accepted);
  const deletedEntryIds = { ...(state.deletedEntryIds || {}) };
  acceptedIds.forEach((id) => delete deletedEntryIds[id]);
  state = normalizeState({ ...state, entries, deletedEntryIds, settings: { ...state.settings, companyRates: presets, companies: presets.map((preset) => preset.name) } });
  markSettingsSections('companies');
  saveState();
  renderAll();
  scheduleDriveAutoSync({ delay: 800, message: '取込データをクラウドへ保存します...' });
  showSaveFeedback(`${added + updated}件を追加しました`);
  setSyncLog(`${sourceTitle}: 新規${added}件 / 更新${updated}件 / 重複除外${skipped}件`);
  return { added, updated, skipped };
}
function importBackupJson(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(reader.result);
      if (payload?.importMode === 'merge') {
        mergeImportPayload(payload);
        return;
      }
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
function persistSettingsFromForm({ render = false, feedback = '', sections = [] } = {}) {
  const linesToObjects = (text, previous) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((label, index) => ({ id: previous[index]?.id || `exp${index + 1}`, label }));
  const companyRates = companyPresetValues();
  const nextExpenseItems = linesToObjects(document.getElementById('st-expenses').value, expenseItems());
  const checkedDayModalItems = [...document.querySelectorAll('[data-day-modal-item]:checked')].map((input) => input.dataset.dayModalItem);
  const dayModalItems = normalizeDayModalItems(checkedDayModalItems, nextExpenseItems);
  const salesTotalParts = {
    labor: document.getElementById('tgl-sales-labor')?.classList.contains('on') !== false,
    overtime: document.getElementById('tgl-sales-overtime')?.classList.contains('on') !== false,
    expenses: document.getElementById('tgl-sales-expenses')?.classList.contains('on') === true,
  };
  state.settings = { ...state.settings, name: document.getElementById('st-name').value.trim(), postalCode: document.getElementById('st-postal').value.trim(), address: document.getElementById('st-addr').value.trim(), tel: document.getElementById('st-tel').value.trim(), companyName: document.getElementById('st-co').value.trim(), bank: document.getElementById('st-bank').value.trim(), branch: document.getElementById('st-branch').value.trim(), accountNo: document.getElementById('st-accno').value.trim(), accountName: document.getElementById('st-accname').value.trim(), invoiceNo: document.getElementById('st-invno').value.trim(), invoiceEnabled: document.getElementById('tgl-inv').classList.contains('on'), showSubcontract: document.getElementById('tgl-subcontract')?.classList.contains('on') !== false, uiSize: fontSizeLevel(document.getElementById('st-ui-size')?.value || DEFAULT_SETTINGS.uiSize), fontChoice: document.getElementById('st-font-choice')?.value || DEFAULT_SETTINGS.fontChoice, invoiceFontSize: fontSizeLevel(document.getElementById('st-invoice-font-size')?.value || state.settings.invoiceFontSize || DEFAULT_SETTINGS.invoiceFontSize), salesTotalParts, taxRate: num(document.getElementById('st-tax').value || 10), stampImage: state.settings.stampImage || '', defaultDayRate: 0, defaultNightRate: 0, defaultOtRate: 0, companyRates, companies: companyRates.map((item) => item.name), expenseItems: nextExpenseItems, dayModalItems };
  markSettingsSections(sections.length ? sections : Object.keys(SETTINGS_SECTIONS).filter((section) => section !== 'google'));
  state.entries = state.entries.map((entry) => { const nextExpenses = {}; expenseItems().forEach((item) => { nextExpenses[item.id] = num(entry.expenses?.[item.id]); }); return { ...entry, expenses: nextExpenses }; });
  applyDisplayPreferences();
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
function createStampImageData(file, maxDimension = 480, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || (file.type && !file.type.startsWith('image/'))) {
      reject(new Error('画像ファイルを選択してください'));
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    const release = () => URL.revokeObjectURL(objectUrl);
    image.onload = () => {
      try {
        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) throw new Error('画像の大きさを確認できませんでした');
        const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('画像を変換できませんでした');
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, width, height);
        const webp = canvas.toDataURL('image/webp', quality);
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      } finally {
        release();
      }
    };
    image.onerror = () => {
      release();
      reject(new Error('印鑑画像を読み込めませんでした'));
    };
    image.src = objectUrl;
  });
}
async function handleStampFile(file) {
  if (!file) return;
  try {
    state.settings.stampImage = await createStampImageData(file);
    markSettingsSections('invoice');
    saveState();
    renderAll();
    scheduleDriveAutoSync({ message: '印鑑設定をクラウドへ保存します...' });
    showSaveFeedback('印鑑を登録しました');
  } catch (error) {
    alert(error.message || '印鑑画像を読み込めませんでした');
  }
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
  const group = entryRangeGroup(target);
  const ids = group.ids.size ? group.ids : new Set([id]);
  state.entries = state.entries.filter((entry) => !ids.has(entry.id));
  tombstoneEntryIds([...ids]);
  saveState(); renderAll(); scheduleDriveAutoSync();
}

function deleteEntryConfirmMessage(id) {
  const target = state.entries.find((entry) => entry.id === id);
  if (!target) return 'この予定を削除しますか？';
  const group = entryRangeGroup(target);
  if (group.entries.length <= 1) return 'この予定を削除しますか？';
  return `${shortDateLabel(group.start)}〜${shortDateLabel(group.end)}のつながった予定を、すべて削除しますか？`;
}
function gcalEntry(id) {
  const entry = state.entries.find((item) => item.id === id); if (!entry) return;
  window.open(googleCalendarUrl(entry), '_blank');
}
function csvCell(value) { const text = String(value ?? ''); return `"${text.replaceAll('"', '""')}"`; }
function downloadCsv(filename, rows) { const csv = `\ufeff${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`; const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function reportFileBase(kind) {
  const month = `${cursor.getFullYear()}年${cursor.getMonth() + 1}月`;
  return `${month}${kind}`;
}
function exportDemenCsv() {
  const rows = [['日付', '会社名', '現場名', '勤務区分', '売上方式', '人工', '単価', '人工計', '請負金額', '残業h', '残業計', ...expenseItems().map((item) => item.label), '合計']];
  entriesForInvoiceCompany().forEach((entry) => {
    const calc = calcEntry(entry);
    rows.push([entry.date, companySheetName(entry.company), entry.site, shiftLabel(entry.shift), billingTypeLabel(entry), calc.qty || '', calc.unitRate || '', calc.labor || '', calc.contractAmount || '', calc.otHours || '', calc.overtime || '', ...expenseItems().map((item) => num(entry.expenses?.[item.id])), calc.subtotal]);
  });
  downloadCsv(`${reportFileBase('出面表')}.csv`, rows);
}
function exportSubPaymentsCsv() {
  const rows = [['日付', '職人名', '会社名', '現場名', '勤務', '売上方式', '人工', '単価', '請負金額', '売上計算', '支払金額', '差額', 'メモ']];
  monthEntries().filter((entry) => entry.type === 'sub').forEach((entry) => {
    const calc = calcEntry(entry);
    rows.push([entry.date, entry.workerName || '', companySheetName(entry.company), entry.site, shiftLabel(entry.shift), billingTypeLabel(entry), calc.qty, calc.unitRate, calc.contractAmount, calc.subtotal, calc.subcontractPay, calc.subcontractDiff, entry.notes || '']);
  });
  downloadCsv(`${monthKey(cursor)}_外注支払い.csv`, rows);
}
function exportInvoiceCsv() {
  const totals = invoiceTotals(entriesForInvoiceCompany());
  downloadCsv(`${reportFileBase('請求書')}.csv`, [['請求先', companyOfficialName(selectedCompany)], ['対象月', fmtMonth(cursor)], ['対象期間', companyBillingPeriodLabel(selectedCompany)], ['売上方式', '金額'], ['人工売上', totals.labor], ['請負金額', totals.contract], ['残業', totals.overtime], ['売上（税別）', totals.subtotal], ['消費税', totals.tax], ['諸経費', totals.expenseTotal], ['合計', totals.total]]);
}
function printView(kind) {
  const screen = document.getElementById('sc-inv');
  const demen = document.getElementById('print-demen-wrap');
  const invoice = document.getElementById('print-invoice-box');
  const previousTitle = document.title;
  const printTitle = reportFileBase(kind === 'invoice' ? '請求書' : '出面表');
  const cleanup = () => {
    window.clearTimeout(printCleanupTimer);
    if (document.title === printTitle) document.title = previousTitle;
    demen?.classList.remove('hidden');
    invoice?.classList.remove('hidden');
    screen?.classList.remove('print-active', 'printing-invoice', 'printing-demen');
    window.removeEventListener('afterprint', cleanup);
  };
  window.clearTimeout(printCleanupTimer);
  window.removeEventListener('afterprint', cleanup);
  screen?.classList.add('print-active', kind === 'invoice' ? 'printing-invoice' : 'printing-demen');
  if (kind === 'invoice') demen?.classList.add('hidden');
  else invoice?.classList.add('hidden');
  document.title = printTitle;
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
  printCleanupTimer = window.setTimeout(cleanup, 60000);
}
function desktopSheetEntryFromRow(row, existing = null) {
  const value = (field) => row.querySelector(`[data-sheet-field="${field}"]`)?.value?.trim() || '';
  const expenses = {};
  row.querySelectorAll('[data-sheet-field="expense"]').forEach((input) => { expenses[input.dataset.expenseId] = num(input.value); });
  const hasText = value('company') || value('site');
  const hasNumbers = ['qty', 'unitRate', 'otHours', 'otRate'].some((field) => num(value(field))) || Object.values(expenses).some((amount) => num(amount));
  if (!existing && !hasText && !hasNumbers) return null;
  const now = new Date().toISOString();
  return normalizeEntry({
    ...(existing || {}),
    id: existing?.id || crypto.randomUUID(),
    date: row.dataset.date,
    type: 'self',
    shift: value('shift') || existing?.shift || 'day',
    company: normalizeCompanyInputName(value('company')),
    site: value('site'),
    qty: value('qty') === '' && !existing ? 1 : qtyValue(value('qty')),
    unitRate: num(value('unitRate')),
    otHours: num(value('otHours')),
    otRate: num(value('otRate')),
    expenses,
    invoiceMode: existing?.invoiceMode || 'with',
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  });
}
function calcDesktopSheetRow(row) {
  const entry = desktopSheetEntryFromRow(row, { id: 'preview', date: row.dataset.date, createdAt: new Date().toISOString() });
  if (!entry) return { labor: 0, overtime: 0, subtotal: 0 };
  return calcEntry(entry);
}
function updateDesktopSheetRowTotals(row) {
  const calc = calcDesktopSheetRow(row);
  const set = (key, value) => { const el = row.querySelector(`[data-sheet-total="${key}"]`); if (el) el.textContent = value ? yenPlain(value) : ''; };
  set('labor', calc.labor);
  set('overtime', calc.overtime);
  set('subtotal', calc.subtotal);
}
function saveDesktopSheetRow(row) {
  const existing = row.dataset.entryId ? state.entries.find((entry) => entry.id === row.dataset.entryId) : null;
  const entry = desktopSheetEntryFromRow(row, existing);
  if (!entry) { updateDesktopSheetRowTotals(row); return; }
  state.entries = state.entries.filter((item) => item.id !== entry.id);
  state.entries.push(entry);
  if (state.deletedEntryIds) delete state.deletedEntryIds[entry.id];
  selectedDate = entry.date;
  cursor = startOfMonth(fromYmd(entry.date));
  saveState();
  row.dataset.entryId = entry.id;
  updateDesktopSheetRowTotals(row);
  renderCalendar();
  renderDayEntries();
  renderInvoiceScreen();
  updateDesktopSheetFooter();
  scheduleDriveAutoSync();
}
function bindEvents() {
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { if (activeScreen === 'st') flushSettingsAutosave(); activeScreen = button.dataset.screen; renderAll(); }));
  const salesToggle = document.getElementById('toggle-sales-btn');
  if (salesToggle) salesToggle.addEventListener('click', () => { state.settings.showSales = !state.settings.showSales; markSettingsSections('display'); saveState(); renderAll(); scheduleDriveAutoSync({ message: '表示設定をクラウドへ保存します...' }); });
  ['prev-month-btn', 'sub-prev-month-btn'].forEach((id) => document.getElementById(id).addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); if (monthKey(selectedDate) !== monthKey(cursor)) selectedDate = toYmd(cursor); renderAll(); }));
  ['next-month-btn', 'sub-next-month-btn'].forEach((id) => document.getElementById(id).addEventListener('click', () => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); if (monthKey(selectedDate) !== monthKey(cursor)) selectedDate = toYmd(cursor); renderAll(); }));
  document.getElementById('inv-prev-month-btn')?.addEventListener('click', () => { cursor = invoiceViewMode === 'annual' ? new Date(cursor.getFullYear() - 1, cursor.getMonth(), 1) : new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); expandedAnnualMonth = ''; renderAll(); });
  document.getElementById('inv-next-month-btn')?.addEventListener('click', () => { cursor = invoiceViewMode === 'annual' ? new Date(cursor.getFullYear() + 1, cursor.getMonth(), 1) : new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); expandedAnnualMonth = ''; renderAll(); });
  document.getElementById('fab-main').addEventListener('click', () => { closeDayModal(); openModal('self'); });
  document.getElementById('open-sheet-btn')?.addEventListener('click', openSheetPage);
  document.getElementById('fab-sub').addEventListener('click', () => { if (!subcontractEnabled()) return; closeDayModal(); openModal('sub'); });
  document.getElementById('save-settings-btn').addEventListener('click', saveSettings);
  document.getElementById('add-company-btn')?.addEventListener('click', addCompanyPreset);
  document.getElementById('add-expense-btn')?.addEventListener('click', () => addSettingListItem('st-expenses', 'st-expense-new'));
  ['st-company-new', 'st-company-sheet-new', 'st-company-official-new', 'st-company-day-new', 'st-company-night-new', 'st-company-ot-new'].forEach((id) => document.getElementById(id)?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addCompanyPreset(); } }));
  document.getElementById('st-expense-new')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); addSettingListItem('st-expenses', 'st-expense-new'); } });
  document.getElementById('save-google-settings-btn')?.addEventListener('click', saveGoogleSettings);
  document.getElementById('google-login-btn')?.addEventListener('click', loginFirebaseCloud);
  document.getElementById('google-auto-sync')?.addEventListener('change', () => {
    saveGoogleSettings({ feedback: false, render: false });
    setSyncLog(state.settings.googleSyncEnabled ? '自動同期をONにしました。ログイン済みなら自動で同期します' : '自動同期をOFFにしました');
    if (state.settings.googleSyncEnabled) { syncFirebaseCloud({ auto: true, reason: 'startup' }); scheduleFirebasePollSoon(2500); }
    else renderSyncScreen();
  });
  document.getElementById('google-conflict-mode')?.addEventListener('change', () => {
    saveGoogleSettings({ feedback: false, render: false });
    setSyncLog(state.settings.googleConflictMode === 'confirm' ? '競合時は確認して選びます' : '競合時は更新日時が新しい方を採用します');
    renderSyncScreen();
  });
  document.getElementById('drive-send-device-btn')?.addEventListener('click', sendDeviceToFirebase);
  document.getElementById('drive-receive-device-btn')?.addEventListener('click', receiveDeviceFromFirebase);
  document.getElementById('google-export-range-btn')?.addEventListener('click', exportRangeCalendarIcs);
  document.getElementById('google-open-selected-day-btn')?.addEventListener('click', openSelectedDayGoogleCalendar);
  document.getElementById('backup-export-btn')?.addEventListener('click', exportBackupJson);
  document.getElementById('backup-import-btn')?.addEventListener('click', () => document.getElementById('backup-file')?.click());
  document.getElementById('backup-file')?.addEventListener('change', (event) => { importBackupJson(event.target.files?.[0]); event.target.value = ''; });
  document.getElementById('stamp-pick-btn')?.addEventListener('click', () => document.getElementById('st-stamp-file')?.click());
  document.getElementById('st-stamp-file')?.addEventListener('change', (event) => { handleStampFile(event.target.files?.[0]); event.target.value = ''; });
  document.getElementById('stamp-clear-btn')?.addEventListener('click', clearStampImage);
  document.getElementById('tgl-inv').addEventListener('click', () => { document.getElementById('tgl-inv').classList.toggle('on'); document.getElementById('inv-no-row').classList.toggle('hidden', !document.getElementById('tgl-inv').classList.contains('on')); scheduleSettingsAutosave({ immediate: true, section: 'invoice' }); });
  document.getElementById('tgl-subcontract')?.addEventListener('click', () => { document.getElementById('tgl-subcontract').classList.toggle('on'); scheduleSettingsAutosave({ immediate: true, section: 'display' }); });
  ['tgl-sales-labor', 'tgl-sales-overtime', 'tgl-sales-expenses'].forEach((id) => document.getElementById(id)?.addEventListener('click', () => { document.getElementById(id).classList.toggle('on'); scheduleSettingsAutosave({ immediate: true, section: 'display' }); }));
  document.getElementById('modal-bg').addEventListener('click', (event) => { if (event.target.id === 'modal-bg') closeModal(); });
  document.addEventListener('click', (event) => {
    if (event.target.id === 'expense-quick-edit-bg' || event.target.closest('[data-expense-quick-cancel]')) { closeExpenseQuickEdit(); return; }
    const expenseChip = event.target.closest('[data-expense-entry-id][data-expense-id]');
    if (expenseChip) { openExpenseQuickEdit(expenseChip.dataset.expenseEntryId, expenseChip.dataset.expenseId); return; }
    if (event.target.id === 'date-picker-bg' || event.target.matches('[data-date-picker-cancel]')) { closeDatePicker(); return; }
    if (event.target.matches('[data-date-picker-ok]')) { commitDatePicker(); return; }
    if (event.target.matches('[data-date-picker-prev]')) { datePickerCursor = new Date(datePickerCursor.getFullYear(), datePickerCursor.getMonth() - 1, 1); renderDatePicker(); return; }
    if (event.target.matches('[data-date-picker-next]')) { datePickerCursor = new Date(datePickerCursor.getFullYear(), datePickerCursor.getMonth() + 1, 1); renderDatePicker(); return; }
    const datePick = event.target.closest('[data-date-pick]');
    if (datePick) { datePickerValue = datePick.dataset.datePick; datePickerCursor = startOfMonth(fromYmd(datePickerValue)); renderDatePicker(); return; }
    const datePickerInput = event.target.closest('[data-date-picker]');
    if (datePickerInput) { openDatePicker(datePickerInput); return; }
    const toggleCompanyPreset = event.target.closest('[data-toggle-company-preset]');
    if (toggleCompanyPreset) { openCompanyPresetId = openCompanyPresetId === toggleCompanyPreset.dataset.toggleCompanyPreset ? '' : toggleCompanyPreset.dataset.toggleCompanyPreset; renderCompanyPresetList(); return; }
    const removeCompanyPreset = event.target.closest('[data-remove-company-preset]');
    if (removeCompanyPreset) {
      const index = Number(removeCompanyPreset.dataset.removeCompanyPreset);
      const current = companyPresetValues();
      const removed = current[index];
      if (!removed || !confirm(`${removed.name} を登録会社から削除しますか？`)) return;
      const deletedAt = new Date().toISOString();
      state.settings.deletedCompanyPresetIds = {
        ...(state.settings.deletedCompanyPresetIds || {}),
        [removed.id]: deletedAt,
        [`name:${String(removed.name || '').trim().toLowerCase()}`]: deletedAt,
      };
      const values = current.filter((_, itemIndex) => itemIndex !== index);
      openCompanyPresetId = '';
      writeCompanyPresetValues(values);
      renderCompanyPresetList();
      scheduleSettingsAutosave({ immediate: true, section: 'companies' });
      return;
    }
    const removeSettingItem = event.target.closest('[data-remove-setting-item]');
    if (removeSettingItem) { const hiddenId = removeSettingItem.dataset.removeSettingItem; const index = Number(removeSettingItem.dataset.removeIndex); const values = settingListValues(hiddenId).filter((_, itemIndex) => itemIndex !== index); writeSettingList(hiddenId, values); scheduleSettingsAutosave({ immediate: true, section: 'expenses' }); renderSettingListEditors(); return; }
    const closeDayButton = event.target.closest('[data-close-day-modal]');
    if (closeDayButton || event.target.id === 'day-modal-bg') { closeDayModal(); return; }
    const closeSheetButton = event.target.closest('[data-close-sheet-page]');
    if (closeSheetButton) { closeSheetPage(); return; }
    const menuButton = event.target.closest('#menu-toggle-btn,[data-menu-open]');
    if (menuButton) {
      const screen = menuButton.closest('.screen');
      const menu = screen?.querySelector('.top-menu') || document.getElementById('top-menu');
      menu?.classList.toggle('hidden');
      return;
    }
    const screenLink = event.target.closest('[data-screen-link]');
    if (screenLink) { if (activeScreen === 'st') flushSettingsAutosave(); activeScreen = screenLink.dataset.screenLink; if (activeScreen !== 'cal') closeDayModal(); renderAll(); return; }
    const otherSales = event.target.closest('[data-sales-toggle]');
    if (otherSales) { state.settings.showSales = !state.settings.showSales; markSettingsSections('display'); saveState(); renderAll(); scheduleDriveAutoSync({ message: '表示設定をクラウドへ保存します...' }); return; }
    const invoiceView = event.target.closest('[data-invoice-view]');
    if (invoiceView) { invoiceViewMode = invoiceView.dataset.invoiceView === 'annual' ? 'annual' : 'monthly'; expandedAnnualMonth = ''; renderAll(); return; }
    const annualMonth = event.target.closest('[data-annual-month]');
    if (annualMonth) { expandedAnnualMonth = expandedAnnualMonth === annualMonth.dataset.annualMonth ? '' : annualMonth.dataset.annualMonth; renderInvoiceScreen(); return; }
    const dayButton = event.target.closest('.cal-day');
    if (dayButton) { openDayModal(dayButton.dataset.date); return; }
    const addDate = event.target.closest('[data-add-date]');
    if (addDate) { selectedDate = addDate.dataset.addDate; closeDayModal(); openModal('self'); return; }
    const editButton = event.target.closest('[data-edit-entry]'); if (editButton) { closeDayModal(); openModal('self', editButton.dataset.editEntry); return; }
    const delButton = event.target.closest('[data-del-entry]'); if (delButton) { if (confirm(deleteEntryConfirmMessage(delButton.dataset.delEntry))) deleteEntry(delButton.dataset.delEntry); return; }
    const companySelect = event.target.closest('#f-company-select');
    if (companySelect) { const input = document.getElementById('f-company'); if (input && companySelect.value) { input.value = companySheetName(companySelect.value); applyCompanyRate(companySelect.value); updateSubcontractDiff(); } return; }
    const companyChip = event.target.closest('[data-company]'); if (companyChip) { selectedCompany = companyChip.dataset.company; expandedAnnualMonth = ''; renderInvoiceScreen(); return; }
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
    if (event.target.matches('[data-billing-type]')) {
      document.querySelectorAll('[data-billing-type]').forEach((button) => button.classList.remove('active'));
      event.target.classList.add('active');
      updateBillingTypeFields();
      return;
    }
    if (!event.target.closest('.top-menu') && !event.target.closest('.ghost-icon-btn')) {
      document.querySelectorAll('.top-menu').forEach((menu) => menu.classList.add('hidden'));
    }
  });

  document.addEventListener('mousedown', (event) => {
    if (window.innerWidth < 900) return;
    const cell = event.target.closest('#desktop-sheet-panel [data-sheet-cell]');
    if (!cell || event.button !== 0) return;
    sheetMouseSelecting = true;
    setSheetSelection(cell, cell);
  });

  document.addEventListener('mouseover', (event) => {
    if (!sheetMouseSelecting || window.innerWidth < 900) return;
    const cell = event.target.closest('#desktop-sheet-panel [data-sheet-cell]');
    if (!cell) return;
    const anchor = document.querySelector('#desktop-sheet-panel .desktop-sheet-cell-anchor');
    setSheetSelection(anchor || cell, cell);
  });

  document.addEventListener('mouseup', () => {
    sheetMouseSelecting = false;
  });

  document.addEventListener('copy', copySheetSelection);
  document.addEventListener('paste', pasteSheetSelection);

  document.addEventListener('touchstart', (event) => {
    if (activeScreen !== 'cal' || window.innerWidth >= 900 || !isSheetPageOpen) return;
    if (event.touches.length === 1 && event.target.closest('#desktop-sheet-panel')) {
      const scroll = document.querySelector('#desktop-sheet-panel .desktop-sheet-scroll');
      const touch = event.touches[0];
      sheetDragStart = scroll ? { x: touch.clientX, y: touch.clientY, left: scroll.scrollLeft, top: scroll.scrollTop, active: false } : null;
    }
    if (event.touches.length === 2 && event.target.closest('#desktop-sheet-panel')) {
      sheetPinchStart = { distance: touchDistance(event.touches), zoom: sheetZoom };
      sheetDragStart = null;
    }
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (activeScreen !== 'cal' || window.innerWidth >= 900 || !isSheetPageOpen) return;
    if (event.touches.length === 2 && event.target.closest('#desktop-sheet-panel')) {
      event.preventDefault();
      if (!sheetPinchStart) sheetPinchStart = { distance: touchDistance(event.touches), zoom: sheetZoom };
      const nextZoom = sheetPinchStart.zoom * (touchDistance(event.touches) / sheetPinchStart.distance);
      sheetZoom = clampSheetZoom(nextZoom);
      applySheetZoom();
      return;
    }
    if (event.touches.length === 1 && sheetDragStart && event.target.closest('#desktop-sheet-panel')) {
      const scroll = document.querySelector('#desktop-sheet-panel .desktop-sheet-scroll');
      if (!scroll) return;
      const touch = event.touches[0];
      const dx = touch.clientX - sheetDragStart.x;
      const dy = touch.clientY - sheetDragStart.y;
      if (!sheetDragStart.active && Math.hypot(dx, dy) < 7) return;
      sheetDragStart.active = true;
      event.preventDefault();
      if (document.activeElement?.matches?.('.desktop-sheet-input')) document.activeElement.blur();
      scroll.scrollLeft = sheetDragStart.left - dx;
      scroll.scrollTop = sheetDragStart.top - dy;
    }
  }, { passive: false });

  document.addEventListener('touchend', (event) => {
    if (event.touches.length < 2) sheetPinchStart = null;
    if (event.touches.length === 0) sheetDragStart = null;
  }, { passive: true });

  document.addEventListener('change', (event) => {
    const sheetInput = event.target.closest('[data-sheet-field]');
    if (sheetInput) { saveDesktopSheetRow(sheetInput.closest('[data-sheet-row]')); return; }
    if (event.target.id === 'f-date' || event.target.id === 'f-end-date') { renderRangeExclusions(); return; }
    if (event.target.matches('[data-day-modal-item]')) { scheduleSettingsAutosave({ immediate: true, section: 'expenses' }); return; }
    if (event.target.id === 'google-export-start' || event.target.id === 'google-export-end') { renderSyncScreen(); return; }
    if (event.target.id === 'invoice-font-size-select') {
      state.settings.invoiceFontSize = fontSizeLevel(event.target.value || DEFAULT_SETTINGS.invoiceFontSize);
      markSettingsSections('invoice');
      saveState();
      renderInvoiceScreen();
      scheduleDriveAutoSync({ message: '請求書フォント設定をクラウドへ保存します...' });
      return;
    }
    if (event.target.matches('[data-company-preset-field="closingDay"]')) {
      updateCompanyPresetField(event.target.dataset.companyPresetId, 'closingDay', event.target.value);
      return;
    }
    if (event.target.matches('#st-tax,#st-invoice-font-size')) { scheduleSettingsAutosave({ immediate: true, section: 'invoice' }); return; }
    if (event.target.matches('#st-ui-size,#st-font-choice')) { scheduleSettingsAutosave({ immediate: true, section: 'display' }); return; }
    if (event.target.matches('[data-range-exclude]')) { event.target.closest('.range-exclude-chip')?.classList.toggle('checked', event.target.checked); return; }
    if (event.target.id === 'f-company-select') { const input = document.getElementById('f-company'); if (input && event.target.value) { input.value = companySheetName(event.target.value); applyCompanyRate(event.target.value); updateSubcontractDiff(); } return; }
    if (event.target.id === 'f-company') {
      const select = document.getElementById('f-company-select');
      const preset = companyPresetByAnyName(event.target.value);
      if (select) select.value = preset?.name || '';
    }
    if (event.target.id === 'f-shift') { applyCompanyRate(document.getElementById('f-company')?.value.trim()); updateSubcontractDiff(); }
  });

  document.addEventListener('input', (event) => {
    const sheetInput = event.target.closest('[data-sheet-field]');
    if (sheetInput) { updateDesktopSheetRowTotals(sheetInput.closest('[data-sheet-row]')); return; }
    if (event.target.matches('#st-name,#st-postal,#st-addr,#st-tel,#st-co')) scheduleSettingsAutosave({ section: 'profile' });
    if (event.target.matches('#st-bank,#st-branch,#st-accno,#st-accname')) scheduleSettingsAutosave({ section: 'bank' });
    if (event.target.matches('#st-invno')) scheduleSettingsAutosave({ section: 'invoice' });
    if (event.target.matches('[data-company-preset-field]')) updateCompanyPresetField(event.target.dataset.companyPresetId, event.target.dataset.companyPresetField, event.target.value);
    if (event.target.matches('#entry-form input, #entry-form textarea, #entry-form select')) { updateBillingTypeFields(); updateSubcontractDiff(); }
  });
  window.addEventListener('beforeunload', flushSettingsAutosave);

  document.addEventListener('submit', (event) => {
    if (event.target.id !== 'entry-form') return;
    event.preventDefault();
    try { const entries = collectEntryForm(); upsertEntries(entries); closeModal(); } catch (error) { alert(error.message || '保存に失敗しました'); }
  });
}

function registerPwa() { if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('sw failed', error)); }
function shouldPollFirebaseCloud() {
  return !!(state.settings.googleSyncEnabled
    && firebaseUser
    && firebaseAvailable()
    && navigator.onLine
    && document.visibilityState !== 'hidden'
    && !firebaseSyncInFlight
    && !isEditingSyncSensitiveField());
}
function pollFirebaseCloud() {
  if (!shouldPollFirebaseCloud()) return;
  syncFirebaseCloud({ auto: true, reason: loadSyncPending().pending ? 'save' : 'poll' });
}
function scheduleFirebasePollSoon(delay = 1200) {
  window.setTimeout(pollFirebaseCloud, delay);
}
function startFirebaseCloudPolling() {
  if (firebasePollingStarted) return;
  firebasePollingStarted = true;
  window.clearInterval(firebasePollTimer);
  firebasePollTimer = window.setInterval(pollFirebaseCloud, FIREBASE_POLL_INTERVAL_MS);
  window.addEventListener('focus', () => scheduleFirebasePollSoon(1000));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleFirebasePollSoon(1000);
  });
}
function initFirebaseCloudHooks() {
  if (firebaseInitStarted) return;
  firebaseInitStarted = true;
  window.addEventListener('ninq-firebase-ready', () => {
    renderSyncScreen();
    const user = window.NinqFirebaseCloud?.currentUser?.();
    if (user) {
      firebaseUser = user;
      if (state.settings.googleSyncEnabled && navigator.onLine) {
        window.setTimeout(() => syncFirebaseCloud({ auto: true, reason: loadSyncPending().pending ? 'save' : 'startup' }), 700);
        scheduleFirebasePollSoon(2500);
      }
    }
  });
  window.addEventListener('ninq-firebase-auth', (event) => {
    firebaseUser = event.detail?.user || null;
    if (firebaseUser) {
      state.settings.googleAccountEmail = firebaseUser.email || state.settings.googleAccountEmail || '';
      state.settings.googleSyncEnabled = true;
      markSettingsSections('google');
      saveState();
      setSyncLog(`${firebaseUser.email || 'Googleアカウント'} でNINQクラウドにログインしました`);
      syncFirebaseCloud({ auto: true, reason: loadSyncPending().pending ? 'save' : 'startup' });
      scheduleFirebasePollSoon(2500);
    } else {
      renderSyncScreen();
    }
  });
  window.addEventListener('ninq-firebase-error', (event) => {
    setSyncLog(event.detail?.message || 'Firebaseでエラーが発生しました');
  });
  if (window.NinqFirebaseCloud) {
    renderSyncScreen();
    const user = window.NinqFirebaseCloud.currentUser?.();
    if (user) {
      firebaseUser = user;
      if (state.settings.googleSyncEnabled && navigator.onLine) {
        window.setTimeout(() => syncFirebaseCloud({ auto: true, reason: loadSyncPending().pending ? 'save' : 'startup' }), 700);
        scheduleFirebasePollSoon(2500);
      }
    }
  }
}
function startCloudSyncHooks() {
  initFirebaseCloudHooks();
  startFirebaseCloudPolling();
  window.addEventListener('online', () => {
    if (!state.settings.googleSyncEnabled) return;
    const pending = loadSyncPending();
    setSyncLog(pending.pending ? 'オンラインに戻りました。未送信の変更を送信します...' : 'オンラインに戻りました。クラウドを確認します...');
    if (firebaseUser || window.NinqFirebaseCloud) syncFirebaseCloud({ auto: true, reason: pending.pending ? 'save' : 'startup' });
    else if (state.settings.googleClientId) syncGoogleDrive({ auto: true, reason: pending.pending ? 'save' : 'startup' });
  });
  window.addEventListener('offline', () => {
    if (state.settings.googleSyncEnabled) setSyncLog('オフラインです。変更は端末に一時保存します');
    renderSyncScreen();
  });
  if (state.settings.googleSyncEnabled && firebaseUser && navigator.onLine) {
    window.setTimeout(() => syncFirebaseCloud({ auto: true, reason: loadSyncPending().pending ? 'save' : 'startup' }), 900);
  } else if (state.settings.googleSyncEnabled && state.settings.googleClientId && navigator.onLine && !window.NinqFirebaseCloud) {
    window.setTimeout(() => syncGoogleDrive({ auto: true, reason: loadSyncPending().pending ? 'save' : 'startup' }), 900);
  }
}
function init() {
  bindEvents();
  renderAll();
  window.setTimeout(() => { cleanupLegacyDisplayPreferences(); applyDisplayPreferences(); }, 0);
  window.setTimeout(() => { cleanupLegacyDisplayPreferences(); applyDisplayPreferences(); }, 600);
  startCloudSyncHooks();
  registerPwa();
}
document.addEventListener('DOMContentLoaded', init);
