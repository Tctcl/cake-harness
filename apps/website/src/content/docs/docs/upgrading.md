---
title: Upgrading
description: Upgrade or roll back Cake with its installer, and understand what state is preserved.
---

Upgrade Cake by re-running its installer. The same path fetches the deployment files, updates `CAKE_VERSION` and the image settings, pulls the selected images, and recreates the stack.

## Production

Install a specific release:

```bash
sudo /opt/cake-harness/install.sh --version 0.2.0
```

Or deliberately resolve and pin the latest release:

```bash
sudo /opt/cake-harness/install.sh --version latest
```

Production images use exact `X.Y.Z` versions after resolution. A later release does not change the running installation until you upgrade it.

## Staging

Update the checkout and re-run the installer:

```bash
cd cake-harness
git pull
sudo bash deploy/install.sh --channel staging
```

Staging follows the moving `staging` tag. `CAKE_VERSION` remains empty because there is no fixed release to compare. Omitting `--channel` also preserves the channel already stored in `.env`.

## What an upgrade preserves

- `/var/lib/cake-harness/.env`, including the database password, `SECRET_KEY`, and `CIPHERGATE_TOKEN`;
- Traefik's certificate state;
- the secrets-store database and keyfile;
- `workspaces/`, `backups/`, and the first-run credentials file if you have not removed it;
- the `cake_postgres-data` named volume;
- the owner account and its password.

Files under `/opt/cake-harness` are deployment code and are replaced. Do not keep local state there.

## Back up before upgrading

Cake does not currently run automated backups or restores. Take a logical Postgres dump before an upgrade:

```bash
docker compose --env-file /var/lib/cake-harness/.env \
  -f /opt/cake-harness/compose.yaml exec -T postgres \
  pg_dump -U cake -d cake > pre-upgrade.sql
```

Back up the secrets-store database and keyfile as well, keeping the keyfile separate from other backup material. Copying a live Postgres data directory is not a safe substitute for `pg_dump`.

## Rollback

For a release with no intervening incompatible schema migration, re-run the installer with the older version:

```bash
sudo /opt/cake-harness/install.sh --version 0.1.0
```

**Do not run an older backend against a newer schema.** Migrations move forward. If the newer release migrated the database, restore the pre-upgrade dump rather than downgrading in place.

Stop the app while restoring, but leave Postgres running:

```bash
docker compose --env-file /var/lib/cake-harness/.env \
  -f /opt/cake-harness/compose.yaml stop app

docker compose --env-file /var/lib/cake-harness/.env \
  -f /opt/cake-harness/compose.yaml exec -T postgres \
  psql -U cake -d cake < pre-upgrade.sql
```

Restoring into a database that already contains objects can fail or mix states. For a full disaster recovery, restore into a freshly initialised database and follow the release's migration notes.

## Release checks are notices, not updates

The backend asks GitHub for the newest release every 15 minutes by default. `UPDATE_CHECK_INTERVAL_MS=0` disables the check. The interface can report that the install is behind, but it does not download or apply the release.

The host's `cake-updater.socket` unit owns `/run/cake/updater.sock`, and the update helper logs to `/var/lib/cake-harness/updater.log`. Applying an update is still an explicit run of `install.sh` on the host.
