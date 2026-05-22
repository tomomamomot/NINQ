(function () {
  const STYLE_ID = 'ninq-calendar-connections-style';
  const HOLIDAY_CACHE = new Map();

  function columnIndex(date) {
    return (date.getDay() + 6) % 7;
  }

  function ymdFromParts(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function nthMonday(year, month, nth) {
    const date = new Date(year, month - 1, 1);
    const offset = (8 - date.getDay()) % 7;
    return 1 + offset + (nth - 1) * 7;
  }

  function addHoliday(map, year, month, day, name) {
    map.set(ymdFromParts(year, month, day), name);
  }

  function equinoxDay(year, spring) {
    const base = spring ? 20.8431 : 23.2488;
    return Math.floor(base + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  function buildHolidayMap(year) {
    const map = new Map();
    addHoliday(map, year, 1, 1, '元日');
    addHoliday(map, year, 1, nthMonday(year, 1, 2), '成人の日');
    addHoliday(map, year, 2, 11, '建国記念の日');
    if (year >= 2020) addHoliday(map, year, 2, 23, '天皇誕生日');
    addHoliday(map, year, 3, equinoxDay(year, true), '春分の日');
    addHoliday(map, year, 4, 29, '昭和の日');
    addHoliday(map, year, 5, 3, '憲法記念日');
    addHoliday(map, year, 5, 4, 'みどりの日');
    addHoliday(map, year, 5, 5, 'こどもの日');
    if (year === 2020) addHoliday(map, year, 7, 23, '海の日');
    else if (year === 2021) addHoliday(map, year, 7, 22, '海の日');
    else addHoliday(map, year, 7, nthMonday(year, 7, 3), '海の日');
    if (year === 2020) addHoliday(map, year, 8, 10, '山の日');
    else if (year === 2021) addHoliday(map, year, 8, 8, '山の日');
    else if (year >= 2016) addHoliday(map, year, 8, 11, '山の日');
    addHoliday(map, year, 9, nthMonday(year, 9, 3), '敬老の日');
    addHoliday(map, year, 9, equinoxDay(year, false), '秋分の日');
    if (year === 2020) addHoliday(map, year, 7, 24, 'スポーツの日');
    else if (year === 2021) addHoliday(map, year, 7, 23, 'スポーツの日');
    else addHoliday(map, year, 10, nthMonday(year, 10, 2), 'スポーツの日');
    addHoliday(map, year, 11, 3, '文化の日');
    addHoliday(map, year, 11, 23, '勤労感謝の日');

    [...map.keys()].sort().forEach((ymd) => {
      const date = fromYmd(ymd);
      if (date.getDay() !== 0) return;
      date.setDate(date.getDate() + 1);
      while (map.has(toYmd(date))) date.setDate(date.getDate() + 1);
      if (date.getFullYear() === year) map.set(toYmd(date), '振替休日');
    });

    for (let m = 0; m < 12; m += 1) {
      const date = new Date(year, m, 2);
      while (date.getMonth() === m) {
        const ymd = toYmd(date);
        if (!map.has(ymd) && map.has(toYmd(new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1))) && map.has(toYmd(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)))) {
          map.set(ymd, '国民の休日');
        }
        date.setDate(date.getDate() + 1);
      }
    }
    return map;
  }

  function holidayName(ymd) {
    const year = Number(String(ymd).slice(0, 4));
    if (!HOLIDAY_CACHE.has(year)) HOLIDAY_CACHE.set(year, buildHolidayMap(year));
    return HOLIDAY_CACHE.get(year).get(ymd) || '';
  }

  window.ninqHolidayName = holidayName;

  function bandKey(entry) {
    const company = String(entry?.company || '').trim();
    const site = String(entry?.site || '').trim();
    if (!company || !site) return '';
    return [entry.type || 'self', entry.shift || 'day', company, site, entry.workerName || ''].join('\u001f');
  }

  function sameWorkBand(a, b) {
    return !!bandKey(a) && bandKey(a) === bandKey(b);
  }

  function hasAdjacentBand(ymd, entry) {
    if (typeof dayEntries !== 'function') return false;
    return dayEntries(ymd).some((item) => sameWorkBand(entry, item));
  }

  function isBandStart(ymd, entry, col) {
    return col === 0 || !hasAdjacentBand(adjacentYmd(ymd, -1), entry);
  }

  function bandSpan(ymd, entry, col) {
    let span = 1;
    while (col + span <= 6 && hasAdjacentBand(adjacentYmd(ymd, span), entry)) span += 1;
    return span;
  }

  function shiftSlot(entry, usedSlots) {
    const preferred = String(entry.shift || 'day') === 'night' ? 2 : 1;
    if (!usedSlots.has(preferred)) return preferred;
    for (const slot of [3, 4]) {
      if (!usedSlots.has(slot)) return slot;
    }
    return 0;
  }

  function reserveSlot(slotReservations, ymd, slot) {
    if (!slot) return;
    if (!slotReservations.has(ymd)) slotReservations.set(ymd, new Set());
    slotReservations.get(ymd).add(slot);
  }

  function reserveBandSpan(slotReservations, ymd, span, slot) {
    for (let offset = 1; offset < span; offset += 1) {
      reserveSlot(slotReservations, adjacentYmd(ymd, offset), slot);
    }
  }

  function sortEntriesForCalendar(items) {
    return [...items].sort((a, b) => {
      const aNight = String(a.shift || 'day') === 'night' ? 1 : 0;
      const bNight = String(b.shift || 'day') === 'night' ? 1 : 0;
      return aNight - bNight
        || String(a.company || '').localeCompare(String(b.company || ''), 'ja')
        || String(a.site || '').localeCompare(String(b.site || ''), 'ja')
        || String(a.type || 'self').localeCompare(String(b.type || 'self'), 'ja')
        || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #sc-cal #cal-grid,
      #sc-cal .cal-day,
      #sc-cal .task-stack { overflow: visible !important; }
      #sc-cal .task-stack {
        display: grid !important;
        grid-template-rows: repeat(4, minmax(0, 16px));
        gap: 2px;
        align-content: start;
        height: 70px;
        position: relative;
      }
      #sc-cal .cal-task,
      #sc-cal .cal-task.cont-left,
      #sc-cal .cal-task.cont-right,
      #sc-cal .cal-task.cont-left.cont-right {
        border-radius: 4px !important;
      }
      #sc-cal .cal-task {
        grid-row: var(--slot, 1);
        position: relative;
        z-index: 3;
        width: calc((100% + 13px) * var(--span, 1) - 13px);
        display: flex !important;
        align-items: center;
        height: 16px;
        min-height: 16px;
        max-height: 16px;
        white-space: nowrap !important;
        overflow: hidden !important;
        text-overflow: clip !important;
        word-break: keep-all !important;
        -webkit-line-clamp: unset !important;
        pointer-events: none;
      }
      #sc-cal .cal-task.night { grid-row: 2; }
      #sc-cal .cal-day.holiday .dn,
      #sc-cal .cal-day.holiday.sun .dn { color: var(--red); }
      #sc-cal .cal-day.today.holiday .dn { color: #fff; }
      #sc-cal .holiday-name {
        display: block;
        min-height: 13px;
        margin-top: -2px;
        margin-bottom: 1px;
        color: var(--red);
        font-size: 9px;
        line-height: 1;
        font-weight: 900;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: clip;
      }
      @media (max-width: 480px) {
        #sc-cal .task-stack {
          grid-template-rows: repeat(4, minmax(0, 14px));
          gap: 2px;
          height: 62px;
        }
        #sc-cal .cal-task {
          width: calc((100% + 7px) * var(--span, 1) - 7px);
          height: 14px;
          min-height: 14px;
          max-height: 14px;
          line-height: 1.08;
        }
        #sc-cal .cal-task,
        #sc-cal .cal-task.cont-left,
        #sc-cal .cal-task.cont-right,
        #sc-cal .cal-task.cont-left.cont-right {
          border-radius: 3px !important;
        }
        #sc-cal .holiday-name { font-size: 8px; min-height: 10px; }
      }
    `;
    document.head.appendChild(style);
  }

  window.hasAdjacentCompany = function hasAdjacentCompanyBySite(ymd, entry) {
    return hasAdjacentBand(ymd, entry);
  };

  window.calendarTaskClass = function calendarTaskClassBySite(entry) {
    return ['cal-task', shiftClass(entry.shift), entry.type === 'sub' ? 'sub' : ''].filter(Boolean).join(' ');
  };

  window.renderCalendar = function renderCalendarWithMondayStart() {
    const grid = document.getElementById('cal-grid');
    const monthStart = startOfMonth(cursor);
    const startCol = columnIndex(monthStart);
    const firstCell = new Date(monthStart);
    firstCell.setDate(firstCell.getDate() - startCol);
    const rows = ['月', '火', '水', '木', '金', '土', '日'].map((label) => `<div class="cal-dow">${label}</div>`);
    const slotReservations = new Map();

    for (let i = 0; i < 42; i += 1) {
      const date = new Date(firstCell);
      date.setDate(firstCell.getDate() + i);
      const ymd = toYmd(date);
      const col = columnIndex(date);
      const holiday = holidayName(ymd);
      const items = dayEntries(ymd);
      const classes = ['cal-day'];
      if (date.getMonth() !== cursor.getMonth()) classes.push('other');
      if (ymd === selectedDate) classes.push('sel');
      if (ymd === toYmd(new Date())) classes.push('today');
      if (date.getDay() === 0) classes.push('sun');
      if (date.getDay() === 6) classes.push('sat');
      if (holiday) classes.push('holiday');

      const usedSlots = new Set(slotReservations.get(ymd) || []);
      const visibleItems = sortEntriesForCalendar(items).filter((entry) => isBandStart(ymd, entry, col));
      const lines = [];
      visibleItems.forEach((entry) => {
        const slot = shiftSlot(entry, usedSlots);
        if (!slot) return;
        usedSlots.add(slot);
        const span = bandSpan(ymd, entry, col);
        reserveBandSpan(slotReservations, ymd, span, slot);
        const label = escapeHtml(companyEventTitle(entry));
        lines.push(`<div class="${window.calendarTaskClass(entry)}" style="--slot:${slot};--span:${span}">${label}</div>`);
      });
      const hiddenCount = Math.max(0, visibleItems.length - lines.length, items.length - 4);
      const more = hiddenCount ? `<div class="more-chip" aria-label="ほかに${hiddenCount}件">… +${hiddenCount}</div>` : '';
      const holidayHtml = holiday ? `<span class="holiday-name">${escapeHtml(holiday)}</span>` : '<span class="holiday-name"></span>';
      rows.push(`<button class="${classes.join(' ')}" data-date="${ymd}"><span class="dn">${date.getDate()}</span>${holidayHtml}<div class="task-stack">${lines.join('')}</div>${more}</button>`);
    }

    grid.innerHTML = rows.join('');
    renderSummary();
  };

  document.addEventListener('DOMContentLoaded', () => {
    injectStyle();
    if (typeof window.renderCalendar === 'function') window.renderCalendar();
  });
})();
