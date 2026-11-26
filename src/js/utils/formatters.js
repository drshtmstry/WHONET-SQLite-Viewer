/**
 * General Purpose Formatting & Sanitization Utilities
 */

/**
 * Escapes unsafe characters for safe injection into HTML strings.
 * @param {*} str 
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Formats a value as a quoted CSV cell and neutralizes spreadsheet formula injection
 * (=, +, -, @, tab, CR) so exported files are safe to open in Excel/Sheets.
 * @param {*} value
 * @returns {string}
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '""';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Formats a raw database date string into user locale date string.
 * @param {string|null|undefined} d 
 * @returns {string}
 */
export function fmtDate(d) {
  if (!d) return '—';
  const raw = String(d).trim();
  // Check for standard YYYY-MM-DD pattern
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1;
    const day = parseInt(match[3], 10);
    const dateObj = new Date(year, month, day);
    if (!isNaN(dateObj.getTime())) {
      return dateObj.toLocaleDateString();
    }
  }
  const dateObj = new Date(raw);
  if (!isNaN(dateObj.getTime())) {
    return dateObj.toLocaleDateString();
  }
  return raw.substring(0, 10);
}

/**
 * Formats age and sex into combined '19/f' style.
 * @param {*} age 
 * @param {*} sex 
 * @returns {string}
 */
export function formatAgeSex(age, sex) {
  const a = age != null && String(age).trim() !== '' ? String(age).trim() : '';
  const s = sex != null && String(sex).trim() !== '' ? String(sex).trim().toLowerCase() : '';
  if (a && s) return `${a}/${s}`;
  if (a) return a;
  if (s) return s;
  return '—';
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats a YYYY-MM year-month string into 'MMM YYYY'.
 * @param {string|null|undefined} ym 
 * @returns {string}
 */
export function formatAmrMonthLabel(ym) {
  if (!ym || typeof ym !== 'string') return '—';
  const match = ym.match(/^(\d{4})-(\d{2})$/);
  if (!match) return ym;
  const yr = parseInt(match[1], 10);
  const mo = parseInt(match[2], 10);
  if (mo < 1 || mo > 12) return ym;
  return `${MONTH_NAMES[mo - 1]} ${yr}`;
}

/**
 * Debounce helper function.
 * @param {Function} fn 
 * @param {number} ms 
 * @returns {Function}
 */
export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Checks if a filename is a SQLite database file.
 * @param {string} filename 
 * @returns {boolean}
 */
export function isSqliteDatabase(filename) {
  if (typeof filename !== 'string') return false;
  const lower = filename.toLowerCase();
  return lower.endsWith('.sqlite') || lower.endsWith('.sqlite3');
}

/**
 * Checks if a database is a sample/training database (e.g. WHO-TST files).
 * @param {string} name 
 * @returns {boolean}
 */
export function isSampleDb(name) {
  return (name || '').toLowerCase().startsWith('who-tst');
}

/**
 * Formats a WHONET location/ward type into a human-readable display string.
 * @param {string|null|undefined} wt 
 * @returns {string}
 */
export function formatWardTypeLabel(wt) {
  if (!wt) return 'Unknown';
  const clean = String(wt).trim().toLowerCase();
  const WARD_TYPE_NAMES = {
    in: 'Inpatient (in)',
    out: 'Outpatient (out)',
    icu: 'Intensive Care Unit (icu)',
    eme: 'Emergency (eme)',
    er: 'Emergency Room (er)',
    ed: 'Emergency Department (ed)',
    opd: 'Outpatient Clinic (opd)',
    nicu: 'Neonatal ICU (nicu)',
    picu: 'Pediatric ICU (picu)',
    sicu: 'Surgical ICU (sicu)',
    micu: 'Medical ICU (micu)',
    ccu: 'Coronary Care Unit (ccu)',
    surg: 'Surgical (surg)',
    med: 'Medical (med)',
    ped: 'Pediatric (ped)',
    obg: 'Obstetrics/Gynecology (obg)',
    obgyn: 'Obstetrics/Gynecology (obgyn)',
    dial: 'Dialysis (dial)',
    burn: 'Burn Unit (burn)',
    step: 'Step-down / HDU (step)'
  };
  return WARD_TYPE_NAMES[clean] || `${wt.toUpperCase()} (${wt})`;
}

/**
 * Copies a table to the clipboard as both rich HTML (with inline cell colors,
 * borders, font styles, and text-wrapping for Excel/Word/Sheets) and plain TSV.
 *
 * @param {string} htmlTableString - Fully styled <table> HTML markup
 * @param {string} plainTsvString - Plain tab-separated text representation
 * @returns {Promise<boolean>}
 */
export async function copyTableHtmlAndTsv(htmlTableString, plainTsvString) {
  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${htmlTableString}</body></html>`;

  // 1. Try modern navigator.clipboard.write with ClipboardItem
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof window !== 'undefined' &&
    window.ClipboardItem
  ) {
    try {
      const htmlBlob = new Blob([fullHtml], { type: 'text/html' });
      const textBlob = new Blob([plainTsvString], { type: 'text/plain' });
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': htmlBlob,
          'text/plain': textBlob
        })
      ]);
      return true;
    } catch (err) {
      console.warn('navigator.clipboard.write failed, trying execCommand fallback:', err);
    }
  }

  // 2. Fallback using document.execCommand('copy') with selected range
  if (typeof document !== 'undefined') {
    try {
      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-9999px';
      container.style.top = '0';
      container.style.opacity = '0';
      container.innerHTML = fullHtml;
      document.body.appendChild(container);

      const range = document.createRange();
      range.selectNode(container);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }

      const success = document.execCommand('copy');
      if (sel) sel.removeAllRanges();
      document.body.removeChild(container);

      if (success) return true;
    } catch (err) {
      console.warn('execCommand copy fallback failed:', err);
    }
  }

  // 3. Final fallback: plain text writeText
  if (
    typeof navigator !== 'undefined' &&
    navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function'
  ) {
    await navigator.clipboard.writeText(plainTsvString);
    return true;
  }

  return false;
}
