#!/bin/bash
# Installs, ON THE BACKUP NODE ONLY, what receives the nightly copy of
# Cénacle's base (ADR-0044, points 4 and 5). Run as root, from a copy of
# deploy/serveurs (README.md). Idempotent.
# Creates the account cenacle-depot (no password, no group but its own, no
# sudo), the store under /var/backups/cenacle-copie — the arrival, its
# account's; the examination, the copies kept and the quarantine, root's —
# and the hourly timer veiller-copie-cenacle. Writes no key: you add the Mac's
# push key line yourself (README.md). The account's home and authorized_keys
# are root's: the key cannot change its own lock.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
if [ "$(id -u)" != "0" ]; then echo "Run as root." >&2; exit 1; fi
fail() { echo "FAILED: $*" >&2; exit 1; }

COMPTE=cenacle-depot
RACINE=/var/backups/cenacle-copie
ETAT=/var/lib/copie-cenacle

# rrsync and its -no-del / -no-overwrite exist from rsync 3.2.4; it is python3.
[ -x /usr/bin/rrsync ] || fail "/usr/bin/rrsync is missing: rsync 3.2.4 or later is required (apt install rsync)"
command -v python3 >/dev/null || fail "python3 is required by rrsync (apt install python3)"
# sed reads it all: `head -1` would cut rsync's pipe, and pipefail stop here silently.
version="$(rsync --version 2>/dev/null | sed -n 1p)"
[[ "$version" =~ version\ ([0-9]+)\.([0-9]+)\.([0-9]+) ]] || fail "rsync's version is unreadable"
[ $((BASH_REMATCH[1] * 10000 + BASH_REMATCH[2] * 100 + BASH_REMATCH[3])) -ge 30204 ] ||
  fail "rsync 3.2.4 or later is required (found: ${BASH_REMATCH[0]})"
# The options the key's line uses, asked of rrsync itself rather than inferred.
help="$(/usr/bin/rrsync -h 2>&1 || true)"
for option in -wo -no-del -no-overwrite; do
  grep -qe "^ *$option" <<<"$help" || fail "this rrsync has no $option option: a newer rsync is required"
done
for tool in flock cmp find stat timeout runuser readlink; do
  command -v "$tool" >/dev/null || fail "$tool is required"
done

if ! id "$COMPTE" >/dev/null 2>&1; then
  # A shell, because sshd runs the forced command through it; rrsync is all it runs.
  useradd --system --no-create-home --home-dir "/home/$COMPTE" --shell /bin/sh \
    --comment "Cenacle, copies of the base (ADR-0044)" "$COMPTE"
fi
passwd -l "$COMPTE" >/dev/null
[ "$(id -Gn "$COMPTE")" = "$COMPTE" ] ||
  fail "$COMPTE belongs to another group ($(id -Gn "$COMPTE")): take it out, then run this again"
if command -v sudo >/dev/null && sudo -n -l -U "$COMPTE" 2>/dev/null | grep -q '(.*)'; then
  fail "$COMPTE is allowed something by sudo (sudo -l -U $COMPTE): take it out, then run this again"
fi
home="$(getent passwd "$COMPTE" | cut -d: -f6)"
[ "$home" = "/home/$COMPTE" ] || fail "$COMPTE's home is not /home/$COMPTE"
for d in "$home" "$home/.ssh"; do
  [ -L "$d" ] && fail "$d is a link"
  install -d -m 0755 -o root -g root "$d"
done
keys="$home/.ssh/authorized_keys"
[ -L "$keys" ] && fail "$keys is a link"
[ -e "$keys" ] || install -m 0644 -o root -g root /dev/null "$keys"
chown root:root "$keys"
chmod 0644 "$keys"

# The store. Its root may be a link you made (to a volume of its own: a stolen
# key then fills that volume only); the four folders under it may not.
install -d -m 0711 -o root -g root "$RACINE"
for d in arrivee examen gardees refusees; do
  [ -L "$RACINE/$d" ] && fail "$RACINE/$d is a link"
done
install -d -m 0700 -o "$COMPTE" -g "$COMPTE" "$RACINE/arrivee"
for d in examen gardees refusees; do
  install -d -m 0700 -o root -g root "$RACINE/$d"
done
# The key's rrsync opens the arrival as the account: every folder on the way
# must let it through, and a backup volume is often root's alone. Asked of the
# account itself; on refusal, the first folder that stops it is named.
arrivee="$RACINE/arrivee"
if ! runuser -u "$COMPTE" -- test -r "$arrivee" -a -w "$arrivee" -a -x "$arrivee"; then
  for chemin in "$(dirname "$RACINE")" "$(readlink -f "$RACINE")"; do
    sous=""
    IFS=/ read -ra noms <<<"${chemin#/}"
    for nom in "${noms[@]}"; do
      sous="$sous/$nom"
      runuser -u "$COMPTE" -- test -x "$sous" ||
        fail "$COMPTE cannot pass through $sous, on the way to its arrival: let it through and nothing more (setfacl -m u:$COMPTE:--x $sous, package acl), then run this again"
    done
  done
  fail "$COMPTE cannot write in its arrival ($arrivee)"
fi
disque="$(stat -c %d "$RACINE/arrivee")"
for d in examen gardees refusees; do
  [ "$(stat -c %d "$RACINE/$d")" = "$disque" ] ||
    fail "$RACINE/$d is on another disk than the arrival: a move would copy"
done
[ -L "$ETAT" ] && fail "$ETAT is a link"
install -d -m 0755 -o root -g root "$ETAT"

install -m 0755 -o root -g root "$here/veiller-copie-cenacle" /usr/local/sbin/veiller-copie-cenacle
for unit in veiller-copie-cenacle.service veiller-copie-cenacle.timer; do
  install -m 0644 -o root -g root "$here/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now veiller-copie-cenacle.timer

# sshd may let only some accounts in: then the key would be refused.
if command -v sshd >/dev/null &&
  conf="$(sshd -T -C "user=$COMPTE,host=localhost,addr=127.0.0.1" 2>/dev/null)" &&
  printf '%s\n' "$conf" | grep -qiE '^(allowusers|allowgroups|denyusers|denygroups) '; then
  echo "WARNING: sshd lets in or keeps out some accounts (AllowUsers, AllowGroups, DenyUsers, DenyGroups): check that $COMPTE may come in."
fi

# A first pass, by the unit itself: it proves its box lets it work. Before
# the first copy, its verdict is MALADE, « aucune copie gardée » — expected.
systemctl start veiller-copie-cenacle.service ||
  echo "(The unit fails while its verdict is MALADE: before the first copy, expected.)"
cat "$ETAT/verdict" 2>/dev/null || echo "WARNING: no verdict yet: journalctl -u veiller-copie-cenacle"

echo "Installed. Now add the Mac's push key to $keys, one line (README.md):"
echo "restrict,from=\"<adresse Tailscale du Mac>\",command=\"/usr/bin/rrsync -wo -no-del -no-overwrite $RACINE/arrivee\" ssh-ed25519 AAAA… cenacle-copie"
