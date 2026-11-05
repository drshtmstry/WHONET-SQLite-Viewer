/**
 * Safe client-side analytics wrapper
 * Resolves seamlessly in vanilla browser (Node server), Vite dev, and production.
 */
export function inject() {
  if (typeof window !== 'undefined') {
    if (!window.va) {
      window.va = function (...params) {
        if (!window.vaq) window.vaq = [];
        window.vaq.push(params);
      };
    }
  }
}

export function pageview(params) {
  if (typeof window !== 'undefined' && typeof window.va === 'function') {
    try {
      window.va('pageview', params);
    } catch (_) {}
  }
}

export function track(event, data) {
  if (typeof window !== 'undefined' && typeof window.va === 'function') {
    try {
      window.va('event', { name: event, data });
    } catch (_) {}
  }
}

