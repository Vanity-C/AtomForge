#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for file in .env.docker .env.production; do
    if [[ ! -f "$file" ]]; then printf 'Missing %s; copy its .example file and configure it first.\n' "$file" >&2; exit 1; fi
done
chmod 600 .env.docker .env.production
# Quiet validation avoids printing the resolved model key to the terminal.
docker compose --env-file .env.production -f compose.production.yaml config --quiet
if [[ "${ATOMFORGE_SKIP_BUILD:-0}" == "1" ]]; then
    docker compose --env-file .env.production -f compose.production.yaml up -d --no-build --wait
else
    docker compose --env-file .env.production -f compose.production.yaml up -d --build --wait
fi
docker compose --env-file .env.production -f compose.production.yaml ps
