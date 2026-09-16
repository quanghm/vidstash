// Reports plain <video>/<audio> sources. Anything using Media Source Extensions
// will have a blob: URL here, which is useless — webRequest in the background
// catches those cases instead.

const seen = new Set();
let timer = null;

function collect() {
  const urls = [];
  const nodes = document.querySelectorAll("video, audio, video source, audio source");
  for (const el of nodes) {
    const src = el.currentSrc || el.src || el.getAttribute("src") || "";
    if (/^https?:/i.test(src) && !seen.has(src)) {
      seen.add(src);
      urls.push(src);
    }
  }
  return urls;
}

function report() {
  const urls = collect();
  if (!urls.length) return;
  chrome.runtime.sendMessage({ type: "dom-media", urls }).catch(() => {
    // Service worker asleep or extension reloading; the next pass will retry.
  });
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    report();
  }, 500);
}

report();
new MutationObserver(schedule).observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["src"],
});
setInterval(report, 3000);

// document.title is often a generic/tracking string (e.g. "VIP_VIP_A...") on
// video sites; og:title or the page's own heading is usually the real name.
function bestTitle() {
  const meta =
    document.querySelector('meta[property="og:title"]') ||
    document.querySelector('meta[name="twitter:title"]');
  const metaTitle = meta?.content?.trim();
  if (metaTitle) return metaTitle;

  const heading = document.querySelector("h1")?.textContent?.trim();
  if (heading) return heading;

  return document.title || "";
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "get-page-title") {
    sendResponse(bestTitle());
    return false;
  }
  return false;
});
