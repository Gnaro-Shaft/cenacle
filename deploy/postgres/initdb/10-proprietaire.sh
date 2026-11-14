#!/bin/sh
# The database owner, without superuser (ADR-0038, point 5).
#
# The image creates POSTGRES_USER (cenacle_admin) as the superuser, and the
# superuser it must stay. This script, run once by the image on a fresh volume
# (docker-entrypoint-initdb.d) — and by the CI on its service database — makes
# cenacle_owner: it migrates, it creates the test database, it manages the
# programs' roles, and nothing beyond (no file, no system command).
set -eu

: "${POSTGRES_USER:?}" "${POSTGRES_DB:?}"
: "${CENACLE_DB_OWNER_PASSWORD:?set CENACLE_DB_OWNER_PASSWORD in .env.owner}"
case "$CENACLE_DB_OWNER_PASSWORD" in
  *[!A-Za-z0-9_-]*) echo "CENACLE_DB_OWNER_PASSWORD must be 16-128 chars of [A-Za-z0-9_-]" >&2; exit 1 ;;
esac
if [ "${#CENACLE_DB_OWNER_PASSWORD}" -lt 16 ] || [ "${#CENACLE_DB_OWNER_PASSWORD}" -gt 128 ]; then
  echo "CENACLE_DB_OWNER_PASSWORD must be 16-128 chars of [A-Za-z0-9_-]" >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 -X -q --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v pw="$CENACLE_DB_OWNER_PASSWORD" -v db="$POSTGRES_DB" <<'SQL'
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cenacle_owner') AS missing \gset
\if :missing
  CREATE ROLE cenacle_owner LOGIN NOSUPERUSER CREATEROLE CREATEDB NOREPLICATION NOBYPASSRLS
    PASSWORD :'pw';
\endif
ALTER DATABASE :"db" OWNER TO cenacle_owner;
GRANT pg_signal_backend TO cenacle_owner;
SQL
echo "cenacle_owner ready, without superuser."
