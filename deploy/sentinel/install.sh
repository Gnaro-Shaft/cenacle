#!/usr/bin/env bash
# Installs or updates the sentinel on the VPS (phase 5, S2). Run as root ON
# THE VPS, from a copy of apps/sentinel and deploy/sentinel (see README.md).
# Never writes a secret: the environment file is created empty, readable by
# root only, for you to fill in.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" -lt 24 ]; then
  echo "Node 24 or later is required (it runs TypeScript files natively)." >&2
  exit 1
fi
install -d -m 0755 /opt/cenacle-sentinel/src
install -m 0644 "$here"/../../apps/sentinel/src/{main,server,watch}.ts /opt/cenacle-sentinel/src/
install -m 0644 "$here"/../../apps/sentinel/package.json /opt/cenacle-sentinel/
if [ ! -e /etc/cenacle-sentinel.env ]; then
  install -m 0600 /dev/null /etc/cenacle-sentinel.env
  printf '%s\n' "SENTINEL_LISTEN=<tailscale-ip>:8790" "SENTINEL_TOKEN=" \
    "SENTINEL_TELEGRAM_TOKEN=" "SENTINEL_CHAT_ID=" "SENTINEL_SILENCE_MINUTES=10" \
    > /etc/cenacle-sentinel.env
  echo "Fill in /etc/cenacle-sentinel.env, then: systemctl enable --now cenacle-sentinel"
fi
install -m 0644 "$here"/cenacle-sentinel.service /etc/systemd/system/
systemctl daemon-reload
systemctl is-enabled --quiet cenacle-sentinel && systemctl restart cenacle-sentinel || true
echo "Sentinel files in place."
