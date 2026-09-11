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
