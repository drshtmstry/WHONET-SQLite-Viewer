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
