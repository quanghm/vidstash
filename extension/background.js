// Watches network traffic for media URLs and keeps a per-tab list.
//
// webRequest sees every request the page makes, including ones issued by fetch
// or XHR from inside a player, so it catches HLS/DASH manifests that never
// appear in the DOM. That is why there is no page-world hook here.

const MAX_PER_TAB = 40;
const WATCHED_TYPES = new Set(["media", "xmlhttprequest", "other"]);

function pathOf(url) {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

// Segments arrive by the thousand and are useless on their own — we want the
// manifest that lists them.
function isSegment(url) {
  const path = pathOf(url);
  if (/\.(ts|m4s|aac)$/i.test(path)) return true;
  if (/(^|[/_-])(seg|segment|chunk|frag|fragment)[-_]?\d+/i.test(path)) return true;
  return false;
}

function classify(url) {
  const path = pathOf(url);
  if (/\.m3u8$/i.test(path)) return "HLS";
  if (/\.mpd$/i.test(path)) return "DASH";
  if (/\.(mp4|webm|mkv|m4v|mov|flv|avi)$/i.test(path)) return "FILE";
  return null;
}

// All storage writes go through one chain so concurrent requests can't clobber
// each other's read-modify-write.
let chain = Promise.resolve();
function enqueue(fn) {
  chain = chain.then(fn).catch((err) => console.error("[vidstash]", err));
}

async function setBadge(tabId, count) {
  try {
    await chrome.action.setBadgeText({ tabId, text: count ? String(count) : "" });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#2563eb" });
  } catch {
    // Tab closed mid-flight; nothing to badge.
  }
}

async function add(tabId, entry) {
  const key = `tab:${tabId}`;
  const stored = (await chrome.storage.session.get(key))[key] || [];
  if (stored.some((e) => e.url === entry.url)) return;
  stored.unshift(entry);
  if (stored.length > MAX_PER_TAB) stored.length = MAX_PER_TAB;
  await chrome.storage.session.set({ [key]: stored });
  await setBadge(tabId, stored.length);
}

async function clearTab(tabId) {
  await chrome.storage.session.remove(`tab:${tabId}`);
  await setBadge(tabId, 0);
}

chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.tabId < 0) return;

    if (d.type === "main_frame") {
      enqueue(() => clearTab(d.tabId));
      return;
    }
    if (!WATCHED_TYPES.has(d.type)) return;
    if (!/^https?:/i.test(d.url)) return;
    if (isSegment(d.url)) return;

    const kind = classify(d.url) || (d.type === "media" ? "MEDIA" : null);
    if (!kind) return;

    enqueue(() => add(d.tabId, { url: d.url, kind, at: Date.now() }));
  },
  { urls: ["<all_urls>"] }
);

chrome.tabs.onRemoved.addListener((tabId) => enqueue(() => clearTab(tabId)));

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "dom-media") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number" && tabId >= 0) {
      for (const url of msg.urls) {
        if (!isSegment(url)) {
          enqueue(() => add(tabId, { url, kind: classify(url) || "DOM", at: Date.now() }));
        }
      }
    }
    return false;
  }

  if (msg?.type === "get-media") {
    const key = `tab:${msg.tabId}`;
    chrome.storage.session.get(key).then((got) => sendResponse(got[key] || []));
    return true;
  }

  if (msg?.type === "clear-media") {
    enqueue(() => clearTab(msg.tabId));
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
