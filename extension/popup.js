const $ = (id) => document.getElementById(id);

let settings = null;
let tab = null;

const DEFAULTS = { daemonUrl: "http://127.0.0.1:8723", token: "", sendCookies: true };
const ACTIVE = new Set(["queued", "downloading", "processing"]);

function fmtBytes(n) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function fmtEta(s) {
  if (s == null) return "";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function toast(msg) {
  $("toast").textContent = msg || "";
}

function baseUrl() {
  return (settings.daemonUrl || "").replace(/\/+$/, "");
}

async function api(path, body) {
  const res = await fetch(baseUrl() + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const payload = await res.json();
      if (payload.detail) detail = payload.detail;
    } catch {
      // Non-JSON error body; the status line will do.
    }
    throw new Error(detail);
  }
  return res.json();
}

async function cookiesFor(url) {
  if (!settings.sendCookies) return [];
  try {
    return await chrome.cookies.getAll({ url });
  } catch {
    return [];
  }
}

async function download(url, formatId, title) {
  toast("");
  try {
    const cookies = await cookiesFor(url);
    await api("/download", {
      url,
      format_id: formatId ?? null,
      cookies,
      referer: tab.url,
      title: title ?? null,
    });
    await refreshJobs();
  } catch (err) {
    toast(err.message);
  }
}

async function showFormats(url, container) {
  container.textContent = "";
  container.appendChild(el("div", "meta", "probing…"));
  try {
    const cookies = await cookiesFor(url);
    const info = await api("/probe", { url, cookies, referer: tab.url });

    container.textContent = "";
    if (info.title) container.appendChild(el("div", "meta", info.title));
    if (!info.formats.length) {
      container.appendChild(el("div", "meta", "no formats reported"));
      return;
    }

    for (const f of info.formats.slice(0, 25)) {
      const hasVideo = f.vcodec && f.vcodec !== "none";
      const hasAudio = f.acodec && f.acodec !== "none";
      const label = [
        f.height ? `${f.height}p` : null,
        f.fps && f.fps > 30 ? `${Math.round(f.fps)}fps` : null,
        f.ext,
        hasVideo && hasAudio ? "a+v" : hasVideo ? "video" : hasAudio ? "audio" : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const row = el("div", "row");
      const grow = el("div", "grow");
      grow.appendChild(el("div", "title", label || f.format_id));
      grow.appendChild(
        el("div", "meta", [f.format_id, fmtBytes(f.filesize), f.note].filter(Boolean).join("  "))
      );

      const btn = el("button", null, "Get");
      btn.addEventListener("click", () => download(url, f.format_id, info.title));

      row.append(grow, btn);
      container.appendChild(row);
    }
  } catch (err) {
    container.textContent = "";
    container.appendChild(el("div", "err", err.message));
  }
}

async function loadMedia() {
  const container = $("media");
  const items = (await chrome.runtime.sendMessage({ type: "get-media", tabId: tab.id })) || [];

  $("media-count").textContent = items.length ? `(${items.length})` : "";
  container.textContent = "";

  if (!items.length) {
    container.appendChild(el("div", "empty", "Nothing seen yet — start playback, then reopen."));
    return;
  }

  for (const item of items) {
    const row = el("div", "row");
    const grow = el("div", "grow");
    grow.appendChild(el("div", "url", item.url));

    const btn = el("button", null, "Get");
    btn.addEventListener("click", () => download(item.url, null, tab.title));

    row.append(el("span", "kind", item.kind), grow, btn);
    container.appendChild(row);
  }
}

async function refreshJobs() {
  const container = $("jobs");
  let jobs;
  try {
    ({ jobs } = await api("/jobs"));
  } catch (err) {
    container.textContent = "";
    container.appendChild(el("div", "err", err.message));
    return;
  }

  container.textContent = "";
  if (!jobs.length) {
    container.appendChild(el("div", "empty", "No jobs yet."));
    return;
  }

  for (const job of jobs.slice(0, 12)) {
    const row = el("div", "row");
    const grow = el("div", "grow");
    grow.appendChild(el("div", "title", job.title || job.url));

    const bits = [job.status];
    if (job.percent != null && job.status === "downloading") bits.push(`${job.percent}%`);
    if (job.speed) bits.push(`${fmtBytes(job.speed)}/s`);
    if (job.eta != null) bits.push(`ETA ${fmtEta(job.eta)}`);
    grow.appendChild(el("div", "meta", bits.join(" · ")));

    if (job.status === "downloading" || job.status === "processing") {
      const bar = el("div", "bar");
      const fill = el("i");
      fill.style.width = `${job.percent ?? 0}%`;
      bar.appendChild(fill);
      grow.appendChild(bar);
    }
    if (job.error) grow.appendChild(el("div", "err", job.error));

    row.appendChild(grow);

    if (ACTIVE.has(job.status)) {
      const btn = el("button", null, "Stop");
      btn.addEventListener("click", async () => {
        try {
          await api(`/jobs/${job.id}/cancel`, {});
        } catch (err) {
          toast(err.message);
        }
        refreshJobs();
      });
      row.appendChild(btn);
    }

    container.appendChild(row);
  }
}

async function init() {
  settings = await chrome.storage.local.get(DEFAULTS);
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  $("open-options").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  let online = false;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch(`${baseUrl()}/health`, { signal: ctl.signal });
    clearTimeout(timer);
    online = res.ok;
  } catch {
    online = false;
  }

  $("dot").className = `dot ${online ? "ok" : "bad"}`;
  $("status").textContent = online ? "connected" : "offline";
  $("offline").hidden = online;
  $("main").hidden = !online;
  if (!online) return;

  $("page-title").textContent = tab.title || "(untitled)";
  $("page-url").textContent = tab.url || "";
  $("dl-page").addEventListener("click", () => download(tab.url, null, tab.title));
  $("formats-page").addEventListener("click", () => showFormats(tab.url, $("page-msg")));

  await loadMedia();
  await refreshJobs();
  setInterval(refreshJobs, 1200);
}

init();
