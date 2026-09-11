const DEFAULTS = { daemonUrl: "http://127.0.0.1:8723", token: "", sendCookies: true };
const TIMEOUT_MS = 5000;

const $ = (id) => document.getElementById(id);

// Without a deadline a stalled request leaves the button looking dead, which is
// indistinguishable from the script never having loaded.
async function fetchWithTimeout(url, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function msg(text, ok) {
  $("msg").textContent = text;
  $("msg").style.color = ok ? "#16a34a" : "#dc2626";
}

async function restore() {
  const s = await chrome.storage.local.get(DEFAULTS);
  $("daemonUrl").value = s.daemonUrl;
  $("token").value = s.token;
  $("sendCookies").checked = s.sendCookies;
}

$("save").addEventListener("click", async () => {
  await chrome.storage.local.set({
    daemonUrl: $("daemonUrl").value.trim().replace(/\/+$/, ""),
    token: $("token").value.trim(),
    sendCookies: $("sendCookies").checked,
  });
  msg("Saved.", true);
});

$("test").addEventListener("click", async () => {
  const base = $("daemonUrl").value.trim().replace(/\/+$/, "");
  const token = $("token").value.trim();

  msg("Testing…", true);
  if (!base) {
    msg("Set a daemon URL first.", false);
    return;
  }

  try {
    const health = await fetchWithTimeout(`${base}/health`);
    if (!health.ok) throw new Error(`daemon returned ${health.status} on /health`);

    const cfg = await fetchWithTimeout(`${base}/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (cfg.status === 401) throw new Error("Daemon reachable, but the token is wrong.");
    if (cfg.status === 403) throw new Error("Daemon refused this origin.");
    if (!cfg.ok) throw new Error(`daemon returned ${cfg.status} on /config`);

    const { download_dir: dir } = await cfg.json();
    msg(`Connected. Saving to ${dir}`, true);
  } catch (err) {
    if (err.name === "AbortError") {
      msg(`No response within ${TIMEOUT_MS / 1000}s — is the daemon running?`, false);
    } else if (err.message === "Failed to fetch") {
      msg(`Could not reach ${base}. Start the daemon, then try again.`, false);
    } else {
      msg(err.message, false);
    }
  }
});

restore();
