"""Simple keep-alive utility for periodically pinging the deployed Space."""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Final

DEFAULT_INTERVAL_SECONDS: Final[int] = 600
DEFAULT_ENDPOINT: Final[str] = "/health"


def build_url(base_url: str, endpoint: str) -> str:
    """Combine base URL and endpoint path safely."""
    if not base_url:
        raise ValueError("A base URL must be provided via --url or the SPACE_URL environment variable.")

    base = base_url.rstrip("/")
    path = endpoint if endpoint.startswith("/") else f"/{endpoint}"
    return f"{base}{path}"


def ping(url: str, timeout: float) -> int:
    """Perform a GET request and return the status code."""
    request = urllib.request.Request(url=url, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 - trusted URL provided by operator
        return response.getcode()


def main() -> int:
    parser = argparse.ArgumentParser(description="Keep the Hugging Face Space awake by pinging a health endpoint.")
    parser.add_argument("--url", default=os.environ.get("SPACE_URL"), help="Base URL of the deployed Space.")
    parser.add_argument(
        "--endpoint",
        default=os.environ.get("SPACE_HEALTH_ENDPOINT", DEFAULT_ENDPOINT),
        help="Relative path of the health endpoint to ping (default: /health).",
    )
    parser.add_argument(
        "--interval",
        type=int,
        default=int(os.environ.get("SPACE_PING_INTERVAL", DEFAULT_INTERVAL_SECONDS)),
        help="Interval between pings in seconds (default: 600).",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=float(os.environ.get("SPACE_PING_TIMEOUT", 10)),
        help="Request timeout in seconds (default: 10).",
    )

    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    try:
        target_url = build_url(args.url, args.endpoint)
    except ValueError as exc:  # pragma: no cover - defensive guard for CLI usage errors
        logging.error("%s", exc)
        return 1

    logging.info("Starting keep-alive pings to %s every %s seconds", target_url, args.interval)
    while True:
        try:
            status = ping(target_url, args.timeout)
            logging.info("Ping successful with status %s", status)
        except urllib.error.URLError as exc:
            logging.error("Ping failed: %s", exc)
        except Exception as exc:  # pragma: no cover - catch-all to avoid crash in unattended environments
            logging.exception("Unexpected error while pinging %s", target_url)
        time.sleep(args.interval)


if __name__ == "__main__":
    sys.exit(main())
