# Deploy

Every push to `main` runs `.github/workflows/deploy.yml` on the self-hosted runner. It builds the backend and the frontend in the runner's workspace, then `.github/scripts/publish_release.sh` copies both builds into a release outside it and switches the live site over with a single rename:

```
$DEPLOY_ROOT/releases/<time>-<sha>-<id>/frontend   served by nginx
$DEPLOY_ROOT/releases/<time>-<sha>-<id>/backend    run by pm2 (dist, node_modules, .env)
$DEPLOY_ROOT/current -> releases/<time>-<sha>-<id>
```

`DEPLOY_ROOT` is the `DEPLOY_ROOT` repository variable, or `~/wca-db` of the runner's user when it is unset.

Nothing is served from the workspace, because `actions/checkout` deletes every untracked file at the start of a run, builds included. Serving from it took the site down for the length of the build: nginx answered 500 with no `index.html` to fall back to, and the running backend lost its `node_modules`. Now the previous release keeps serving until the new one is complete.

A release's frontend also holds the previous release's own hashed assets (listed in `.carried-assets`), so a tab opened before the deploy can still load a lazy chunk, such as the competitions map, that it has not fetched yet. Only one release back is carried. The five newest releases are kept; the live one is never removed.

`.github/scripts/restart_backend.sh` restarts `wca-db-backend` from `current/backend`, so a restart picks up whatever release `current` points at. A process registered from any other path is replaced and the pm2 list saved, so a reboot resurrects the release. The nightly import restarts the same way, so it reloads the data but keeps the release, `.env` included: a changed secret takes effect at the next deploy (run the workflow by hand if it cannot wait).

The import, the `--if-missing` steps and the tests still run from the workspace, which holds the same build.

## nginx

nginx must serve `current`, not the workspace. The one-time change, with the runner user's home:

```nginx
root /home/<runner-user>/wca-db/current/frontend;

location = /index.html {
    add_header Cache-Control "no-cache";
}

location /assets/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    try_files $uri =404;
}

location / {
    try_files $uri /index.html;
}
```

`index.html` is revalidated on every load, so a deploy reaches the next page load. Assets are content-hashed and cached for good, and a missing one is a 404 rather than `index.html` served as JavaScript. If `open_file_cache` is on, nginx can keep serving the old release's files for up to `open_file_cache_valid` after a switch. nginx's user needs to be able to traverse the runner user's home, as it already does for the workspace.
