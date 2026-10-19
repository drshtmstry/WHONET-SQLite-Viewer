/**
 * Specimen Dictionary & Badge Rendering Utilities
 */

/**
 * Looks up full sample name for a WHONET specimen code.
 * @param {string|null|undefined} code 
 * @returns {string}
 */
export function getSpecimenName(code) {
  if (code == null || code === '') return '';
  const str = String(code).trim();
  const lower = str.toLowerCase();
  if (typeof window !== 'undefined' && window.SPECIMENS_DICT) {
    if (window.SPECIMENS_DICT[lower]) return window.SPECIMENS_DICT[lower];
    if (window.SPECIMENS_DICT[str]) return window.SPECIMENS_DICT[str];
  }
  return '';
}

/**
 * Renders an HTML specimen badge with tooltip.
 * @param {string|null|undefined} code 
 * @param {string} [extraStyle=''] 
 * @returns {string}
 */
export function renderSpecimenBadge(code, extraStyle = '') {
  if (code == null || code === '' || code === '—') return '—';
  const cleanCode = String(code).trim();
  const name = getSpecimenName(cleanCode);
  const rawTitle = name ? `${name} (${cleanCode})` : cleanCode;
  const safeTitle = rawTitle.replace(/"/g, '&quot;');
  const safeCode = cleanCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  
  if (!name) {
    return `<span class="badge" title="${safeTitle}" style="${extraStyle}">${safeCode}</span>`;
  }
  return `<span class="badge" title="${safeTitle}" style="font-weight: 600; ${extraStyle}">${safeCode} <span style="opacity: 0.65; font-size: 11px; font-weight: normal;">· ${name}</span></span>`;
}
