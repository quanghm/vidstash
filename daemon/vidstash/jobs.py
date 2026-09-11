"""Download jobs, backed by yt-dlp running in a thread pool."""

from __future__ import annotations

import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import yt_dlp


class Cancelled(Exception):
    """Raised out of a progress hook to abort a download."""


def write_cookie_file(cookies: list[dict]) -> str | None:
    """Turn chrome.cookies.getAll() output into a Netscape cookie jar."""
    if not cookies:
        return None

    lines = ["# Netscape HTTP Cookie File", ""]
    for c in cookies:
        domain = c.get("domain") or ""
        if not domain:
            continue
        lines.append(
            "\t".join(
                [
                    domain,
                    "FALSE" if c.get("hostOnly") else "TRUE",
                    c.get("path") or "/",
                    "TRUE" if c.get("secure") else "FALSE",
                    str(int(c.get("expirationDate") or 0)),
                    c.get("name") or "",
                    c.get("value") or "",
                ]
            )
        )

    fd, path = tempfile.mkstemp(prefix="vidstash-cookies-", suffix=".txt")
    with os.fdopen(fd, "w") as fh:
        fh.write("\n".join(lines) + "\n")
    if os.name != "nt":
        os.chmod(path, 0o600)
    return path


def _base_opts(referer: str | None, cookiefile: str | None) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": True,
    }
    if referer:
        opts["http_headers"] = {"Referer": referer}
    if cookiefile:
        opts["cookiefile"] = cookiefile
    return opts


def probe(url: str, cookies: list[dict], referer: str | None) -> dict:
    """Metadata and available formats, without downloading anything."""
    cookiefile = write_cookie_file(cookies)
    try:
        with yt_dlp.YoutubeDL(_base_opts(referer, cookiefile)) as ydl:
            info = ydl.extract_info(url, download=False)
    finally:
        if cookiefile:
            os.unlink(cookiefile)

    if info.get("_type") == "playlist":
        entries = [e for e in (info.get("entries") or []) if e]
        info = entries[0] if entries else info

    formats = []
    for f in info.get("formats") or []:
        if f.get("format_id") in (None, "source"):
            continue
        formats.append(
            {
                "format_id": f.get("format_id"),
                "ext": f.get("ext"),
                "height": f.get("height"),
                "fps": f.get("fps"),
                "vcodec": f.get("vcodec"),
                "acodec": f.get("acodec"),
                "filesize": f.get("filesize") or f.get("filesize_approx"),
                "protocol": f.get("protocol"),
                "note": f.get("format_note"),
            }
        )
    formats.sort(key=lambda f: (f["height"] or 0, f["filesize"] or 0), reverse=True)

    return {
        "title": info.get("title"),
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail"),
        "extractor": info.get("extractor_key"),
        "is_live": bool(info.get("is_live")),
        "formats": formats,
    }


class JobStore:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self._jobs: dict[str, dict] = {}
        self._cancelled: set[str] = set()
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(
            max_workers=max(1, int(cfg.get("max_concurrent") or 2)),
            thread_name_prefix="vidstash",
        )

    def list(self) -> list[dict]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda j: j["created"], reverse=True)

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or job["status"] in ("done", "error", "cancelled"):
                return False
            self._cancelled.add(job_id)
            if job["status"] == "queued":
                job["status"] = "cancelled"
            return True

    def clear_finished(self) -> int:
        with self._lock:
            stale = [
                jid
                for jid, j in self._jobs.items()
                if j["status"] in ("done", "error", "cancelled")
            ]
            for jid in stale:
                del self._jobs[jid]
                self._cancelled.discard(jid)
        return len(stale)

    def submit(
        self,
        url: str,
        format_id: str | None,
        cookies: list[dict],
        referer: str | None,
        title: str | None = None,
    ) -> dict:
        job_id = uuid.uuid4().hex[:12]
        job = {
            "id": job_id,
            "url": url,
            "title": title or url,
            "status": "queued",
            "percent": None,
            "speed": None,
            "eta": None,
            "filename": None,
            "error": None,
            "created": time.time(),
        }
        with self._lock:
            self._jobs[job_id] = job
        self._pool.submit(self._run, job_id, url, format_id, cookies, referer)
        return job

    def _update(self, job_id: str, **fields) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                job.update(fields)

    def _run(
        self,
        job_id: str,
        url: str,
        format_id: str | None,
        cookies: list[dict],
        referer: str | None,
    ) -> None:
        if job_id in self._cancelled:
            self._update(job_id, status="cancelled")
            return

        def hook(d: dict) -> None:
            if job_id in self._cancelled:
                raise Cancelled()
            status = d.get("status")
            if status == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                self._update(
                    job_id,
                    status="downloading",
                    percent=round(done / total * 100, 1) if total else None,
                    speed=d.get("speed"),
                    eta=d.get("eta"),
                    title=(d.get("info_dict") or {}).get("title") or url,
                )
            elif status == "finished":
                # yt-dlp may still have to merge audio and video after this fires.
                self._update(job_id, status="processing", percent=100.0, speed=None, eta=None)

        cookiefile = write_cookie_file(cookies)
        opts = _base_opts(referer, cookiefile)
        opts.update(
            {
                "outtmpl": str(
                    Path(self.cfg["download_dir"]) / "%(title).180B [%(id)s].%(ext)s"
                ),
                "format": format_id or self.cfg.get("format") or "bv*+ba/b",
                "merge_output_format": "mp4",
                "windowsfilenames": True,
                "concurrent_fragment_downloads": 4,
                "retries": 5,
                "fragment_retries": 10,
                "progress_hooks": [hook],
            }
        )

        self._update(job_id, status="downloading")
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = ydl.extract_info(url, download=True)
            filename = None
            if info:
                requested = info.get("requested_downloads") or []
                filename = requested[0].get("filepath") if requested else None
            self._update(
                job_id,
                status="done",
                percent=100.0,
                filename=filename,
                title=(info or {}).get("title") or url,
            )
        except Cancelled:
            self._update(job_id, status="cancelled")
        except Exception as exc:  # yt-dlp raises a wide range of errors
            self._update(job_id, status="error", error=str(exc))
        finally:
            self._cancelled.discard(job_id)
            if cookiefile and os.path.exists(cookiefile):
                os.unlink(cookiefile)
