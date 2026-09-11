const DEFAULTS = { daemonUrl: "http://127.0.0.1:8723", token: "", sendCookies: true };

const $ = (id) => document.getElementById(id);

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
  try {
    const health = await fetch(`${base}/health`);
    if (!health.ok) throw new Error(`daemon returned ${health.status}`);

    const cfg = await fetch(`${base}/config`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (cfg.status === 401) throw new Error("daemon reachable, but the token is wrong");
    if (!cfg.ok) throw new Error(`daemon returned ${cfg.status}`);

    const { download_dir: dir } = await cfg.json();
    msg(`Connected. Saving to ${dir}`, true);
  } catch (err) {
    msg(err.message === "Failed to fetch" ? "Daemon unreachable." : err.message, false);
  }
});

restore();
