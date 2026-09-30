/**
 * Organism Dictionary & Badge Rendering Utilities
 */

/**
 * Looks up full scientific name for a WHONET organism code.
 * @param {string|number|null|undefined} code 
 * @returns {string}
 */
export function getOrganismName(code) {
  if (code == null || code === '') return '';
  const str = String(code).trim();
  const lower = str.toLowerCase();
  if (typeof window !== 'undefined' && window.ORGANISMS_DICT) {
    if (window.ORGANISMS_DICT[lower]) return window.ORGANISMS_DICT[lower];
    if (window.ORGANISMS_DICT[str]) return window.ORGANISMS_DICT[str];
  }
  return '';
}

/**
 * Renders an HTML organism badge with tooltip.
 * @param {string|number|null|undefined} code 
 * @param {string} [extraStyle=''] 
 * @returns {string}
 */
export function renderOrgBadge(code, extraStyle = '') {
  if (code == null || code === '' || code === '—') return '—';
  const cleanCode = String(code).trim();
  const name = getOrganismName(cleanCode);
  const rawTitle = name ? `${name} (${cleanCode})` : cleanCode;
  const safeTitle = rawTitle.replace(/"/g, '&quot;');
  const safeCode = cleanCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<span class="badge badge-org" title="${safeTitle}" style="${extraStyle}">${safeCode}</span>`;
}
