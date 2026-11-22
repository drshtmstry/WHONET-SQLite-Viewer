import test from "node:test";
import assert from "node:assert/strict";
import { copyTableHtmlAndTsv } from "../src/js/utils/formatters.js";

test("copyTableHtmlAndTsv puts text/html and text/plain blobs on clipboard", async () => {
  let clipboardItemsWritten = null;

  class MockBlob {
    constructor(chunks, options) {
      this.chunks = chunks;
      this.type = options?.type || "";
    }
  }

  class MockClipboardItem {
    constructor(dataMap) {
      this.dataMap = dataMap;
    }
  }

  const mockClipboard = {
    write: async (items) => {
      clipboardItemsWritten = items;
    },
    writeText: async () => {},
  };

  const origNavigator = globalThis.navigator;
  const origClipboardItem = globalThis.ClipboardItem;
  const origBlob = globalThis.Blob;
  const origWindow = globalThis.window;

  try {
    globalThis.Blob = MockBlob;
    globalThis.ClipboardItem = MockClipboardItem;
    globalThis.window = { ClipboardItem: MockClipboardItem };

    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: mockClipboard },
      configurable: true,
      writable: true,
    });

    const html = '<table border="1"><tr><td style="background-color: #dcfce7;">85%</td></tr></table>';
    const tsv = "Col1\tCol2\nVal1\t85%";

    const result = await copyTableHtmlAndTsv(html, tsv);

    assert.equal(result, true, "copyTableHtmlAndTsv should return true on success");
    assert.ok(clipboardItemsWritten, "Items should be written to clipboard");
    assert.equal(clipboardItemsWritten.length, 1);

    const item = clipboardItemsWritten[0];
    assert.ok(item.dataMap["text/html"], "HTML blob should be present");
    assert.ok(item.dataMap["text/plain"], "Plain text blob should be present");
    assert.equal(item.dataMap["text/html"].type, "text/html");
    assert.equal(item.dataMap["text/plain"].type, "text/plain");
    assert.ok(item.dataMap["text/html"].chunks[0].includes("85%"));
    assert.equal(item.dataMap["text/plain"].chunks[0], tsv);
  } finally {
    if (origNavigator !== undefined) {
      Object.defineProperty(globalThis, "navigator", {
        value: origNavigator,
        configurable: true,
        writable: true,
      });
    }
    globalThis.ClipboardItem = origClipboardItem;
    globalThis.Blob = origBlob;
    globalThis.window = origWindow;
  }
});
