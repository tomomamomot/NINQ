(function () {
  function polishSettingsFields() {
    const newOfficialName = document.getElementById('st-company-official-new');
    if (newOfficialName) newOfficialName.placeholder = '請求書記載名 例: 株式会社山田建設';

    document.querySelectorAll('[data-company-preset-field="officialName"]').forEach((input) => {
      input.placeholder = '請求書記載名';
    });

    ['st-bank', 'st-branch', 'st-accno', 'st-accname'].forEach((id) => {
      document.getElementById(id)?.removeAttribute('placeholder');
    });
  }

  function trimInvoiceBankBlock(html) {
    return String(html || '').replace(/\n?\s*<div class="invoice-bank">([\s\S]*?)<\/div>/, (block) => {
      const rows = [...block.matchAll(/<span>([^<]*?)<\/span>/g)]
        .map((match) => match[1])
        .filter((text) => {
          const value = text.includes('　') ? text.slice(text.indexOf('　') + 1) : text;
          return value.trim();
        });

      if (!rows.length) return '';

      return `
        <div class="invoice-bank">
          <strong>振込先口座</strong>
          ${rows.map((text) => `<span>${text}</span>`).join('\n          ')}
        </div>`;
    });
  }

  function patchInvoiceSheet() {
    if (typeof window.buildInvoiceSheet !== 'function' || window.buildInvoiceSheet.__ninqPolished) return;
    const original = window.buildInvoiceSheet;
    const patched = function buildInvoiceSheetWithCleanBank(...args) {
      return trimInvoiceBankBlock(original.apply(this, args));
    };
    patched.__ninqPolished = true;
    window.buildInvoiceSheet = patched;
    try { buildInvoiceSheet = patched; } catch (error) {}
  }

  function ready() {
    polishSettingsFields();
    patchInvoiceSheet();

    const companyList = document.getElementById('st-company-list');
    if (companyList) {
      new MutationObserver(polishSettingsFields).observe(companyList, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready);
  } else {
    ready();
  }
})();
