"""Config file handling. Written with a random token on first run."""

from __future__ import annotations

import json
import os
import secrets
import sys
from pathlib import Path

APP_NAME = "vidstash"
DEFAULT_PORT = 8723

DEFAULTS = {
    "port": DEFAULT_PORT,
    "token": "",
    "download_dir": "",
    "format": "bv*+ba/b",
    "max_concurrent": 2,
}


def config_dir() -> Path:
    if os.name == "nt":
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / APP_NAME


def config_path() -> Path:
    return config_dir() / "config.json"


def save(cfg: dict) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cfg, indent=2) + "\n")
    if os.name != "nt":
        path.chmod(0o600)


def load() -> dict:
    cfg = dict(DEFAULTS)
    path = config_path()
    if path.exists():
        cfg.update(json.loads(path.read_text()))

    dirty = not path.exists()
    if not cfg["token"]:
        cfg["token"] = secrets.token_urlsafe(32)
        dirty = True
    if not cfg["download_dir"]:
        cfg["download_dir"] = str(Path.home() / "Downloads" / APP_NAME)
        dirty = True
    if dirty:
        save(cfg)

    Path(cfg["download_dir"]).mkdir(parents=True, exist_ok=True)
    return cfg
