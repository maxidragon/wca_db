#!/usr/bin/env bash
# Writes the backend's .env to the path given as the only argument, from the settings in this
# script's environment (the deploy passes one secret or variable each). The service manager
# reads it as the backend's environment, and the import and derived-table scripts source it.
#
# Values are single-quoted: systemd's EnvironmentFile= strips the quotes and a shell reads
# them literally, so both see the same value. Neither copes with a quote, a newline or a
# backslash inside one, so those are refused. JWT_SECRET falls back to a default written in
# the source, which would let anyone sign a login token, so the script fails without it.
# Every other setting may be unset, which keeps the code's default; an unset SERVICE_TOKEN
# leaves the service token disabled, and an unset IMPORT_HEALTHCHECK_URL sends the import no
# pings.
#
# The file is written beside its target with mode 600 and moved into place, so a reader
# never sees half of it.
set -euo pipefail

SETTINGS=(
  PORT FRONTEND_ORIGIN JWT_SECRET SERVICE_TOKEN
  DB_HOST DB_USER DB_PASS DB_NAME QUERY_DB_USER QUERY_DB_PASS
  WCA_CLIENT_ID WCA_CLIENT_SECRET STATISTICS_MEMORY_MB
  IMPORT_HEALTHCHECK_URL
)

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: $0 <path to .env>" >&2
  exit 2
fi
env_file="$1"

if [ -z "${JWT_SECRET:-}" ]; then
  echo "::error::The JWT_SECRET secret is not set"
  exit 1
fi

umask 077
mkdir -p "$(dirname "$env_file")"
tmp_file="$env_file.new"
: > "$tmp_file"
for name in "${SETTINGS[@]}"; do
  value="${!name:-}"
  [ -n "$value" ] || continue
  case "$value" in
    *"'"*|*$'\n'*|*\\*)
      rm -f "$tmp_file"
      echo "::error::The $name setting contains a single quote, a newline or a backslash"
      exit 1
      ;;
  esac
  printf "%s='%s'\n" "$name" "$value" >> "$tmp_file"
done
chmod 600 "$tmp_file"
mv -f "$tmp_file" "$env_file"
echo "wrote $(grep -c '=' "$env_file") settings"
