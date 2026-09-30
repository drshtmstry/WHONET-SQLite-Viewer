/**
 * Toast Notification System
 */

const ICONS = {
  success: '<i class="fa-solid fa-check"></i>',
  error: '<i class="fa-solid fa-circle-xmark"></i>',
  warn: '<i class="fa-solid fa-triangle-exclamation"></i>',
  info: '<i class="fa-solid fa-circle-info"></i>'
};

/**
 * Displays a toast notification.
 * @param {string} msg 
 * @param {'info'|'success'|'error'|'warn'} [type='info'] 
 */
export function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${ICONS[type] || ICONS.info}</span> ${msg}`;
  
  const container = document.getElementById('toast-container');
  if (container) {
    container.appendChild(el);
  } else {
    document.body.appendChild(el);
  }
  
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 250);
  }, 3800);
}
