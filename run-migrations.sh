#!/usr/bin/env bash
# Runs the Pegasus SQL migrations against Supabase, in order, idempotently.
# Password is NOT stored here — you supply the connection string via env var.
#
# 1) In Supabase: Project Settings → Database → Connection string → "URI"
#    Copy it (it already contains host/port/user). Replace [YOUR-PASSWORD].
# 2) Export it, then run this script from inside the deploy folder:
#       export DATABASE_URL='postgresql://postgres.trdwsssouhpawhfdkfqf:[YOUR-PASSWORD]@aws-0-us-east-1.pooler.supabase.com:5432/postgres'
#       bash run-migrations.sh
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL first (copy the URI from Supabase → Project Settings → Database → Connection string).}"
DIR="$(cd "$(dirname "$0")" && pwd)/supabase"
for m in 015_reconcile_deal_rooms_columns 016_deal_room_collaboration 017_showcase_system; do
  echo "──────── Running ${m}.sql ────────"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DIR/${m}.sql"
done
echo "✓ All migrations applied (015 → 016 → 017)."
