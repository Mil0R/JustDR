// Default badge text shown on the extension icon.
const DEFAULT_BADGE = "DR";
const DEFAULT_COLOR = "#5a5a5a";
const LOADING_COLOR = "#888888";
const ERROR_COLOR = "#b00020";
const API_BASE = "https://api.ahrefs.com/v3/public/domain-rating-free";
const DEFAULT_API_AUTHORIZATION =
  "Bearer bHCWl-mn7fMMRFdYfqmPTD7KP9XxjVYDDlEXBWBz";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_INTERVAL_MS = 2 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;

const AUTO_FETCH_KEY = "autoFetchEnabled";
const RATE_LIMIT_KEY = "rateLimitedUntil";
const AUTO_FETCH_MENU_ID = "toggle-auto-fetch";
const AUTO_FETCH_MENU_TITLE = "Auto DR";

const VERSION_KEY = "drVersion";
const DEFAULT_VERSION = "dr3";
const DR_VERSIONS = {
  DR3: "dr3",
  DR4: "dr4",
};
const VERSION_DR3_MENU_ID = "version-dr3";
const VERSION_DR4_MENU_ID = "version-dr4";
const SEPARATOR_VERSION_ID = "separator-version";
const API_KEY_STORAGE_KEY = "ahrefsApiKey";

const ratingCache = new Map();
const pendingRequests = new Map();
let contextMenuReadyPromise;
let requestQueue = Promise.resolve();
let nextRequestAt = 0;
let rateLimitedUntil = 0;

class RateLimitError extends Error {
  constructor(retryAfterMs) {
    super("Ahrefs API rate limit reached.");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

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

async function getDrVersion() {
  const stored = await chrome.storage.local.get(VERSION_KEY);
  const version = stored[VERSION_KEY];
  return version === DR_VERSIONS.DR4 ? DR_VERSIONS.DR4 : DR_VERSIONS.DR3;
}

async function setDrVersion(version) {
  const normalized = version === DR_VERSIONS.DR4 ? DR_VERSIONS.DR4 : DR_VERSIONS.DR3;
  await chrome.storage.local.set({ [VERSION_KEY]: normalized });
  await updateVersionContextMenu(normalized);
  await updateActionTitle(normalized);
  return normalized;
}

async function updateActionTitle(version, tabId) {
  const title = `Domain Rating (${version.toUpperCase()})`;
  try {
    const details = tabId === undefined ? { title } : { title, tabId };
    await chrome.action.setTitle(details);
  } catch (error) {
    console.debug("Setting action title failed:", error);
  }
}

async function updateContextMenu(checked) {
  try {
    await updateContextMenuItem(AUTO_FETCH_MENU_ID, { checked });
  } catch (error) {
    console.debug("Context menu update skipped for auto-fetch:", error);
  }
}

async function updateVersionContextMenu(version) {
  try {
    await updateContextMenuItem(VERSION_DR3_MENU_ID, {
      checked: version === DR_VERSIONS.DR3,
    });
  } catch (error) {
    console.debug("Context menu update skipped for DR3:", error);
  }

  try {
    await updateContextMenuItem(VERSION_DR4_MENU_ID, {
      checked: version === DR_VERSIONS.DR4,
    });
  } catch (error) {
    console.debug("Context menu update skipped for DR4:", error);
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

function updateContextMenuItem(id, options) {
  return new Promise((resolve, reject) => {
    chrome.contextMenus.update(id, options, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      resolve();
    });
  });
}

async function ensureMenuItem(options) {
  try {
    const updateOptions = { ...options };
    delete updateOptions.id;
    await updateContextMenuItem(options.id, updateOptions);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Cannot find menu item")) {
      try {
        await createContextMenuItem(options);
      } catch (createError) {
        if (!createError.message.includes("duplicate id")) {
          throw createError;
        }
      }
    } else {
      throw error;
    }
  }
}

async function ensureContextMenu() {
  if (!contextMenuReadyPromise) {
    contextMenuReadyPromise = (async () => {
      const [checked, version] = await Promise.all([
        getAutoFetchEnabled(),
        getDrVersion(),
      ]);

      await ensureMenuItem({
        id: AUTO_FETCH_MENU_ID,
        title: AUTO_FETCH_MENU_TITLE,
        type: "checkbox",
        contexts: ["action"],
        checked,
      });

      await ensureMenuItem({
        id: SEPARATOR_VERSION_ID,
        type: "separator",
        contexts: ["action"],
      });

      await ensureMenuItem({
        id: VERSION_DR3_MENU_ID,
        title: "DR3",
        type: "radio",
        contexts: ["action"],
        checked: version === DR_VERSIONS.DR3,
      });

      await ensureMenuItem({
        id: VERSION_DR4_MENU_ID,
        title: "DR4",
        type: "radio",
        contexts: ["action"],
        checked: version === DR_VERSIONS.DR4,
      });
    })().finally(() => {
      contextMenuReadyPromise = undefined;
    });
  }

  return contextMenuReadyPromise;
}

async function initializeAction() {
  const version = await getDrVersion();
  setBadge(DEFAULT_BADGE);
  await updateActionTitle(version);
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === AUTO_FETCH_MENU_ID) {
    return setAutoFetchEnabled(info.checked === true).catch((error) => {
      console.error("Failed to update auto-fetch setting:", error);
    });
  }

  if (info.menuItemId === VERSION_DR3_MENU_ID || info.menuItemId === VERSION_DR4_MENU_ID) {
    const targetVersion =
      info.menuItemId === VERSION_DR4_MENU_ID ? DR_VERSIONS.DR4 : DR_VERSIONS.DR3;
    return handleVersionChange(targetVersion, tab).catch((error) => {
      console.error(`Failed to switch DR version to ${targetVersion}:`, error);
    });
  }
});

async function handleVersionChange(version, tab) {
  await setDrVersion(version);

  let targetTab = tab;
  if (!targetTab || targetTab.id === undefined) {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      targetTab = activeTab;
    } catch (queryErr) {
      console.debug("Failed to query active tab:", queryErr);
    }
  }

  if (targetTab && targetTab.id !== undefined) {
    try {
      const url = targetTab.url ?? (await chrome.tabs.get(targetTab.id)).url;
      const hostname = getHostname(url);
      if (hostname) {
        await fetchAndDisplayRating(targetTab);
      }
    } catch (error) {
      if (!isUnsupportedUrlError(error)) {
        console.debug("Could not refresh rating after version change:", error);
      }
    }
  }
}

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
    const version = await getDrVersion();
    const rating = await getDomainRating(hostname, version);
    const badge = formatBadgeText(rating);
    const color = scoreColor(rating);
    setBadge(badge, color, tabId);

    const titleRating = rating !== null ? rating : "N/A";
    const tabTitle = `Domain Rating (${version.toUpperCase()}): ${titleRating}`;
    await chrome.action.setTitle({ tabId, title: tabTitle }).catch((e) => {
      console.debug("Failed to set tab action title:", e);
    });
  } catch (error) {
    if (isUnsupportedUrlError(error)) {
      setBadge(DEFAULT_BADGE, DEFAULT_COLOR, tabId);
      return;
    }

    if (error instanceof RateLimitError) {
      setBadge("429", ERROR_COLOR, tabId);
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

function getCacheKey(hostname, version) {
  return `${hostname}:${version}`;
}

async function getDomainRating(hostname, version = DEFAULT_VERSION) {
  const cacheKey = getCacheKey(hostname, version);
  const now = Date.now();
  const cached = ratingCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.rating;
  }

  const pending = pendingRequests.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = queueRatingRequest(hostname, version)
    .then((rating) => {
      ratingCache.set(cacheKey, {
        rating,
        expiresAt: Date.now() + CACHE_TTL_MS,
      });
      return rating;
    })
    .finally(() => {
      pendingRequests.delete(cacheKey);
    });

  pendingRequests.set(cacheKey, request);
  return request;
}

async function getApiKey() {
  const stored = await chrome.storage.local.get(API_KEY_STORAGE_KEY);
  return stored[API_KEY_STORAGE_KEY] || "";
}

function queueRatingRequest(hostname, version = DEFAULT_VERSION) {
  const request = requestQueue.then(async () => {
    const stored = await chrome.storage.local.get(RATE_LIMIT_KEY);
    const storedRateLimit = stored[RATE_LIMIT_KEY];
    if (typeof storedRateLimit === "number") {
      rateLimitedUntil = Math.max(rateLimitedUntil, storedRateLimit);
    }

    const now = Date.now();
    if (now < rateLimitedUntil) {
      throw new RateLimitError(rateLimitedUntil - now);
    }

    const delay = Math.max(0, nextRequestAt - now);
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    nextRequestAt = Date.now() + REQUEST_INTERVAL_MS;
    return fetchRating(hostname, version);
  });

  requestQueue = request.catch(() => undefined);
  return request;
}

async function fetchRating(hostname, version = DEFAULT_VERSION) {
  const endpoint = new URL(API_BASE);
  endpoint.searchParams.set("target", hostname);
  if (version) {
    endpoint.searchParams.set("version", version);
  }

  const headers = {
    Accept: "application/json",
    Authorization: DEFAULT_API_AUTHORIZATION,
  };
  const apiKey = await getApiKey();
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const res = await fetch(endpoint.toString(), {
    method: "GET",
    headers,
  });

  if (res.status === 429) {
    const retryAfterMs = parseRetryAfter(res.headers.get("Retry-After"));
    rateLimitedUntil = Date.now() + retryAfterMs;
    await chrome.storage.local.set({ [RATE_LIMIT_KEY]: rateLimitedUntil });
    throw new RateLimitError(retryAfterMs);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  return normalizeRating(data?.domain_rating?.domain_rating);
}

function parseRetryAfter(value) {
  if (!value) {
    return RATE_LIMIT_COOLDOWN_MS;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt)
    ? RATE_LIMIT_COOLDOWN_MS
    : Math.max(0, retryAt - Date.now());
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

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_BADGE,
    DEFAULT_VERSION,
    DR_VERSIONS,
    VERSION_KEY,
    VERSION_DR3_MENU_ID,
    VERSION_DR4_MENU_ID,
    SEPARATOR_VERSION_ID,
    API_BASE,
    ratingCache,
    pendingRequests,
    setBadge,
    getAutoFetchEnabled,
    setAutoFetchEnabled,
    getDrVersion,
    setDrVersion,
    updateActionTitle,
    ensureContextMenu,
    handleVersionChange,
    getHostname,
    isUnsupportedUrlError,
    getCacheKey,
    getDomainRating,
    fetchRating,
    parseRetryAfter,
    RateLimitError,
    normalizeRating,
    formatBadgeText,
    scoreColor,
  };
}
