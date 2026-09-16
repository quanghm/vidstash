"""Loopback HTTP API for the browser extension."""

from __future__ import annotations

import re
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import config
from .jobs import JobStore, probe

# Only browser extensions may talk to the daemon. The token is the real gate;
# this keeps an ordinary web page from reaching it even if the token leaks.
EXT_ORIGIN = r"^(chrome-extension|moz-extension|safari-web-extension)://[a-zA-Z0-9-]+$"

cfg = config.load()
store = JobStore(cfg)

app = FastAPI(title="vidstash", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=EXT_ORIGIN,
    allow_methods=["GET", "POST"],
    allow_headers=["Authorization", "Content-Type"],
)


def auth(authorization: str = Header(default=""), origin: str = Header(default="")) -> None:
    if origin and not re.match(EXT_ORIGIN, origin):
        raise HTTPException(status_code=403, detail="origin not allowed")
    if not secrets.compare_digest(authorization, f"Bearer {cfg['token']}"):
        raise HTTPException(status_code=401, detail="bad or missing token")


class ProbeReq(BaseModel):
    url: str
    cookies: list[dict] = []
    referer: str | None = None
    user_agent: str | None = None


class DownloadReq(ProbeReq):
    format_id: str | None = None
    title: str | None = None


@app.get("/health")
def health() -> dict:
    """Unauthenticated on purpose — the extension uses it to detect the daemon."""
    return {"ok": True, "name": "vidstash"}


@app.get("/config", dependencies=[Depends(auth)])
def get_config() -> dict:
    return {
        "download_dir": cfg["download_dir"],
        "format": cfg["format"],
        "max_concurrent": cfg["max_concurrent"],
    }


@app.post("/probe", dependencies=[Depends(auth)])
def post_probe(req: ProbeReq) -> dict:
    try:
        return probe(req.url, req.cookies, req.referer, req.user_agent)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/download", dependencies=[Depends(auth)])
def post_download(req: DownloadReq) -> dict:
    return store.submit(
        req.url, req.format_id, req.cookies, req.referer, req.title, req.user_agent
    )


@app.get("/jobs", dependencies=[Depends(auth)])
def get_jobs() -> dict:
    return {"jobs": store.list()}


@app.post("/jobs/{job_id}/cancel", dependencies=[Depends(auth)])
def post_cancel(job_id: str) -> dict:
    if not store.cancel(job_id):
        raise HTTPException(status_code=404, detail="no such job, or already finished")
    return {"ok": True}


@app.post("/jobs/clear", dependencies=[Depends(auth)])
def post_clear() -> dict:
    return {"cleared": store.clear_finished()}
