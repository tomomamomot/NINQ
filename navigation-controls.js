(function () {
  const STYLE_ID = 'ninq-navigation-controls-style';
  const DRAWER_ID = 'ninq-menu-drawer';
  const SCRIM_ID = 'ninq-menu-scrim';

  const MENU_ITEMS = [
    { screen: 'cal', label: 'カレンダー' },
    { screen: 'inv', label: '請求書、出面表' },
    { screen: 'sync', label: '同期・連携' },
    { screen: 'sub', label: '外注' },
    { screen: 'st', label: '設定' },
  ];

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .top-menu { display: none !important; }
      .ninq-drawer-scrim {
        position: fixed;
        inset: 0;
        z-index: 460;
        background: rgba(10, 16, 24, .18);
        opacity: 0;
        pointer-events: none;
        transition: opacity .18s ease;
      }
      .ninq-drawer-scrim.open {
        opacity: 1;
        pointer-events: auto;
      }
      .ninq-drawer {
        position: absolute;
        top: 0;
        right: 0;
        width: min(56vw, 280px);
        max-width: 280px;
        height: 100%;
        background: #fff;
        color: var(--ink);
        box-shadow: -18px 0 36px rgba(15, 23, 42, .14);
        transform: translateX(100%);
        transition: transform .24s ease;
        padding: calc(12px + var(--safe-top)) 14px calc(18px + var(--safe-bot));
        display: flex;
        flex-direction: column;
        gap: 14px;
      }
      .ninq-drawer-scrim.open .ninq-drawer { transform: translateX(0); }
      body.ninq-drawer-open { overflow: hidden; }
      .ninq-drawer-head {
        display: grid;
        grid-template-columns: 44px minmax(0, 1fr) 44px;
        align-items: center;
        gap: 8px;
        min-height: 44px;
      }
      .ninq-drawer-title {
        text-align: center;
        font-size: 19px;
        font-weight: 900;
        letter-spacing: 0;
      }
      .ninq-drawer-icon-btn,
      .ninq-day-nav-btn {
        border: 1px solid var(--line);
        background: #f7fafc;
        color: var(--ink);
        border-radius: 12px;
        width: 42px;
        height: 42px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 24px;
        font-weight: 900;
        line-height: 1;
      }
      .ninq-drawer-list {
        display: grid;
        gap: 10px;
        padding-top: 12px;
      }
      .ninq-drawer-item {
        width: 100%;
        border: 1px solid var(--line);
        background: #f8fafc;
        color: var(--ink);
        border-radius: 14px;
        padding: 15px 13px;
        text-align: left;
        font-size: 15px;
        font-weight: 900;
      }
      .ninq-drawer-item.active {
        background: var(--accent-soft);
        border-color: #bdd4ff;
        color: var(--accent);
      }
      .ninq-drawer-sales {
        margin-top: 4px;
        border-style: dashed;
        color: var(--sub);
      }
      .ninq-top-return {
        min-width: 66px;
        height: 38px;
        padding: 0 10px !important;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 3px;
        font-size: 13px !important;
        font-weight: 900;
        line-height: 1;
        white-space: nowrap;
      }
      .day-modal-head {
        display: grid !important;
        grid-template-columns: 42px minmax(0, 1fr) 92px;
        align-items: center;
        min-height: 58px;
      }
      .day-modal-title {
        text-align: center;
        min-width: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .day-modal-head-actions {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        justify-self: end;
        min-width: 92px;
      }
      .day-modal-close {
        width: 42px !important;
        height: 42px !important;
      }
      .day-modal-bg {
        align-items: flex-start !important;
        padding-top: calc(24dvh + var(--safe-top)) !important;
      }
      .day-modal {
        max-height: calc(76dvh - var(--safe-top) - var(--safe-bot)) !important;
      }
      .screen.ninq-screen-enter {
        animation: ninq-page-in .22s ease both;
      }
      @keyframes ninq-page-in {
        from { transform: translateX(100%); opacity: .96; }
        to { transform: translateX(0); opacity: 1; }
      }
      @media (max-width: 480px) {
        .ninq-drawer { width: 58vw; max-width: 260px; padding-left: 12px; padding-right: 12px; }
        .ninq-drawer-item { min-height: 48px; padding: 13px 11px; font-size: 14px; }
        .ninq-top-return { min-width: 62px; height: 36px; font-size: 12px !important; }
        .day-modal-head { grid-template-columns: 38px minmax(0, 1fr) 83px; gap: 7px; min-height: 54px; }
        .day-modal-head-actions { min-width: 83px; gap: 7px; }
        .ninq-day-nav-btn,
        .day-modal-close { width: 38px !important; height: 38px !important; border-radius: 11px; }
        .day-modal-bg { padding-top: calc(23dvh + var(--safe-top)) !important; }
        .day-modal { max-height: calc(77dvh - var(--safe-top) - var(--safe-bot)) !important; }
      }
    `;
    document.head.appendChild(style);
  }

  function drawerElement() {
    let scrim = document.getElementById(SCRIM_ID);
    if (scrim) return scrim;
    scrim = document.createElement('div');
    scrim.id = SCRIM_ID;
    scrim.className = 'ninq-drawer-scrim';
    scrim.innerHTML = `<aside class="ninq-drawer" id="${DRAWER_ID}" aria-label="メニュー"></aside>`;
    document.body.appendChild(scrim);
    return scrim;
  }

  function isSubVisible() {
    try { return typeof subcontractEnabled !== 'function' || subcontractEnabled(); }
    catch (error) { return true; }
  }

  function currentScreen() {
    try { return activeScreen || 'cal'; }
    catch (error) { return 'cal'; }
  }

  function salesLabel() {
    try { return state?.settings?.showSales ? '売上を隠す' : '売上を表示'; }
    catch (error) { return '売上表示'; }
  }

  function renderDrawer() {
    const drawer = drawerElement().querySelector(`#${DRAWER_ID}`);
    const active = currentScreen();
    const items = MENU_ITEMS.filter((item) => item.screen !== 'sub' || isSubVisible());
    drawer.innerHTML = `
      <div class="ninq-drawer-head">
        <span aria-hidden="true"></span>
        <div class="ninq-drawer-title">NINQ</div>
        <button class="ninq-drawer-icon-btn" type="button" data-ninq-menu-close aria-label="閉じる">×</button>
      </div>
      <div class="ninq-drawer-list">
        ${items.map((item) => `<button class="ninq-drawer-item ${item.screen === active ? 'active' : ''}" type="button" data-ninq-screen="${item.screen}">${item.label}</button>`).join('')}
        <button class="ninq-drawer-item ninq-drawer-sales" type="button" data-ninq-sales-toggle>${salesLabel()}</button>
      </div>`;
  }

  function openDrawer() {
    renderDrawer();
    drawerElement().classList.add('open');
    document.body.classList.add('ninq-drawer-open');
  }

  function closeDrawer() {
    document.getElementById(SCRIM_ID)?.classList.remove('open');
    document.body.classList.remove('ninq-drawer-open');
  }

  function goToScreen(screen) {
    const previous = currentScreen();
    try { activeScreen = screen; } catch (error) { return; }
    if (screen !== 'cal' && typeof closeDayModal === 'function') closeDayModal();
    if (typeof renderAll === 'function') renderAll();
    if (screen !== previous) {
      const target = document.getElementById(`sc-${screen}`);
      if (target) {
        target.classList.remove('ninq-screen-enter');
        void target.offsetWidth;
        target.classList.add('ninq-screen-enter');
        window.setTimeout(() => target.classList.remove('ninq-screen-enter'), 260);
      }
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
    closeDrawer();
    window.setTimeout(refreshControls, 0);
  }

  function goTop() {
    if (typeof closeDayModal === 'function') closeDayModal();
    goToScreen('cal');
  }

  function ensureTopReturnButtons() {
    document.querySelectorAll('.screen:not(#sc-cal) .topbar-actions').forEach((actions) => {
      if (actions.querySelector('[data-ninq-go-top]')) return;
      const button = document.createElement('button');
      button.className = 'ghost-icon-btn ninq-top-return';
      button.type = 'button';
      button.dataset.ninqGoTop = '';
      button.setAttribute('aria-label', 'TOPへ戻る');
      button.textContent = '← TOP';
      actions.insertBefore(button, actions.firstChild);
    });
  }

  function ensureDayModalNav() {
    const head = document.querySelector('.day-modal-head');
    const title = document.getElementById('day-modal-title');
    const close = head?.querySelector('[data-close-day-modal]');
    if (!head || !title || !close || head.querySelector('[data-day-nav="-1"]')) return;

    const prev = document.createElement('button');
    prev.className = 'ninq-day-nav-btn';
    prev.type = 'button';
    prev.dataset.dayNav = '-1';
    prev.setAttribute('aria-label', '前の日');
    prev.textContent = '‹';

    const next = document.createElement('button');
    next.className = 'ninq-day-nav-btn';
    next.type = 'button';
    next.dataset.dayNav = '1';
    next.setAttribute('aria-label', '次の日');
    next.textContent = '›';

    const actions = document.createElement('div');
    actions.className = 'day-modal-head-actions';
    actions.append(next, close);
    head.insertBefore(prev, title);
    head.appendChild(actions);
  }

  function moveSelectedDay(offset) {
    let nextDate = '';
    try { nextDate = adjacentYmd(selectedDate, offset); }
    catch (error) { return; }
    if (typeof openDayModal === 'function') openDayModal(nextDate);
  }

  function refreshControls() {
    ensureTopReturnButtons();
    ensureDayModalNav();
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectStyle();
    refreshControls();
  });

  document.addEventListener('click', (event) => {
    const menuButton = event.target.closest('#menu-toggle-btn,[data-menu-open]');
    if (menuButton) {
      event.preventDefault();
      event.stopPropagation();
      openDrawer();
      return;
    }

    const dayNav = event.target.closest('[data-day-nav]');
    if (dayNav) {
      event.preventDefault();
      event.stopPropagation();
      moveSelectedDay(Number(dayNav.dataset.dayNav));
      return;
    }

    const topButton = event.target.closest('[data-ninq-go-top]');
    if (topButton) {
      event.preventDefault();
      event.stopPropagation();
      goTop();
      return;
    }

    const closeButton = event.target.closest('[data-ninq-menu-close]');
    if (closeButton || event.target.id === SCRIM_ID) {
      event.preventDefault();
      event.stopPropagation();
      closeDrawer();
      return;
    }

    const screenButton = event.target.closest('[data-ninq-screen]');
    if (screenButton) {
      event.preventDefault();
      event.stopPropagation();
      goToScreen(screenButton.dataset.ninqScreen);
      return;
    }

    const salesButton = event.target.closest('[data-ninq-sales-toggle]');
    if (salesButton) {
      event.preventDefault();
      event.stopPropagation();
      try {
        state.settings.showSales = !state.settings.showSales;
        saveState();
        renderAll();
        renderDrawer();
      } catch (error) {}
    }
  }, true);
})();
