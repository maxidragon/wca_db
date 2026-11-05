#!/usr/bin/env bash
# Writes backend/.env from the settings in this script's environment, one repository secret
# each, for the workflows that run the backend on the self-hosted runner. Values are
# single-quoted so dotenv and the scripts that source .env read them literally. JWT_SECRET
# falls back to a default written in the source, which would let anyone sign a login token,
# so the script fails without it. Every other setting may be unset, which keeps the code's
# default; an unset SERVICE_TOKEN leaves the service token disabled.
set -euo pipefail

SETTINGS=(
  PORT FRONTEND_ORIGIN SESSION_SECRET JWT_SECRET SERVICE_TOKEN
  DB_HOST DB_USER DB_PASS DB_NAME QUERY_DB_USER QUERY_DB_PASS
  WCA_CLIENT_ID WCA_CLIENT_SECRET STATISTICS_MEMORY_MB
)

if [ -z "${JWT_SECRET:-}" ]; then
  echo "::error::The JWT_SECRET repository secret is not set"
  exit 1
fi

env_file="$(dirname "${BASH_SOURCE[0]}")/../../backend/.env"
: > "$env_file"
for name in "${SETTINGS[@]}"; do
  value="${!name:-}"
  [ -n "$value" ] || continue
  case "$value" in
    *"'"*|*$'\n'*)
      echo "::error::The $name secret contains a single quote or a newline"
      exit 1
      ;;
  esac
  printf "%s='%s'\n" "$name" "$value" >> "$env_file"
done
