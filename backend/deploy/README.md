# Deploy Agrivet Ledger on Kali

`ci-cd.yml` runs Laravel and React checks on GitHub for pushes and pull requests targeting `main`. A passing push to the canonical repository deploys on the Linux x64 runner labeled `agrivet-deploy`. The app images and both health responses identify the exact commit.

## VM and GitHub

Install the repository's Actions runner from **Settings → Actions → Runners** on Kali. Use a dedicated Agrivet runner directory and the label `agrivet-deploy`. The runner account needs Docker access and the same deployment settings directory used by the manual deployment. Require approval for all external contributors' fork workflows. Create a `production` environment restricted to `main`, and protect `main` with the `test` check and no force pushes.

Copy `server.env.example` to `~/.config/argivet-ledger/server.env`. Use mode `600` and set the VMware address, a unique PostgreSQL password, and a Laravel application key. Keep this file outside the Git checkout. Reserve the VM address so Windows can reconnect to the same origin and sync its saved sales.

From a checkout of the approved commit, run:

```sh
bash backend/deploy/deploy.sh "$(git rev-parse HEAD)"
```

The deploy script builds before replacing the running app, applies Laravel migrations, seeds reference data, and checks the version reported by both Laravel instances and the loan gateway. PostgreSQL runs on the private Compose network. The stack also runs one Laravel scheduler and shares persistent private storage between the two API containers.

## Endpoints

- Windows POS server connection is `http://192.168.95.128:8081` on the private VMware network. The cashier installer supports private IPv4 HTTP and keeps offline cash sales in local SQLite.
- The loan frontend listens on Kali at `http://127.0.0.1:8082`. Its public gateway allows the loan, membership and required account endpoints. It rejects POS, inventory and sync requests.
- The health URLs are `/api/v1/health` on each endpoint. The JSON includes the deployed commit.

To start the demo tunnel:

```sh
export APP_VERSION="$(cat ~/.config/argivet-ledger/current-release)"
docker compose --env-file ~/.config/argivet-ledger/server.env -f backend/deploy/compose.yaml --profile quick-tunnel up -d --no-build tunnel
docker compose --env-file ~/.config/argivet-ledger/server.env -f backend/deploy/compose.yaml logs tunnel
```

The Quick Tunnel URL is temporary and can change after a restart. It uses polling for notifications. Set a stable HTTPS origin and SMTP before enabling password recovery in production.

## Rollback

Keep the previous application images until the release is accepted. For a compatible schema, run `bash backend/deploy/deploy.sh <previous-sha> rollback` from the current checkout. This restores the prior application images without rewinding the database. In Git, revert the offending change to keep the next automated deploy consistent. Test both health endpoints on each release and verify a failing pull request never schedules deployment.
