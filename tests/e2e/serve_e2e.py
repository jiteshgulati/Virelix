"""Start an isolated Virelix server for browser tests.

Copies the sample corpus into a throwaway folder and uses a fresh data folder,
so destructive tests (uploads, removals, suspensions) never touch real data.
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

work = Path(tempfile.mkdtemp(prefix="virelix-e2e-"))
shutil.copytree(ROOT / "corpus", work / "corpus")
os.environ.update({
    "VIRELIX_ENV": "development",
    "VIRELIX_CORPUS_DIR": str(work / "corpus"),
    "VIRELIX_DATA_DIR": str(work / "data"),
    "VIRELIX_PORT": os.environ.get("E2E_PORT", "8799"),
    "OWNER_EMAIL": "owner@virelix.test",
    "VIRELIX_REGISTER_RATE_LIMIT": "100000",
    "VIRELIX_QUIET": "1",
    "VIRELIX_DEV_MAILBOX_KEY": os.environ.get("E2E_DEV_KEY", "e2e-developer-key"),
})

from backend.config import from_env  # noqa: E402
from backend.server import serve  # noqa: E402

try:
    serve(from_env())
finally:
    shutil.rmtree(work, ignore_errors=True)
