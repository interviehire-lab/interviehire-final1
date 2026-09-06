#!/usr/bin/env bash
#
# Wipes the local Postgres database and re-seeds it from scratch using this
# repo's existing seed scripts (backend/seed.py + interview-engine's
# `npm run seed`). Destructive — drops every table both services own,
# including anything you've created locally through the app.
#
# Usage:
#   scripts/seed-database.sh          # asks for confirmation first
#   scripts/seed-database.sh --yes    # skips the confirmation prompt

set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/services.sh"

require_command docker
require_command npx
docker info >/dev/null 2>&1 || fail "Docker is not running (local Postgres uses Docker)."

load_env_file "$REPO_ROOT/backend/.env"
load_env_file "$REPO_ROOT/interview-engine/.env"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-interviehire-local}"
export POSTGRES_PORT="${POSTGRES_PORT:-5433}"
export DATABASE_URL="${LOCAL_DATABASE_URL:-postgresql://postgres:postgres@127.0.0.1:$POSTGRES_PORT/interviehire}"

if [ "${1:-}" != "--yes" ]; then
  warn "This will DROP every table in the local 'interviehire' database (port $POSTGRES_PORT) and re-seed it from scratch."
  read -r -p "Type 'reset' to continue: " confirmation
  [ "$confirmation" = "reset" ] || fail "Aborted — database was not touched."
fi

info "Starting local Postgres..."
compose up -d --wait postgres

info "Dropping and recreating the public schema..."
compose exec -T postgres psql -U postgres -d interviehire -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;' >/dev/null

info "Applying interview-engine (Prisma) migrations..."
(cd "$REPO_ROOT/interview-engine" && npx prisma migrate deploy --schema apps/api/prisma/schema.prisma)

if [ ! -x "$REPO_ROOT/backend/.venv/bin/python" ]; then
  fail "Backend virtualenv not found at backend/.venv — run scripts/setup-local.sh first."
fi

info "Creating backend tables (init_db)..."
(cd "$REPO_ROOT/backend" && DATABASE_URL="$DATABASE_URL" "$REPO_ROOT/backend/.venv/bin/python" -c "from main import init_db; init_db()")

info "Seeding backend data (organisations, users, admin)..."
(cd "$REPO_ROOT/backend" && DATABASE_URL="$DATABASE_URL" "$REPO_ROOT/backend/.venv/bin/python" seed.py)

info "Seeding interview-engine demo data (company, role, questions, candidate)..."
(cd "$REPO_ROOT/interview-engine" && DATABASE_URL="$DATABASE_URL" npm run seed -w apps/api)

success "Database reset and seeded."
info "Sign in with admin@interviehire.com / adminpassword (super admin) or superadmin@interviehire.com / superadminpass."
