#!/bin/sh
# Starts a Cénacle program under launchd (ADR-0018, ADR-0019). Usage: run.sh iris|server|bot|web|cto|veille
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
case "${1:-}" in
iris)
  # Same files as `npm run iris` (package.json): checked by a test.
  exec node --env-file=.env --env-file-if-exists=.env.mail --env-file-if-exists=.env.telegram --env-file-if-exists=.env.sentinel apps/iris/src/main.ts
  ;;
server)
  # Same files as `npm run server`.
  exec node --env-file=.env --env-file-if-exists=.env.mail --env-file-if-exists=.env.page apps/server/src/main.ts
  ;;
bot)
  # Same files as `npm run bot`.
  exec node --env-file=.env --env-file-if-exists=.env.telegram apps/telegram/src/main.ts
  ;;
cto)
  # Same files as `npm run cto:serve`: no secret (ADR-0017).
  exec node --env-file=.env apps/cto/src/main.ts
  ;;
veille)
  # Same files as `npm run veille`: the Telegram token only (ADR-0024).
  exec node --env-file=.env --env-file-if-exists=.env.telegram apps/veille/src/main.ts
  ;;
web)
  # Same as `npm run web` (the "dev" script of apps/web: vite), without npm in between.
  cd apps/web
  exec ../../node_modules/.bin/vite
  ;;
*)
  echo "run.sh: unknown program ${1:-}" >&2
  exit 64
  ;;
esac
