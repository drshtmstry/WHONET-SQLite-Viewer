import { state } from '../state/store.js';
import { handleWasmApi } from './wasm-emulator.js';

const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
export const API_BASE = isLocalHost && (window.location.port === '7890' || window.location.port === '') ? '' : 'http://localhost:7890';

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
    if (!res.ok && res.status >= 500) {
      const err = await res.json().catch(() => ({ error: `Server error (${res.status})` }));
      return { error: err.error || `HTTP ${res.status}` };
    }
    return await res.json();
  } catch (err) {
    return { error: `Network/Server error: ${err.message}` };
  }
}
