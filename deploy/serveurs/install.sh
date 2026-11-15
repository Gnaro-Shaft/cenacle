#!/bin/bash
# Installs Cénacle's actions and bulletin on this server (J6f, ADR-0027,
# ADR-0039, ADR-0040). Run as root, ON THE SERVER, from a copy of
# deploy/serveurs (see README.md). Idempotent.
# Creates the `cenacle` account (no password, never root), installs the
# scripts root-owned, and allows sudo for those scripts alone, without
# arguments, plus two list-only commands for the bulletin — checked by visudo
# before it takes effect, then checked again command by command. Writes no
# key: you add the Mac's key lines to ~cenacle/.ssh/authorized_keys yourself.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [ "$(id -u)" != "0" ]; then echo "Run as root." >&2; exit 1; fi
fail() { echo "FAILED: $*" >&2; exit 1; }

# needrestart's guard FIRST (ADR-0040, after Legion's 24/09/2026): its apt
# hook restarts, by default, every service on a replaced library. "l" lists
# only, and never restarts. Named zz- so that it is read last among the
# conf.d files and wins. Posted even before needrestart is there: the day it
# arrives, by a dependency or a release upgrade, the guard is already set.
install -d -m 0755 /etc/needrestart/conf.d
guard="$(mktemp)"
printf '%s\n' \
  "# Cénacle (ADR-0040): needrestart lists, never restarts on its own." \
  "# The original is in Cénacle's repository, deploy/serveurs/install.sh." \
  "\$nrconf{restart} = 'l';" \
  "\$nrconf{kernelhints} = -1;" > "$guard"
install -m 0644 -o root -g root "$guard" /etc/needrestart/conf.d/zz-cenacle.conf
rm -f "$guard"
[ -x /usr/sbin/needrestart ] ||
  fail "needrestart is required. Its guard is now in place: apt install needrestart, then run this again."

if ! id cenacle >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/sh --comment "Cenacle actions (ADR-0027)" cenacle
fi
passwd -l cenacle >/dev/null
install -d -m 0700 -o cenacle -g cenacle ~cenacle/.ssh
[ -e ~cenacle/.ssh/authorized_keys ] || install -m 0600 -o cenacle -g cenacle /dev/null ~cenacle/.ssh/authorized_keys

for script in cenacle-services cenacle-redemarrer cenacle-maj-securite; do
  install -m 0755 -o root -g root "$here/$script" "/usr/local/sbin/$script"
done
# The bulletin (ADR-0039, ADR-0040): read-only — the account runs it itself,
# and it goes through sudo only for the two list-only commands below.
install -m 0755 -o root -g root "$here/cenacle-bulletin" /usr/local/bin/cenacle-bulletin

install -d -m 0755 /etc/cenacle
if [ ! -e /etc/cenacle/services-exclus ]; then
  printf '%s\n' "# Services never restarted by cenacle-services, one per line (name.service)," \
    "# on top of the defaults (cenacle-services: the way in, the containers, the cluster" \
    "# and its high availability, and what needrestart itself spares)." \
    > /etc/cenacle/services-exclus
  chmod 0644 /etc/cenacle/services-exclus
fi

# sudo for the scripts alone, with no argument (the empty "" forbids any);
# for the bulletin, two commands frozen with their arguments: needrestart in
# list mode, and pvecm status on a cluster node only.
rules=(
  'cenacle ALL=(root) NOPASSWD: /usr/local/sbin/cenacle-services ""'
  'cenacle ALL=(root) NOPASSWD: /usr/local/sbin/cenacle-redemarrer ""'
  'cenacle ALL=(root) NOPASSWD: /usr/local/sbin/cenacle-maj-securite ""'
  'cenacle ALL=(root) NOPASSWD: /usr/sbin/needrestart -r l -b'
)
node=0
if [ -x /usr/bin/pvecm ]; then
  node=1
  rules+=('cenacle ALL=(root) NOPASSWD: /usr/bin/pvecm status')
fi
rule="$(mktemp)"
printf '%s\n' "${rules[@]}" > "$rule"
visudo -cf "$rule" >/dev/null
install -m 0440 -o root -g root "$rule" /etc/sudoers.d/cenacle
rm -f "$rule"
visudo -c >/dev/null

# The rules hold as frozen: each permitted form passes, any other is refused
# (here, or by a rule elsewhere that grants the account more). `sudo -l -U`
# asks without running anything. On any doubt, Cénacle's rules are taken out
# whole: nothing is allowed until it is fixed.
allowed() { sudo -n -l -U cenacle -- "$@" >/dev/null 2>&1; }
withdraw() {
  rm -f /etc/sudoers.d/cenacle
  fail "$* — Cénacle's rules (/etc/sudoers.d/cenacle) removed until this is fixed; look for another rule that grants the account more (sudo -l -U cenacle)."
}
allowed /usr/sbin/needrestart -r l -b || withdraw "the needrestart rule does not hold"
for refused in "/usr/sbin/needrestart" "/usr/sbin/needrestart -r a -b" "/usr/sbin/needrestart -r l" \
  "/usr/local/sbin/cenacle-services x" "/usr/bin/id"; do
  # shellcheck disable=SC2086 # split on purpose: a command and its arguments
  if allowed $refused; then withdraw "sudo allows more than it should: $refused"; fi
done
if [ "$node" = 1 ]; then
  allowed /usr/bin/pvecm status || withdraw "the pvecm rule does not hold"
  for refused in "/usr/bin/pvecm" "/usr/bin/pvecm add x" "/usr/bin/pvecm status x"; do
    # shellcheck disable=SC2086
    if allowed $refused; then withdraw "sudo allows more than it should: $refused"; fi
  done
fi

echo "Installed. Now add the Mac's key to ~cenacle/.ssh/authorized_keys (README.md)."
