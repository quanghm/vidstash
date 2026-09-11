"""Entry point: `python -m vidstash` or the `vidstash` console script."""

from __future__ import annotations

import argparse

import uvicorn

from . import config
from .server import app, cfg


def main() -> None:
    parser = argparse.ArgumentParser(prog="vidstash", description="Local yt-dlp daemon.")
    parser.add_argument("--port", type=int, default=cfg["port"])
    parser.add_argument(
        "--print-token",
        action="store_true",
        help="print the API token and exit",
    )
    args = parser.parse_args()

    if args.print_token:
        print(cfg["token"])
        return

    print(f"vidstash  http://127.0.0.1:{args.port}")
    print(f"  config     {config.config_path()}")
    print(f"  downloads  {cfg['download_dir']}")
    print(f"  token      {cfg['token']}")
    print("\nPaste that token into the extension's options page.\n")

    # Loopback only. Never bind 0.0.0.0 here.
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
