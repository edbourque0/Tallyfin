#!/bin/sh
set -e

# Wait for the database to accept connections (Postgres may still be starting).
tries=0
until python manage.py check --database default >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "Database is not reachable after ${tries} attempts, giving up."
    exit 1
  fi
  echo "Waiting for database... (${tries})"
  sleep 2
done

if [ "${RUN_MIGRATIONS:-1}" != "0" ]; then
  python manage.py migrate --noinput
  python manage.py bootstrap_admin
fi

exec "$@"
