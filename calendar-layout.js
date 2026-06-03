(function () {
  const STYLE_ID = 'ninq-calendar-fixed-layout';
  const DETAILS_BUTTON_CLASS = 'summary-detail-toggle';

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #sc-cal.screen.active {
        display: flex;
        flex-direction: column;
        height: 100dvh;
        min-height: 100dvh;
        overflow: hidden;
        padding-bottom: 0;
        overscroll-behavior: contain;
      }
      #sc-cal .topbar {
        position: relative;
        top: auto;
        flex: 0 0 auto;
        padding: calc(7px + var(--safe-top)) 12px 7px;
      }
      #sc-cal .topbar-row {
        min-height: 34px;
      }
      #sc-cal .topbar-title {
        font-size: calc(var(--modal-title-size) - 2px);
        line-height: 1;
      }
      #sc-cal .topbar-sub {
        display: none;
      }
      #sc-cal .topbar-actions {
        gap: 6px;
      }
      #sc-cal .ghost-icon-btn {
        width: 38px;
        height: 34px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(255,255,255,.28);
        border-radius: 11px;
        background: rgba(255,255,255,.12);
        color: #fff;
        padding: 0;
        font-size: var(--control-size);
        font-weight: 900;
        line-height: 1;
      }
      #sc-cal .month-nav {
        position: relative;
        top: auto;
        flex: 0 0 auto;
        box-shadow: 0 1px 0 var(--line);
      }
      #sc-cal #cal-grid {
        flex: 1 1 auto;
        min-height: 0;
        overflow: hidden;
        align-content: stretch;
      }
      #sc-cal .cal-day,
      #sc-cal .task-stack {
        min-height: 0;
      }
      #sc-cal .sum-grid {
        flex: 0 0 auto;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 58px;
        gap: 6px;
        padding: 7px 9px calc(8px + var(--safe-bot));
        background: rgba(238, 243, 248, .98);
        border-top: 1px solid var(--line);
        box-shadow: 0 -8px 20px rgba(15, 23, 42, .06);
      }
      #sc-cal .sum-card {
        min-height: 46px;
        border-radius: 10px;
        padding: 7px 9px;
      }
      #sc-cal:not(.summary-expanded) .sum-card:nth-child(n+3) {
        display: none;
      }
      #sc-cal.summary-expanded .sum-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      #sc-cal.summary-expanded .summary-detail-toggle {
        grid-column: 1 / -1;
        width: 100%;
        min-height: 36px;
      }
      #sc-cal .sl {
        font-size: max(10px, calc(var(--summary-label-size) - 2px));
        line-height: 1.15;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #sc-cal .sv {
        font-size: max(17px, calc(var(--summary-value-size) - 5px));
        line-height: 1.1;
        margin-top: 3px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      #sc-cal .summary-detail-toggle {
        border: 1px solid var(--line);
        border-radius: 10px;
        background: #fff;
        color: var(--accent);
        font-size: max(12px, calc(var(--summary-label-size) - 1px));
        font-weight: 900;
        min-height: 46px;
        padding: 0 6px;
      }
      #sc-cal .fab {
        bottom: calc(78px + var(--safe-bot));
      }
      #sc-cal.summary-expanded .fab {
        bottom: calc(126px + var(--safe-bot));
      }
      @media (max-width: 480px) {
        #sc-cal .topbar {
          padding: calc(6px + var(--safe-top)) 12px 6px;
        }
        #sc-cal .topbar-row {
          min-height: 32px;
        }
        #sc-cal .topbar-title {
          font-size: calc(var(--modal-title-size) - 3px);
        }
        #sc-cal .ghost-icon-btn {
          width: 36px;
          height: 32px;
          font-size: max(16px, calc(var(--control-size) - 1px));
        }
        #sc-cal .month-nav {
          padding: 8px 14px;
        }
        #sc-cal .month-nav button {
          height: 36px;
        }
        #sc-cal .month-label {
          font-size: var(--month-label-size);
        }
        #sc-cal .cal-grid {
          padding-bottom: 4px;
        }
        #sc-cal .cal-dow {
          min-height: 24px;
          height: 24px;
          font-size: var(--cal-dow-size);
        }
        #sc-cal .cal-day {
          padding: 2px 3px 3px;
        }
        #sc-cal .dn {
          height: 19px;
          font-size: var(--cal-date-size);
        }
        #sc-cal .cal-day.today .dn {
          width: 23px;
          height: 23px;
        }
        #sc-cal .cal-task {
          display: flex;
          align-items: center;
          min-height: var(--cal-slot-height);
          font-size: var(--cal-task-size);
          font-weight: 750;
          line-height: 1;
          padding: 2px 4px;
        }
        #sc-cal .sum-grid {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 52px;
        }
        #sc-cal .sum-card {
          min-height: 42px;
          padding: 6px 8px;
        }
        #sc-cal .sl {
          font-size: max(9.5px, calc(var(--summary-label-size) - 3px));
        }
        #sc-cal .sv {
          font-size: max(15.5px, calc(var(--summary-value-size) - 7px));
        }
        #sc-cal .summary-detail-toggle {
          min-height: 42px;
          font-size: max(11px, calc(var(--summary-label-size) - 2px));
        }
        #sc-cal .fab {
          width: 54px;
          height: 54px;
          bottom: calc(74px + var(--safe-bot));
        }
        #sc-cal.summary-expanded .fab {
          bottom: calc(116px + var(--safe-bot));
        }
      }
    `;
    document.head.appendChild(style);
  }

  function ensureSummaryToggle() {
    const calendar = document.getElementById('sc-cal');
    const grid = document.getElementById('sum-grid');
    if (!calendar || !grid || grid.querySelector(`.${DETAILS_BUTTON_CLASS}`)) return;
    const button = document.createElement('button');
    button.className = DETAILS_BUTTON_CLASS;
    button.type = 'button';
    button.textContent = calendar.classList.contains('summary-expanded') ? '閉じる' : '詳細';
    grid.appendChild(button);
  }

  function updateSummaryToggleLabel() {
    const calendar = document.getElementById('sc-cal');
    const button = document.querySelector(`#sum-grid .${DETAILS_BUTTON_CLASS}`);
    if (calendar && button) button.textContent = calendar.classList.contains('summary-expanded') ? '閉じる' : '詳細';
  }

  function watchSummary() {
    const grid = document.getElementById('sum-grid');
    if (!grid) return;
    const observer = new MutationObserver(() => {
      ensureSummaryToggle();
      updateSummaryToggleLabel();
    });
    observer.observe(grid, { childList: true });
    ensureSummaryToggle();
  }

  function preventCalendarSwipe(event) {
    const calendar = document.getElementById('sc-cal');
    if (!calendar?.classList.contains('active')) return;
    if (event.target.closest('.modal-bg.open, .day-modal-bg.open')) return;
    event.preventDefault();
  }

  document.addEventListener('DOMContentLoaded', () => {
    injectStyle();
    watchSummary();
    document.addEventListener('touchmove', preventCalendarSwipe, { passive: false });
    document.addEventListener('click', (event) => {
      if (!event.target.closest(`.${DETAILS_BUTTON_CLASS}`)) return;
      document.getElementById('sc-cal')?.classList.toggle('summary-expanded');
      updateSummaryToggleLabel();
    });
  });
})();
