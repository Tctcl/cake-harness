# Deployment

How one self-hosted instance is installed, upgraded and backed up, and what this
repository does and does not do about it yet.

Status: **the platform layer only.** `deploy/compose.yaml` defines Traefik, the two
Docker socket proxies and Postgres. The application container is not in it,
because the backend has no Dockerfile yet; until it does, `install.sh` brings up a
stack that serves nothing on HTTP except the ACME challenge. Everything else here
(installer, update socket, image publishing) is real and testable.

## One host, nothing else

The only supported target is a freshly installed Ubuntu server (amd64) that runs
nothing else. A single machine means no cluster, no orchestration, no rolling
deploy, and no need to be clever about any of it.

Two things stay manual on purpose: **hardening sshd** (`PasswordAuthentication no`,
`PermitRootLogin no`) and **the firewall** (22, 80, 443). A script that rewrites
`sshd_config` on a box somebody is currently SSH'd into is how people lock
themselves out, and the installer has no way to tell a fresh host from a
misconfigured one.

Running the stack as a non-root user does not reduce what a compromise costs:
membership of the `docker` group is root-equivalent on the host. The reason to use
a normal user anyway is file ownership and the discipline of `sudo` — not
containment. Nothing in this document claims otherwise.

## Layout

Code and state are separate so an upgrade can replace one without touching the
other:

```text
/opt/tctcl-platform/            replaced on every upgrade
  compose.yaml
  install.sh
  updater.sh
  tctcl-updater.socket
  tctcl-updater@.service
  .env.example                  the shape, not a source of values

/var/lib/tctcl-platform/        never touched by an upgrade
  .env                          generated once, 0600, never regenerated
  traefik/acme.json             Traefik writes it at 0600 and refuses a wider mode
  workspaces/<id>/              one directory per workspace container
  backups/
  updater.log                   installer output, appended per update
```

Postgres is the exception to "state is a directory": its data lives in the named
volume `tctcl_postgres-data`. Nobody reads inside it, `pg_dump` is the copy of
record, and Docker's own uid and fsync handling removes a class of
"container won't start after reinstall" failures. Everything else is a bind mount
a human can `ls`.

## Install

```bash
curl -fsSL https://github.com/Tctcl/tlabs-platform/releases/download/v0.1.0/install.sh -o install.sh
less install.sh
sudo bash install.sh --domain chat.example.com
```

Then add the DNS record and open 22/80/443. The script, in order: checks the
architecture and (loosely) the distribution, resolves `--version latest` through
the GitHub releases redirect, installs Docker from Docker's apt repository if
`docker compose version` does not already work, unpacks the release bundle into
`/opt/tctcl-platform`, creates the state directories and the `tctcl-updater`
group, writes `.env` with a generated Postgres password, `docker compose up -d`,
and enables the update socket.

Every step is idempotent, and an existing `.env` is never rewritten — the secrets
in it are the deployment. `--dry-run` prints the whole list of changes instead of
making them, which is the only honest way to inspect a script that runs as root.

## Upgrade and rollback

```bash
sudo /opt/tctcl-platform/install.sh --version 0.2.0
```

That is the same code path as the install: pull the new bundle, rewrite
`TCTCL_VERSION` in `.env`, `compose pull`, `compose up -d`. Every first-party
image is referenced by exact version, so the stack always names what it runs and
there is no `latest` to drift.

Rolling back is the same command with an older version — **unless a migration
ran**. The backend owns its schema (`apps/backend/src/storage/postgres/`), and
`MIGRATIONS[n]` only moves forward. An older backend against a newer schema is not
supported: restore the database from the pre-upgrade dump instead of downgrading
in place.

## The update socket

The frontend will trigger updates later, which means the backend has to cause a
privileged operation on its own host. It does not do that with Docker, and it does
not do it with SSH keys: it writes one line to a Unix socket.

```text
/run/tctcl/updater.sock     root:tctcl-updater, 0660, systemd Accept=yes

in:   UPDATE 1.2.3
out:  START 1.2.3
      <installer output>
      OK 1.2.3        or        ERR install failed, see /var/lib/tctcl-platform/updater.log
```

`tctcl-updater.socket` owns the listener, so no process idles between updates.
Each connection is handed to one instance of `tctcl-updater@.service`, which runs
`updater.sh` with stdin and stdout bound to the connection. The handler validates
the version as strict semver before it reaches a root command line, takes a lock
so two requests cannot race, and runs `install.sh --version` with its output tee'd
to `updater.log`.

Why a socket instead of a privileged container spawned by the backend: the
installer stays on the host, `journalctl -u tctcl-updater@` and `updater.log` are
the audit trail, and a backend that crashes mid-request cannot leave a container
pretending to be a package manager. Security-wise it changes nothing — the backend
can already create containers. What it buys is one interface, one log, and one
place where a half-finished update is visible.

The backend must run with gid **1001** (`tctcl-updater`) to write the socket. That
is a deployment contract once its image exists, not a suggestion.

## Backups

Not implemented. The decisions that shape it are already taken, though: Postgres
is a named volume that only `pg_dump` can copy safely, and the bind-mounted trees
(`workspaces/`, `traefik/`, `backups/`) are plain directories.

A bind-mounted Postgres directory is not a backup. Copying a live data directory
gives a torn snapshot that may not start; the dump is the unit of restore. The
backend will own this later (`docs/deferred.md`), which means it will need the
state directory mounted — a deliberate exception to the "no unnecessary host
mounts" rule in `docs/remote-development.md`.

## Docker access

Nothing mounts `/var/run/docker.sock` except two `tecnativa/docker-socket-proxy`
instances, each on a private network that only its one consumer joins:

| proxy | consumer | allowed |
| --- | --- | --- |
| `socket-proxy-ro` | Traefik | `GET` on containers, networks, info, events. `POST` off. |
| `socket-proxy-rw` | the backend | containers, exec, images, volumes, networks, info, events; `POST` on; start/stop/restart |

Swarm, secrets, configs, plugins, nodes and the system endpoints are off on both.
Neither proxy is on the `edge` network, so a workspace container cannot reach the
Docker API even if it learns the address.

Be clear about what this is: an endpoint filter that keeps accidental and
unrelated API use out of reach. It is **not** an isolation boundary. A container
created with `--privileged` is host root, and the read-write proxy allows
container creation by design, so anyone who can reach the backend API can still
escape to the host. Rootless Docker is the only real fix, and it is not in scope
for the first install.

## Images

Two images, published to GHCR by `.github/workflows/images.yml`, `linux/amd64`
only:

```text
ghcr.io/tctcl/tlabs-platform               the product image: Fastify serving the built SPA
ghcr.io/tctcl/tlabs-platform/workspace     the environment image apps/agent/Dockerfile builds
```

The product image serves the frontend and the API from one origin, so there is no
reverse proxy in front of it, no CORS configuration, and no second route table to
keep in step with Fastify's.

### Channels

| channel    | tag              | built from                   | what it is        |
| ---------- | ---------------- | ---------------------------- | ----------------- |
| production | `X.Y.Z`, `X.Y`   | the release tag, after gates | stable            |
| staging    | `staging`        | every push to `main`         | the head of main  |
| dev        | none             | your checkout                | `pnpm dev`, no container |

`latest` is a moving pointer to the newest release, for anything that wants
"current release" without asking the releases API. `install.sh --version latest`
still resolves that release through the API and pins a concrete `X.Y.Z`, so a
production install does not drift when the next release lands; it is updated
deliberately.

A staging install follows the `staging` tag. `install.sh --channel staging`
requires a checkout of `main` — there is no staging bundle to download, because
nothing tags a staging commit — and it pulls `:staging` on every run. Switching
channels is re-running the script with a different `--channel`: `.env` records the
choice as `TCTCL_CHANNEL`, `TCTCL_IMAGE` and `TCTCL_WORKSPACE_IMAGE`.

`dev` is not an install. It is this repository and `pnpm dev`, and it is the only
channel with no container on the machine.

The deployment bundle (`tctcl-deploy-vX.Y.Z.tar.gz`) is built from the release tag
by `.github/workflows/bundle.yml` and uploaded to the release. It is fetched over
TLS and its contents are checked into this repository, but there is no signature
and no checksum file yet.

### Knowing when a release lands

The backend asks GitHub for `releases/latest` every fifteen minutes
(`UPDATE_CHECK_INTERVAL_MS`, `0` turns it off) and records the answer: what the
install runs from `TCTCL_VERSION`, what the newest release is, and whether the
first is behind the second. `GET /updates` returns the last answer without
touching the network; `POST /updates` forces a check. Nothing in the interface
reads it yet.

Two cases report `available: null` instead of guessing. A staging install tracks
a moving tag, so every merge would look like an update and the number would mean
nothing. A checkout has no `TCTCL_VERSION` to compare against. Both still
record when they last checked.

This is a notification, not an updater: nothing is downloaded and nothing is
restarted. Applying an update is `install.sh` on the host, over the update
socket, which the backend does not drive yet.

## What is not here

- Any backend client for the update socket: no route, no progress streaming.
- An updater behind the update check: the install is told a release exists and
  nothing more.
- Any interface for the update check: the two routes are the whole surface.
- Backups, restore, and the schema-migration policy that would make in-place
  rollback safe.
- Signature or checksum verification for the release bundle.
