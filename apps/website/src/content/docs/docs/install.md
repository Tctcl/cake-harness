---
title: Install Cake
description: Install Cake from a release or follow the staging channel with one installer script.
---

The same script installs and upgrades Cake. A production install resolves and pins a release. A staging install follows the moving image tag built from every push to `main`.

## Production

For the quickest install, replace the example hostname and run:

```bash
curl -fsSL https://github.com/Tctcl/cake-harness/releases/latest/download/install.sh | sudo bash -s -- --domain cake.example.com
```

To inspect the script before running it as root, download it first:

```bash
curl -fsSL https://github.com/Tctcl/cake-harness/releases/latest/download/install.sh -o install.sh
less install.sh
sudo bash install.sh --domain cake.example.com --acme-email you@example.com
```

`--acme-email` defaults to `admin@` followed by your domain. The default version is `latest`, which the installer resolves to a concrete `X.Y.Z` release before writing the image configuration.

## Staging

Staging has no tagged release bundle. Run the installer from a checkout of `main`:

```bash
git clone https://github.com/Tctcl/cake-harness.git
cd cake-harness
sudo bash deploy/install.sh --channel staging --domain staging.example.com --acme-email you@example.com
```

The installer assembles the same flat installation directory from `deploy/` and `infrastructure/` that a release bundle provides. The project's own staging app runs at `https://cake.tctcl.de`; use your own hostname for another install.

Development is not an installation channel. A checkout uses the repository's development commands instead, and `--channel dev` is refused.

## Installer flags

| Flag | Meaning |
| --- | --- |
| `--version X.Y.Z` | Release to install. Defaults to `latest`; `X.Y.Z` and `latest` are accepted. Not valid with `--channel staging`. |
| `--channel production\|staging` | Channel to follow. Defaults to the channel already recorded in `.env`, or `production` for a first install. |
| `--domain HOST` | Bare hostname to serve. Required for a first install. |
| `--acme-email ADDR` | Let's Encrypt contact. Defaults to `admin@HOST` when a domain is supplied. |
| `--admin-user NAME` | Username for the first owner account. Defaults to `admin`; created only once. |
| `--dry-run` | Print the changes without making them. Does not require root. |
| `-h`, `--help` | Print usage. |

Re-running the installer without `--channel` preserves the existing channel. A staging install therefore does not silently switch to production.

## What the installer does

Each step is idempotent:

1. Validate the channel, version, domain, architecture, and privileges.
2. Resolve the release and the product, workspace, and secrets-store images.
3. Install Docker from Docker's apt repository when Compose is unavailable.
4. Put the deployment bundle in `/opt/cake-harness`.
5. Create `/var/lib/cake-harness` and its `traefik`, `workspaces`, and `backups` directories.
6. Create the `cake-updater` group with gid `1001` and the `/run/cake` runtime directory.
7. Write `/var/lib/cake-harness/.env` once, with generated database and encryption secrets. On later runs, update only the channel/version/image settings.
8. Generate the secrets-store keyfile, initialise its database, and create the `cake-backend` reader consumer.
9. Pull the images and start Compose with `--remove-orphans`.
10. Wait up to two minutes for the app's `/health` endpoint, then create the first owner account with a generated password.
11. Install and enable the `cake-updater.socket` systemd unit.
12. Print the installed version, paths, credentials location, and URL.

## First-run credentials

The root-only file `/var/lib/cake-harness/first-run-credentials` contains the initial owner username/password and the secrets-store admin API key:

```bash
sudo cat /var/lib/cake-harness/first-run-credentials
```

Move these values to a password manager and delete the file. Re-running the installer does not reset an existing owner password, rotate the database password, or regenerate encryption keys.

Back up `/var/lib/cake-harness/ciphergate/gateway.key` separately from its database. The keyfile can decrypt every value in the secrets store.

## Finish the network setup

Point the domain's A/AAAA record at the server and allow `80/tcp` and `443/tcp` (plus `22/tcp` if needed). Once Traefik obtains the certificate, open `https://your-domain` and continue with [First steps](/docs/first-steps).
