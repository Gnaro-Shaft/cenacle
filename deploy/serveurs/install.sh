#!/bin/bash
# Installs Cénacle's actions on this server (J6f, ADR-0027). Run as root, ON
# THE SERVER, from a copy of deploy/serveurs (see README.md). Idempotent.
# Creates the `cenacle` account (no password, never root), installs the
# scripts root-owned, and allows sudo for those scripts alone, without
# arguments — checked by visudo before it takes effect. Writes no key: you
# add the Mac's key lines to ~cenacle/.ssh/authorized_keys yourself.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [ "$(id -u)" != "0" ]; then echo "Run as root." >&2; exit 1; fi
command -v needrestart >/dev/null || { echo "needrestart is required (apt install needrestart)." >&2; exit 1; }

if ! id cenacle >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/sh --comment "Cenacle actions (ADR-0027)" cenacle
fi
passwd -l cenacle >/dev/null
install -d -m 0700 -o cenacle -g cenacle ~cenacle/.ssh
[ -e ~cenacle/.ssh/authorized_keys ] || install -m 0600 -o cenacle -g cenacle /dev/null ~cenacle/.ssh/authorized_keys

for script in cenacle-services cenacle-redemarrer cenacle-maj-securite; do
  install -m 0755 -o root -g root "$here/$script" "/usr/local/sbin/$script"
done

install -d -m 0755 /etc/cenacle
if [ ! -e /etc/cenacle/services-exclus ]; then
  printf '%s\n' "# Services never restarted by cenacle-services, one per line (name.service)," \
    "# on top of: ssh, sshd, tailscaled, docker, containerd, corosync, pve-cluster." \
    > /etc/cenacle/services-exclus
  chmod 0644 /etc/cenacle/services-exclus
fi

# sudo for the scripts alone, with no argument (the empty "" forbids any).
rule="$(mktemp)"
printf '%s\n' \
  'cenacle ALL=(root) NOPASSWD: /usr/local/sbin/cenacle-services ""' \
  'cenacle ALL=(root) NOPASSWD: /usr/local/sbin/cenacle-redemarrer ""' \
  'cenacle ALL=(root) NOPASSWD: /usr/local/sbin/cenacle-maj-securite ""' > "$rule"
visudo -cf "$rule" >/dev/null
install -m 0440 -o root -g root "$rule" /etc/sudoers.d/cenacle
rm -f "$rule"
visudo -c >/dev/null

echo "Installed. Now add the Mac's key to ~cenacle/.ssh/authorized_keys (README.md)."
