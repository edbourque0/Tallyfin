#!/bin/sh
set -e

# Wait for the database to accept connections; prints the real error on each failed attempt.
python manage.py wait_for_db --timeout "${DB_WAIT_TIMEOUT:-120}"

if [ "${RUN_MIGRATIONS:-1}" != "0" ]; then
  python manage.py migrate --noinput
  python manage.py bootstrap_admin
fi

exec "$@"
