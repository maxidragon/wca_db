#!/usr/bin/env bash
# Restarts the backend under pm2 from the live release ($DEPLOY_ROOT/current/backend, see
# publish_release.sh), so it never runs out of the runner's workspace, which every checkout
# wipes. A process registered from any other path (the workspace, before releases existed) is
# replaced and the pm2 process list saved, so a reboot resurrects the release too.
#
# Before the first release is published, it restarts the backend in this checkout as before.
#
# Usage: restart_backend.sh   (run from the repository root)
set -euo pipefail

DEPLOY_ROOT="${DEPLOY_ROOT:-$HOME/wca-db}"
NAME="wca-db-backend"
dir="$DEPLOY_ROOT/current/backend"

if [ ! -d "$dir" ]; then
  echo "No release in $DEPLOY_ROOT yet; restarting from the checkout."
  cd backend
  pm2 restart "$NAME" -s || pm2 start dist/index.js --name "$NAME" -s
  exit 0
fi

registered="$(pm2 jlist 2>/dev/null | node -e '
  let input = "";
  process.stdin.on("data", (chunk) => (input += chunk)).on("end", () => {
    try {
      const app = JSON.parse(input).find((p) => p.name === process.argv[1]);
      if (app) console.log(`${app.pm2_env.pm_cwd}\n${app.pm2_env.pm_exec_path}`);
    } catch {}
  });
' "$NAME" || true)"

if [ "$registered" = "$dir"$'\n'"$dir/dist/index.js" ]; then
  pm2 restart "$NAME" -s
else
  pm2 delete "$NAME" -s 2>/dev/null || true
  pm2 start "$dir/dist/index.js" --name "$NAME" --cwd "$dir" -s
  pm2 save -s
fi
