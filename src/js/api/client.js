import { state, API_BASE } from '../state/store.js';
import { handleWasmApi } from './wasm-emulator.js';

export { API_BASE };

/**
 * Hybrid API Dispatcher:
 * Automatically dispatches to client-side WebAssembly SQLite emulator when in WASM mode,
 * or sends fetch() requests to the backend Node server when in server mode.
 */
export async function api(path, options = {}) {
  if (state.isWasmMode) {
    return handleWasmApi(path, options);
  }

  try {
    const res = await fetch(API_BASE + path, options);
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok) {
      if (contentType.includes('application/json')) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        return { error: err.error || `HTTP ${res.status}` };
      }
      const text = await res.text().catch(() => '');
      return { error: text.trim() || `HTTP ${res.status}` };
    }
    if (contentType.includes('application/json')) {
      return await res.json();
    }
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      return { error: text.trim() || 'Unexpected non-JSON server response' };
    }
  } catch (err) {
    return { error: `Network/Server error: ${err.message}` };
  }
}
