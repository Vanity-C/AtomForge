"""Prepare persistent state, then replace this process with one Uvicorn worker."""
import asyncio
import os
from pathlib import Path
import secrets
import sys

from bootstrap_db import initialize_database


def main():
    backend = Path(__file__).resolve().parents[1] / "backend"
    os.chdir(backend)
    sys.path.insert(0, str(backend))
    data = Path(os.environ.get("ATOMFORGE_DATA_DIR", "/data"))
    data.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{data / 'atomforge.db'}")
    if not os.environ.get("ATOMFORGE_JWT_SECRET", "").strip():
        secret_path = data / "jwt-secret"
        if not secret_path.exists():
            with secret_path.open("x", encoding="utf-8") as output:
                output.write(secrets.token_urlsafe(48))
            secret_path.chmod(0o600)
        secret = secret_path.read_text(encoding="utf-8").strip()
        if not secret:
            raise RuntimeError("Persistent JWT secret is empty; restore /data/jwt-secret.")
        os.environ["ATOMFORGE_JWT_SECRET"] = secret
    if not os.environ.get("APP_AI_KEY", "").strip():
        print("APP_AI_KEY is not configured; set it in .env.docker to enable AI generation.")
    asyncio.run(initialize_database())
    # Jobs and quotas are process-local; keep exactly one worker.
    os.execv(sys.executable, [
        sys.executable, "-m", "uvicorn", "main:app",
        "--host", "0.0.0.0", "--port", "8000", "--workers", "1",
    ])


if __name__ == "__main__":
    main()
