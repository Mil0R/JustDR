const test = require("node:test");
const assert = require("node:assert/strict");

// Mock Chrome API before loading background.js
function createMockChrome() {
  const storageData = {};
  const contextMenuItems = new Map();
  const actionState = {
    badgeText: {},
    badgeBackgroundColor: {},
    title: {},
    defaultTitle: "",
  };

  const listeners = {
    installed: [],
    startup: [],
    actionClicked: [],
    contextMenuClicked: [],
    tabsUpdated: [],
    tabsActivated: [],
  };

  const chromeMock = {
    storage: {
      local: {
        get: async (key) => {
          if (typeof key === "string") {
            return { [key]: storageData[key] };
          }
          if (Array.isArray(key)) {
            const res = {};
            for (const k of key) res[k] = storageData[k];
            return res;
          }
          return { ...storageData };
        },
        set: async (obj) => {
          Object.assign(storageData, obj);
        },
      },
    },
    action: {
      setBadgeText: ({ text, tabId }) => {
        if (tabId !== undefined) {
          actionState.badgeText[tabId] = text;
        } else {
          actionState.badgeText.global = text;
        }
      },
      getBadgeText: async ({ tabId }) => {
        return actionState.badgeText[tabId] ?? actionState.badgeText.global ?? "";
      },
      setBadgeBackgroundColor: ({ color, tabId }) => {
        if (tabId !== undefined) {
          actionState.badgeBackgroundColor[tabId] = color;
        } else {
          actionState.badgeBackgroundColor.global = color;
        }
      },
      setTitle: async ({ title, tabId }) => {
        if (tabId !== undefined) {
          actionState.title[tabId] = title;
        } else {
          actionState.defaultTitle = title;
        }
      },
      getTitle: async ({ tabId }) => {
        return actionState.title[tabId] ?? actionState.defaultTitle ?? "";
      },
      onClicked: {
        addListener: (fn) => listeners.actionClicked.push(fn),
      },
    },
    contextMenus: {
      create: (options, callback) => {
        if (contextMenuItems.has(options.id)) {
          chromeMock.runtime.lastError = new Error(`duplicate id: ${options.id}`);
          if (callback) callback();
          delete chromeMock.runtime.lastError;
          return;
        }
        contextMenuItems.set(options.id, { ...options });
        if (callback) callback();
      },
      update: (id, options, callback) => {
        if (!contextMenuItems.has(id)) {
          chromeMock.runtime.lastError = new Error(`Cannot find menu item with id ${id}`);
          if (callback) callback();
          delete chromeMock.runtime.lastError;
          return;
        }
        const existing = contextMenuItems.get(id);
        contextMenuItems.set(id, { ...existing, ...options });
        if (callback) callback();
      },
      onClicked: {
        addListener: (fn) => listeners.contextMenuClicked.push(fn),
      },
    },
    runtime: {
      lastError: null,
      onInstalled: {
        addListener: (fn) => listeners.installed.push(fn),
      },
      onStartup: {
        addListener: (fn) => listeners.startup.push(fn),
      },
    },
    tabs: {
      get: async (id) => ({ id, url: `https://example.com/page-${id}` }),
      query: async (queryInfo) => [{ id: 1, url: "https://github.com" }],
      onUpdated: {
        addListener: (fn) => listeners.tabsUpdated.push(fn),
      },
      onActivated: {
        addListener: (fn) => listeners.tabsActivated.push(fn),
      },
    },
  };

  return {
    chrome: chromeMock,
    storageData,
    contextMenuItems,
    actionState,
    listeners,
  };
}

test("DR4 Integration and Switching", async (t) => {
  const mock = createMockChrome();
  global.chrome = mock.chrome;

  // Load background module
  const bg = require("../background.js");

  await t.test("Utility functions (hostname, scoring, badge text)", () => {
    assert.equal(bg.getHostname("https://github.com/path"), "github.com");
    assert.equal(bg.getHostname("http://sub.domain.org:8080"), "sub.domain.org");
    assert.throws(() => bg.getHostname("chrome://extensions"), /Unsupported protocol:/);
    assert.equal(bg.isUnsupportedUrlError(new Error("Unsupported protocol: ftp:")), true);

    assert.equal(bg.normalizeRating(92.4), 92.4);
    assert.equal(bg.normalizeRating(0), 0);
    assert.equal(bg.normalizeRating("invalid"), null);
    assert.equal(bg.normalizeRating(NaN), null);

    assert.equal(bg.formatBadgeText(85), "85");
    assert.equal(bg.formatBadgeText(85.34), "85.3");
    assert.equal(bg.formatBadgeText(null), "N/A");

    assert.equal(bg.scoreColor(90), "#1f9d55");
    assert.equal(bg.scoreColor(70), "#65a30d");
    assert.equal(bg.scoreColor(50), "#ca8a04");
    assert.equal(bg.scoreColor(30), "#ea580c");
    assert.equal(bg.scoreColor(10), "#dc2626");
  });

  await t.test("Cache key includes version to isolate DR3 and DR4", () => {
    const keyDr3 = bg.getCacheKey("github.com", "dr3");
    const keyDr4 = bg.getCacheKey("github.com", "dr4");
    assert.equal(keyDr3, "github.com:dr3");
    assert.equal(keyDr4, "github.com:dr4");
    assert.notEqual(keyDr3, keyDr4);
  });

  await t.test("Default version is dr3 and can be toggled to dr4", async () => {
    // Initially not set -> defaults to dr3
    const initial = await bg.getDrVersion();
    assert.equal(initial, "dr3");

    // Toggle to dr4
    await bg.setDrVersion("dr4");
    assert.equal(await bg.getDrVersion(), "dr4");
    assert.equal(mock.storageData[bg.VERSION_KEY], "dr4");
    assert.equal(mock.actionState.defaultTitle, "Domain Rating (DR4)");

    // Toggle back to dr3
    await bg.setDrVersion("dr3");
    assert.equal(await bg.getDrVersion(), "dr3");
    assert.equal(mock.storageData[bg.VERSION_KEY], "dr3");
    assert.equal(mock.actionState.defaultTitle, "Domain Rating (DR3)");
  });

  await t.test("Context menu registers Auto DR, separator, DR3, and DR4 radio items", async () => {
    await bg.ensureContextMenu();

    assert.ok(mock.contextMenuItems.has("toggle-auto-fetch"));
    assert.ok(mock.contextMenuItems.has(bg.SEPARATOR_VERSION_ID));
    assert.ok(mock.contextMenuItems.has(bg.VERSION_DR3_MENU_ID));
    assert.ok(mock.contextMenuItems.has(bg.VERSION_DR4_MENU_ID));

    const dr3Item = mock.contextMenuItems.get(bg.VERSION_DR3_MENU_ID);
    const dr4Item = mock.contextMenuItems.get(bg.VERSION_DR4_MENU_ID);

    assert.equal(dr3Item.type, "radio");
    assert.equal(dr3Item.title, "DR3");
    assert.equal(dr3Item.checked, true);

    assert.equal(dr4Item.type, "radio");
    assert.equal(dr4Item.title, "DR4");
    assert.equal(dr4Item.checked, false);
  });

  await t.test("Switching version via context menu updates menu state and re-fetches rating", async () => {
    let requestedUrl = null;
    const originalFetch = global.fetch;
    global.fetch = async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          domain_rating: {
            domain_rating: url.includes("version=dr4") ? 95 : 92,
            license: "https://ahrefs.com/legal/domain-rating-license",
          },
        }),
      };
    };

    try {
      // Simulate clicking the "DR4" context menu item
      const [contextMenuListener] = mock.listeners.contextMenuClicked;
      assert.ok(contextMenuListener);

      await contextMenuListener(
        { menuItemId: bg.VERSION_DR4_MENU_ID },
        { id: 1, url: "https://github.com" }
      );

      // Check that version changed to dr4
      assert.equal(await bg.getDrVersion(), "dr4");
      assert.equal(mock.contextMenuItems.get(bg.VERSION_DR4_MENU_ID).checked, true);
      assert.equal(mock.contextMenuItems.get(bg.VERSION_DR3_MENU_ID).checked, false);

      // Check that fetch was called with &version=dr4
      assert.ok(requestedUrl.includes("version=dr4"));
      assert.ok(requestedUrl.includes("target=github.com"));

      // Check badge updated to DR4 rating "95"
      assert.equal(mock.actionState.badgeText[1], "95");
      assert.equal(mock.actionState.title[1], "Domain Rating (DR4): 95");

      // Now switch back to DR3 via context menu
      await contextMenuListener(
        { menuItemId: bg.VERSION_DR3_MENU_ID },
        { id: 1, url: "https://github.com" }
      );

      assert.equal(await bg.getDrVersion(), "dr3");
      assert.equal(mock.contextMenuItems.get(bg.VERSION_DR3_MENU_ID).checked, true);
      assert.equal(mock.contextMenuItems.get(bg.VERSION_DR4_MENU_ID).checked, false);
      assert.ok(requestedUrl.includes("version=dr3"));
      assert.equal(mock.actionState.badgeText[1], "92");
      assert.equal(mock.actionState.title[1], "Domain Rating (DR3): 92");
    } finally {
      global.fetch = originalFetch;
    }
  });

  await t.test("fetchRating correctly builds URL with target and version", async () => {
    let capturedUrl = "";
    let capturedHeaders = {};
    const originalFetch = global.fetch;
    global.fetch = async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      return {
        ok: true,
        status: 200,
        json: async () => ({ domain_rating: { domain_rating: 88 } }),
      };
    };

    try {
      const rating = await bg.fetchRating("example.com", "dr4");
      assert.equal(rating, 88);
      const urlObj = new URL(capturedUrl);
      assert.equal(urlObj.searchParams.get("target"), "example.com");
      assert.equal(urlObj.searchParams.get("version"), "dr4");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
