#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
install -d -m 755 /usr/local/lib/atomforge
install -m 644 deploy/runner-watchdog.py /usr/local/lib/atomforge/runner-watchdog.py
install -m 644 deploy/atomforge-runner-watchdog.service /etc/systemd/system/
install -m 644 deploy/atomforge-runner-watchdog.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now atomforge-runner-watchdog.timer
systemctl start atomforge-runner-watchdog.service
