"""Bootstrap only the local SQLite database from the current ORM schema."""
import asyncio
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "app" / "backend"
sys.path.insert(0, str(BACKEND))
(ROOT / ".local").mkdir(exist_ok=True)
env_file = BACKEND / ".env.local"
if not env_file.exists():
    template = (BACKEND / ".env.example").read_text(encoding="utf-8")
    env_file.write_text(
        template.replace("replace-with-a-random-secret", secrets.token_urlsafe(48)),
        encoding="utf-8",
    )

from dotenv import load_dotenv

load_dotenv(env_file)

from bootstrap_db import initialize_database


asyncio.run(initialize_database())
