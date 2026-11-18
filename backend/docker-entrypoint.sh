#!/bin/sh
# Applies pending migrations and (idempotently) seeds verses, then starts the API.
# Set SKIP_DB_SETUP=true on extra replicas so only one instance runs migrations.
set -e
if [ "${SKIP_DB_SETUP:-false}" != "true" ]; then
  npx prisma migrate deploy
  npx prisma db seed
fi
exec node dist/main.js
