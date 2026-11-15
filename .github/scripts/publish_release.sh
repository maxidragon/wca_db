#!/usr/bin/env bash
# Publishes the frontend and backend built in this checkout as a new release and switches the
# live site to it in one step.
#
# The runner's workspace is wiped by actions/checkout at the start of every run, so nothing
# may serve from it: nginx would answer 500 for the minutes the build takes, and the backend
# would lose its node_modules while still running. Each release is a full copy instead:
#
#   $DEPLOY_ROOT/releases/<time>-<sha>-<id>/frontend   what nginx serves
#   $DEPLOY_ROOT/releases/<time>-<sha>-<id>/backend    what pm2 runs (dist, node_modules, .env)
#   $DEPLOY_ROOT/current -> releases/<time>-<sha>-<id>
#
# `current` is replaced by a rename, so a request sees either the old release or the new one,
# never a half-written directory. The frontend also keeps the previous release's own hashed
# assets, so a tab still running the old bundle can load a lazy chunk it has not fetched yet.
# Only one release back: anything older was replaced at least one deploy ago.
#
# Usage: publish_release.sh   (run from the repository root, after both builds)
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-$HOME/wca-db}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
CARRIED_LIST=".carried-assets"

for built in frontend/dist/index.html backend/dist/index.js backend/node_modules backend/.env; do
  if [ ! -e "$built" ]; then
    echo "::error::$built is missing; build the frontend and backend and write .env first"
    exit 1
  fi
done

releases="$DEPLOY_ROOT/releases"
current="$DEPLOY_ROOT/current"
mkdir -p "$releases"
staging="$(mktemp -d "$releases/.staging-XXXXXX")"
trap 'rm -rf "$staging"' EXIT
chmod 755 "$staging"  # mktemp makes it 0700, which nginx's user could not read
# Sorts by time; the staging suffix keeps a rerun of the same commit in the same second apart.
name="$(date -u +%Y%m%d%H%M%S)-$(git rev-parse --short HEAD)-${staging##*-}"
release="$releases/$name"

cp -a frontend/dist "$staging/frontend"
mkdir "$staging/backend"
cp -a backend/dist backend/node_modules backend/package.json backend/.env "$staging/backend/"

# Carry the previous release's own assets, not the ones it carried itself.
previous_assets="$current/frontend/assets"
if [ -d "$previous_assets" ]; then
  carried_before="$current/frontend/$CARRIED_LIST"
  : > "$staging/frontend/$CARRIED_LIST"
  mkdir -p "$staging/frontend/assets"
  for file in "$previous_assets"/*; do
    [ -f "$file" ] || continue
    base="$(basename "$file")"
    if [ -f "$carried_before" ] && grep -qxF "$base" "$carried_before"; then
      continue
    fi
    if [ ! -e "$staging/frontend/assets/$base" ]; then
      cp -p "$file" "$staging/frontend/assets/$base"
      echo "$base" >> "$staging/frontend/$CARRIED_LIST"
    fi
  done
fi

mv -T "$staging" "$release"
trap - EXIT

# Rename a fresh symlink over the old one: atomic, unlike `ln -sfn`, which unlinks first.
ln -sfn "releases/$name" "$DEPLOY_ROOT/.current-next"
mv -T "$DEPLOY_ROOT/.current-next" "$current"
echo "Published $name to $current"

# Keep the newest releases; never remove the live one.
live="$(readlink "$current")"
ls -1 "$releases" | grep -v '^\.' | sort -r | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
  [ "releases/$old" = "$live" ] && continue
  rm -rf "${releases:?}/$old"
  echo "Removed old release $old"
done
