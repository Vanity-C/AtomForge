#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="atomforge-${stamp}.tar.gz"
mkdir -p backups
docker compose --env-file .env.production -f compose.production.yaml exec -T app python - "$archive" <<'PY'
import pathlib, sqlite3, sys, tarfile, tempfile
root=pathlib.Path('/data')
with tempfile.TemporaryDirectory(dir=root) as work:
    snapshot=pathlib.Path(work)/'atomforge.db'
    with sqlite3.connect(root/'atomforge.db') as source, sqlite3.connect(snapshot) as target:
        source.backup(target)
        assert target.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
    target=root/sys.argv[1]
    with tarfile.open(target,'w:gz') as bundle:
        bundle.add(snapshot,arcname='atomforge.db')
        secret=root/'jwt-secret'
        if not secret.is_file(): raise RuntimeError('Missing persisted jwt-secret; back up your configured signing secret separately.')
        bundle.add(secret,arcname='jwt-secret')
    target.chmod(0o600)
PY
docker compose --env-file .env.production -f compose.production.yaml cp "app:/data/$archive" "backups/$archive"
chmod 600 "backups/$archive"
docker compose --env-file .env.production -f compose.production.yaml exec -T app python -c 'import pathlib,sys; (pathlib.Path("/data")/sys.argv[1]).unlink()' "$archive"
printf 'Backup created: backups/%s\n' "$archive"
