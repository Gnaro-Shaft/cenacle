#!/bin/sh
# Starts a Cénacle program under launchd (ADR-0018). Usage: run.sh iris
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
*)
  echo "run.sh: unknown program ${1:-}" >&2
  exit 64
  ;;
esac
