#!/usr/bin/env python3
"""Start Virelix locally:  python run.py  [--port 8000] [--host 127.0.0.1]"""

import argparse
import sys

if sys.version_info < (3, 11):
    sys.exit("Virelix needs Python 3.11 or newer.")

# Console output may be redirected on Windows, where the default code page can't encode the banner
# symbols. Never let a print() take the server down.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(errors="replace")

from backend.config import from_env  # noqa: E402
from backend.server import serve      # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Virelix development server.")
    parser.add_argument("--host", help="Bind address (default from VIRELIX_HOST or 127.0.0.1)")
    parser.add_argument("--port", type=int, help="Port (default from VIRELIX_PORT or 8000)")
    args = parser.parse_args()
    overrides = {k: v for k, v in {"host": args.host, "port": args.port}.items() if v is not None}
    serve(from_env(**overrides))


if __name__ == "__main__":
    main()
