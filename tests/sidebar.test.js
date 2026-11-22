import test from 'node:test';
import assert from 'node:assert/strict';

// Mock minimal DOM environment for node:test
class MockClassList {
  constructor() {
    this._set = new Set();
  }

  add(cls) {
    this._set.add(cls);
  }

  delete(cls) {
    this._set.delete(cls);
  }

  has(cls) {
    return this._set.has(cls);
  }

  contains(cls) {
    return this._set.has(cls);
  }

  toggle(cls, force) {
    if (typeof force === 'boolean') {
      if (force) this._set.add(cls);
      else this._set.delete(cls);
      return force;
    }
    if (this._set.has(cls)) {
      this._set.delete(cls);
      return false;
    }
    this._set.add(cls);
    return true;
  }
}

class MockElement {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.classList = new MockClassList();
    this.attributes = new Map();
    this.children = [];
    this.textContent = '';
  }

  getAttribute(name) {
    return this.attributes.get(name) || null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  querySelector(selector) {
    if (selector === '.nav-label') {
      return this.children.find((c) => c.classList.contains('nav-label')) || null;
    }
    return null;
  }
}

test('sidebar collapse toggles classes, updates ARIA attributes, and persists state', () => {
  const store = {};
  const mockLocalStorage = {
    getItem: (key) => store[key] || null,
    setItem: (key, val) => {
      store[key] = String(val);
    }
  };

  const appSidebar = new MockElement('app-sidebar', 'nav');
  const headerToggleBtn = new MockElement('sidebar-toggle-btn', 'button');

  // Minimal toggle function replicating main.js logic for unit verification
  function toggleSidebarCollapse(force) {
    const isCollapsed =
      typeof force === 'boolean'
        ? force
        : !appSidebar.classList.contains('collapsed');
    appSidebar.classList.toggle('collapsed', isCollapsed);
    mockLocalStorage.setItem('whonet-sidebar-collapsed', String(isCollapsed));

    const title = isCollapsed
      ? 'Expand sidebar (Ctrl+B)'
      : 'Collapse sidebar (Ctrl+B)';
    headerToggleBtn.setAttribute('aria-expanded', String(!isCollapsed));
    headerToggleBtn.setAttribute('title', title);
    headerToggleBtn.setAttribute('aria-label', title);
    return isCollapsed;
  }

  // Initial state: not collapsed
  assert.equal(appSidebar.classList.contains('collapsed'), false);

  // 1. Toggle to collapsed
  const firstToggle = toggleSidebarCollapse();
  assert.equal(firstToggle, true);
  assert.equal(appSidebar.classList.contains('collapsed'), true);
  assert.equal(mockLocalStorage.getItem('whonet-sidebar-collapsed'), 'true');
  assert.equal(headerToggleBtn.getAttribute('aria-expanded'), 'false');
  assert.equal(headerToggleBtn.getAttribute('title'), 'Expand sidebar (Ctrl+B)');

  // 2. Toggle back to expanded
  const secondToggle = toggleSidebarCollapse();
  assert.equal(secondToggle, false);
  assert.equal(appSidebar.classList.contains('collapsed'), false);
  assert.equal(mockLocalStorage.getItem('whonet-sidebar-collapsed'), 'false');
  assert.equal(headerToggleBtn.getAttribute('aria-expanded'), 'true');
  assert.equal(headerToggleBtn.getAttribute('title'), 'Collapse sidebar (Ctrl+B)');

  // 3. Forced state
  toggleSidebarCollapse(true);
  assert.equal(appSidebar.classList.contains('collapsed'), true);
  assert.equal(mockLocalStorage.getItem('whonet-sidebar-collapsed'), 'true');
});
