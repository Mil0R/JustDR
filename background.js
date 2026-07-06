// Default badge text shown on the extension icon.
const DEFAULT_BADGE = "DR";
const DEFAULT_COLOR = "#5a5a5a";
const LOADING_COLOR = "#888888";
const ERROR_COLOR = "#b00020";
const API_BASE = "https://api.ahrefs.com/v3/public/domain-rating-free";
const CACHE_TTL_MS = 5 * 60 * 1000;
const AUTO_FETCH_KEY = "autoFetchEnabled";
const AUTO_FETCH_MENU_ID = "toggle-auto-fetch";
const AUTO_FETCH_MENU_TITLE = "Auto DR";

const ratingCache = new Map();
const pendingRequests = new Map();
let contextMenuReadyPromise;

function setBadge(text, color = DEFAULT_COLOR, tabId) {
  const details = tabId === undefined ? { text } : { text, tabId };
  const colorDetails = tabId === undefined ? { color } : { color, tabId };

  chrome.action.setBadgeText(details);
  chrome.action.setBadgeBackgroundColor(colorDetails);
}

async function getAutoFetchEnabled() {
  const stored = await chrome.storage.local.get(AUTO_FETCH_KEY);
  return stored[AUTO_FETCH_KEY] === true;
}

async function setAutoFetchEnabled(enabled) {
  await chrome.storage.local.set({ [AUTO_FETCH_KEY]: enabled });
  await updateContextMenu(enabled);
}

async function updateContextMenu(checked) {
  try {
    await chrome.contextMenus.update(AUTO_FETCH_MENU_ID, { checked });
  } catch (error) {
    console.debug("Context menu update skipped:", error);
  }
}

function createContextMenuItem(options) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.create(options, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

async function ensureContextMenu() {
  if (!contextMenuReadyPromise) {
    contextMenuReadyPromise = (async () => {
      const checked = await getAutoFetchEnabled();

      try {
        await chrome.contextMenus.update(AUTO_FETCH_MENU_ID, {
          title: AUTO_FETCH_MENU_TITLE,
          type: "checkbox",
          contexts: ["action"],
          checked,
        });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("Cannot find menu item")) {
          throw error;
        }

        await createContextMenuItem({
          id: AUTO_FETCH_MENU_ID,
          title: AUTO_FETCH_MENU_TITLE,
          type: "checkbox",
          contexts: ["action"],
          checked,
        });
      }
    })().finally(() => {
      contextMenuReadyPromise = undefined;
    });
  }

  return contextMenuReadyPromise;
}

async function initializeAction() {
  setBadge(DEFAULT_BADGE);
  await ensureContextMenu();
}

chrome.runtime.onInstalled.addListener(() => {
  initializeAction().catch((error) => {
    console.error("Extension initialization failed:", error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  initializeAction().catch((error) => {
    console.error("Startup initialization failed:", error);
  });
});

// Also set it when the service worker first spins up.
initializeAction().catch((error) => {
  console.error("Initial service worker setup failed:", error);
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId !== AUTO_FETCH_MENU_ID) {
    return;
  }

  setAutoFetchEnabled(info.checked === true).catch((error) => {
    console.error("Failed to update auto-fetch setting:", error);
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    setBadge(DEFAULT_BADGE, DEFAULT_COLOR, tabId);
    return;
  }

  if (changeInfo.status !== "complete") {
    return;
  }

  maybeAutoFetchForTab(tabId, tab).catch((error) => {
    console.error("Auto-fetch on tab update failed:", error);
  });
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs
    .get(tabId)
    .then((tab) => maybeAutoFetchForTab(tabId, tab))
    .catch((error) => {
      console.error("Auto-fetch on tab activation failed:", error);
    });
});

chrome.action.onClicked.addListener((tab) => {
  fetchAndDisplayRating(tab).catch((error) => {
    console.error("Domain Rating fetch failed:", error);
    if (tab.id !== undefined) {
      setBadge("ERR", ERROR_COLOR, tab.id);
    }
  });
});

async function maybeAutoFetchForTab(tabId, tab) {
  if (!(await getAutoFetchEnabled())) {
    return;
  }

  await fetchAndDisplayRating(tab ?? { id: tabId });
}

async function fetchAndDisplayRating(tab) {
  const tabId = tab.id;
  if (tabId === undefined) {
    throw new Error("No tab ID available.");
  }

  const url = tab.url ?? (await chrome.tabs.get(tabId)).url;

  // Loading state.
  setBadge("...", LOADING_COLOR, tabId);

  try {
    const hostname = getHostname(url);
    const rating = await getDomainRating(hostname);
    const badge = formatBadgeText(rating);
    const color = scoreColor(rating);
    setBadge(badge, color, tabId);
  } catch (error) {
    if (isUnsupportedUrlError(error)) {
      setBadge(DEFAULT_BADGE, DEFAULT_COLOR, tabId);
      return;
    }

    setBadge("ERR", ERROR_COLOR, tabId);
    throw error;
  }
}

function getHostname(url) {
  if (!url) throw new Error("No URL for this tab.");

  const { protocol, hostname } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`Unsupported protocol: ${protocol}`);
  }
  if (!hostname) throw new Error("Could not parse domain.");

  return hostname;
}

function isUnsupportedUrlError(error) {
  return error instanceof Error && error.message.startsWith("Unsupported protocol:");
}

async function getDomainRating(hostname) {
  const now = Date.now();
  const cached = ratingCache.get(hostname);
  if (cached && cached.expiresAt > now) {
    return cached.rating;
  }

  const pending = pendingRequests.get(hostname);
  if (pending) {
    return pending;
  }

  const request = fetchRating(hostname)
    .then((rating) => {
      ratingCache.set(hostname, {
        rating,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return rating;
    })
    .finally(() => {
      pendingRequests.delete(hostname);
    });

  pendingRequests.set(hostname, request);
  return request;
}

async function fetchRating(hostname) {
  const apiUrl = `${API_BASE}?target=${encodeURIComponent(hostname)}`;
  const res = await fetch(apiUrl, { method: "GET" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  return normalizeRating(data?.domain_rating?.domain_rating);
}

function normalizeRating(value) {
  return typeof value === "number" && !Number.isNaN(value) ? value : null;
}

function formatBadgeText(rating) {
  if (rating === null) {
    return "N/A";
  }

  const compact = Number.isInteger(rating) ? String(rating) : rating.toFixed(1);
  return compact.length > 4 ? compact.slice(0, 4) : compact;
}

function scoreColor(score) {
  const normalizedScore =
    typeof score === "number" ? Math.max(0, Math.min(100, score)) : 0;

  if (normalizedScore >= 80) return "#1f9d55";
  if (normalizedScore >= 60) return "#65a30d";
  if (normalizedScore >= 40) return "#ca8a04";
  if (normalizedScore >= 20) return "#ea580c";
  return "#dc2626";
}
