"""Runtime configuration.

Values come from environment variables, optionally pre-loaded from a local
``.env`` file (never committed). Nothing secret is hard-coded here.
"""

from __future__ import annotations

import os
import secrets
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load_dotenv(path: Path) -> None:
    """Minimal ``KEY=value`` loader. Existing environment variables win."""
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


def _bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _path(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    if not value:
        return default
    p = Path(value)
    return p if p.is_absolute() else (ROOT / p)


@dataclass
class Config:
    host: str = "127.0.0.1"
    port: int = 8000
    env: str = "development"
    owner_email: str = ""
    secret_key: str = ""
    corpus_dir: Path = ROOT / "corpus"
    data_dir: Path = ROOT / "data"
    frontend_dir: Path = ROOT / "frontend"
    secure_cookies: bool = False
    dev_mailbox: bool = True
    dev_mailbox_key: str = ""                    # required to read the development mailbox; generated if unset
    public_base_url: str = ""
    max_upload_bytes: int = 1024 * 1024          # shared corpus TXT upload
    max_attachment_bytes: int = 512 * 1024       # private attachment
    max_attachments: int = 10
    attachment_ttl_hours: int = 24
    session_hours: int = 12
    remember_days: int = 30
    verify_token_hours: int = 24
    reset_token_minutes: int = 30
    invite_hours: int = 72
    register_rate_limit: int = 20               # sign-ups per client address per hour
    quiet: bool = False
    extra: dict = field(default_factory=dict)

    @property
    def is_development(self) -> bool:
        return self.env == "development"

    @property
    def base_url(self) -> str:
        if self.public_base_url:
            return self.public_base_url.rstrip("/")
        host = "localhost" if self.host in {"127.0.0.1", "0.0.0.0", "::"} else self.host
        return f"http://{host}:{self.port}"


def from_env(**overrides) -> Config:
    load_dotenv(ROOT / ".env")
    env = os.environ.get("VIRELIX_ENV", "development").strip().lower()
    secret = os.environ.get("VIRELIX_SECRET_KEY", "")
    if not secret:
        # Ephemeral secret: fine for local development, documented in README.
        secret = secrets.token_hex(32)
    cfg = Config(
        host=os.environ.get("VIRELIX_HOST", "127.0.0.1"),
        port=int(os.environ.get("VIRELIX_PORT", "8000")),
        env=env,
        owner_email=os.environ.get("OWNER_EMAIL", "").strip().lower(),
        secret_key=secret,
        corpus_dir=_path("VIRELIX_CORPUS_DIR", ROOT / "corpus"),
        data_dir=_path("VIRELIX_DATA_DIR", ROOT / "data"),
        secure_cookies=_bool("VIRELIX_SECURE_COOKIES", False),
        dev_mailbox=_bool("VIRELIX_DEV_MAILBOX", env == "development"),
        dev_mailbox_key=os.environ.get("VIRELIX_DEV_MAILBOX_KEY", "").strip(),
        public_base_url=os.environ.get("VIRELIX_PUBLIC_URL", ""),
        quiet=_bool("VIRELIX_QUIET", False),
        register_rate_limit=int(os.environ.get("VIRELIX_REGISTER_RATE_LIMIT", "20")),
    )
    for key, value in overrides.items():
        setattr(cfg, key, value)
    if cfg.env != "development" and "dev_mailbox" not in overrides:
        # The development mailbox exposes token links; never in other environments.
        cfg.dev_mailbox = False
    return cfg
