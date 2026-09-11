# vidstash

A browser extension that spots media on the page and hands it to a local
[yt-dlp](https://github.com/yt-dlp/yt-dlp) daemon.

The split is the whole idea. yt-dlp is excellent at parsing HLS and DASH
manifests, picking a quality ladder, fetching segments in parallel and muxing
audio and video — but it does not run JavaScript, so it is blind to anything a
player constructs at runtime. The browser is the opposite: it sees every
request the page makes, and knows nothing about muxing. So the extension does
detection and the daemon does the work.

Personal tool. No installer, no store listing, no signing — just load it
unpacked and run the daemon yourself.

## What it does

- Watches network traffic for HLS (`.m3u8`), DASH (`.mpd`) and plain media
  files, per tab, with a badge count.
- Lets you download the page URL directly, which is the path that works most
  often — yt-dlp's own extractors handle well over a thousand sites.
- Shows the format ladder so you can pick a resolution before downloading.
- Forwards the tab's cookies, so anything behind a login works without
  yt-dlp having to decrypt your browser profile.
- Live progress and cancellation.

## Install

You need Python 3.10+ and ffmpeg.

**macOS**

```bash
brew install ffmpeg
```

**Ubuntu**

```bash
sudo apt install -y ffmpeg python3-venv
```

**Windows**

```powershell
winget install Gyan.FFmpeg
```

Then the daemon, on any of them:

```bash
python3 -m venv daemon/.venv && daemon/.venv/bin/pip install -e daemon
```

On Windows that's `daemon\.venv\Scripts\pip install -e daemon`.

## Run

```bash
daemon/.venv/bin/vidstash
```

It prints its URL, download directory and API token on startup. Config lives
next to it — `~/.config/vidstash/config.json` on Linux,
`~/Library/Application Support/vidstash/` on macOS, `%APPDATA%\vidstash\` on
Windows. Edit `download_dir` or `format` there.

Then load the extension: open `chrome://extensions`, turn on Developer mode,
click **Load unpacked** and pick the `extension/` directory. Open its options
page and paste in the token.

To keep the daemon running in the background, use a systemd user unit on
Ubuntu, a launchd agent on macOS, or Task Scheduler at logon on Windows.

## Security

The daemon runs arbitrary downloads, so it is gated two ways: it binds to
`127.0.0.1` only, and every endpoint except `/health` requires the bearer
token. It also rejects any request whose `Origin` is a web page rather than a
browser extension, so a page you happen to be visiting cannot drive it even if
the token leaks.

Cookies are read with `chrome.cookies` and sent to the daemon on your own
machine. Turn that off in options if you would rather they stayed put.

## Limits

- **DRM is out of scope.** Widevine, FairPlay and PlayReady content decrypts
  inside a module the browser does not expose, so anything from a major
  streaming service will not work, and nothing here tries.
- **Chromium only for now.** The manifest uses an MV3 service worker; Firefox
  wants an event page, so it needs a small manifest change.
- The service worker's detected-media list lives in `chrome.storage.session`
  and clears when the tab navigates or closes.
- Segment URLs (`.ts`, `.m4s`) are filtered out of the detected list
  deliberately — the manifest is the useful thing.
- Cancelling leaves yt-dlp's `.part` files in the download directory. That is
  how resuming works, but nothing cleans them up yet.

Respect the terms of the sites you use it on, and other people's copyrights.

## Layout

```
daemon/vidstash/
  config.py   config file, token generation
  jobs.py     job store, yt-dlp execution, cookie jar
  server.py   FastAPI routes, auth, CORS
extension/
  background.js  webRequest sniffing, per-tab media list
  content.js     <video>/<source> scanning
  popup.js       UI: page download, format picker, job list
  options.js     daemon URL, token, cookie toggle
```

## License

MIT
