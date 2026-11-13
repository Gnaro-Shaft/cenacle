#!/bin/sh
# Starts a Cénacle program under launchd (ADR-0018, ADR-0019). Usage: run.sh iris|server|bot|cto|veille|securite|operateur|prospection
# The repository is found from this file's place: no personal path is written
# anywhere in the repository. CENACLE_LOG (set by the installer) is the console
# log: emptied at start beyond 1 MB, so it never grows without bound.
set -eu
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
if [ -n "${CENACLE_LOG:-}" ] && [ -f "$CENACLE_LOG" ] &&
  [ "$(wc -c <"$CENACLE_LOG")" -gt 1048576 ]; then
  : >"$CENACLE_LOG"
fi
# Dated lines and one-line crashes in the log (lot C, 13/11): loaded before
# each program, vite included. Not set by npm: a program run by hand prints as before.
NODE_OPTIONS="--import=\"$ROOT/packages/core/src/console-stamp-install.ts\" ${NODE_OPTIONS:-}"
export NODE_OPTIONS
case "${1:-}" in
iris)
  # Same files as `npm run iris` (package.json): checked by a test.
  exec node --env-file=.env --env-file-if-exists=.env.mail --env-file-if-exists=.env.telegram --env-file-if-exists=.env.sentinel apps/iris/src/main.ts
  ;;
server)
  # The page is built first, from these very sources, and served by the
  # server itself (ADR-0037): never two versions. A failed build stops here.
  ./node_modules/.bin/vite build apps/web --logLevel warn
  # Never the dev mode under launchd, whatever a .env says: --env-file does
  # not override a variable already set.
  export CENACLE_WEB_DEV=0
  # Same files as `npm run server`.
  exec node --env-file=.env --env-file-if-exists=.env.mail --env-file-if-exists=.env.page apps/server/src/main.ts
  ;;
bot)
  # Same files as `npm run bot`: its token, and its own signing key (ADR-0036).
  exec node --env-file=.env --env-file-if-exists=.env.telegram --env-file-if-exists=.env.bot apps/telegram/src/main.ts
  ;;
cto)
  # Same files as `npm run cto:serve`: no secret (ADR-0017).
  exec node --env-file=.env apps/cto/src/main.ts
  ;;
veille)
  # Same files as `npm run veille`: the Telegram token only (ADR-0024).
  exec node --env-file=.env --env-file-if-exists=.env.telegram apps/veille/src/main.ts
  ;;
operateur)
  # The only holder of the servers' keys (ADR-0027): the Telegram token, no other secret.
  exec node --env-file=.env --env-file-if-exists=.env.telegram apps/operateur/src/main.ts
  ;;
securite)
  # Same files as `npm run securite`: the Telegram token only (ADR-0025).
  exec node --env-file=.env --env-file-if-exists=.env.telegram --env-file-if-exists=.env.sentinel apps/securite/src/main.ts
  ;;
prospection)
  # Same files as `npm run prospection`: the mailbox, read-only, and Telegram (ADR-0032).
  exec node --env-file=.env --env-file-if-exists=.env.mail --env-file-if-exists=.env.telegram apps/prospection/src/main.ts
  ;;
*)
  echo "run.sh: unknown program ${1:-}" >&2
  exit 64
  ;;
esac
