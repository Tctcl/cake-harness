---
title: Architecture
description: Reference Cake's Compose services, Docker networks, workspace tool path, images, and on-disk state.
---

One Cake install is one host, one domain, and one Compose project. Traefik terminates TLS; the Cake app serves the browser interface and API from the same origin. Workspace containers are created dynamically by the backend rather than declared as Compose services.

## Request and service map

```text
                              :80 / :443
                                  |
                            +-----------+
internet ------------------>|  Traefik  |
                            +-----------+
                                  | cake-edge
                                  v
                         Cake app, port 8080
                       Fastify + browser interface
                       /       |         \
             cake_db   /        |          \  cake_secrets (internal)
          (internal)  /         |           \
                     v          |            v
                 Postgres       |        Secrets store
                                |        REST on 8400; UI off
                 +--------------+--------------+
                 |                             |
          cake_api-rw                    cake-workspaces
                 |                             |
       read-write socket proxy          workspace containers
                 |                        pi-env tool daemon
                 v                        browser terminals
       /var/run/docker.sock

Traefik -> read-only socket proxy -> /var/run/docker.sock
```

Postgres stores platform state and pi-durable conversations. The app uses the read-write proxy to create workspace containers and exec terminals. Tools in a container-backed workspace go through its pi-env daemon; they do not execute in the backend and require no published workspace ports.

## Compose services

| Service | Image | Role |
| --- | --- | --- |
| `traefik` | `traefik:v3.6` | Publishes 80/443, redirects to HTTPS, obtains Let's Encrypt certificates |
| `socket-proxy-ro` | `tecnativa/docker-socket-proxy` | Read-only containers/networks/info/events view for Traefik; `POST` disabled |
| `socket-proxy-rw` | `tecnativa/docker-socket-proxy` | Backend's scoped container, exec, image, volume, and network access |
| `postgres` | `postgres:18-alpine` | Durable conversations and platform tables |
| `ciphergate` | `${CAKE_CIPHERGATE_IMAGE}` | Encrypted secrets store on an internal network |
| `app` | `${CAKE_IMAGE}` | Fastify and the compiled product browser interface on one origin |

The app has no CORS or second route table to maintain because its browser interface and API share an origin. The marketing/documentation website is deployed separately and is not part of this Compose stack or product image.

## Networks

| Compose network | Docker name | Members and purpose |
| --- | --- | --- |
| `edge` | `cake-edge` | Traefik and app; the only inbound web route |
| `db` | `cake_db` | App and Postgres; `internal: true` |
| `api-ro` | `cake_api-ro` | Traefik and its read-only Docker proxy |
| `api-rw` | `cake_api-rw` | App and its read-write Docker proxy |
| `workspaces` | `cake-workspaces` | App and dynamically created workspace containers |
| `secrets` | `cake_secrets` | App and secrets store; `internal: true` |

A workspace joins `cake-workspaces`, where it can reach the app. It does not join `db`, either Docker API network, or `secrets`.

Compose sets both `WORKSPACE_NETWORK=cake-workspaces` and `WORKSPACE_BACKEND_URL=http://app:8080`. The backend rejects a configuration with only one of them. The workspace uses this connection for its backend document flow; tool execution still happens locally through pi-env.

Traefik's Docker provider is explicitly pinned to `cake-edge`. Container labels opt services into routing, and the app rule matches `Host(${DOMAIN})` on the HTTPS entrypoint.

## Docker socket scope

The read-only proxy allows only the reads Traefik needs. The read-write proxy enables containers, exec, images, volumes, networks, info, events, `POST`, and start/stop/restart. Swarm, secrets, configs, plugins, nodes, sessions, and system endpoints remain off.

Neither socket proxy is on `edge` or `cake-workspaces`. This keeps Docker API access away from workspace containers. The read-write capability is nevertheless root-equivalent on the host; endpoint filtering is not a replacement for rootless Docker or a privileged-container isolation boundary.

## State and code on the host

```text
/opt/cake-harness/                 deployment code, replaced by upgrades
  compose.yaml
  install.sh
  updater.sh
  cake-updater.socket
  cake-updater@.service
  .env.example

/var/lib/cake-harness/             state, preserved by upgrades
  .env                             generated once, mode 0600
  traefik/acme.json                Let's Encrypt state, mode 0600
  ciphergate/gateway.db            secrets-store database
  ciphergate/gateway.key           root of trust for stored secrets
  workspaces/<id>/                 workspace container state
  backups/
  updater.log                      update helper output
  first-run-credentials            remove after saving the generated credentials

/run/cake/updater.sock             root:cake-updater, mode 0660
```

Postgres is the exception to bind-mounted state. Its named volume is `cake_postgres-data`, mounted at `/var/lib/postgresql`; use `pg_dump`, not a live directory copy, for logical backups.

The secrets-store service runs as uid/gid `1000:1000`. Its `gateway.key` encrypts values in `gateway.db`; back up the keyfile separately from the database.

## Update socket

The installer enables `cake-updater.socket`. Systemd accepts a connection and starts `cake-updater@.service`, which runs the host update helper. Versions are validated as strict semantic versions before the installer runs, and output is appended to `updater.log`.

The socket accepts an `UPDATE X.Y.Z` request and returns start/progress plus success or error output. The backend does not currently drive this socket; upgrades are explicit installer runs on the host.

## Images and channels

Three first-party images are published for `linux/amd64`:

```text
ghcr.io/tctcl/cake-harness             product: Fastify + product browser interface
ghcr.io/tctcl/cake-harness/workspace   workspace tools and pi-env environment
ghcr.io/tctcl/cake-harness/ciphergate  secrets store
```

| Channel | Tags | Source |
| --- | --- | --- |
| Production | `X.Y.Z`, `X.Y`, and moving `latest` | Published release |
| Staging | Moving `staging` | Every push to `main` |
| Development | No published install tag | Local checkout |

The installer resolves production `latest` to a concrete `X.Y.Z` and records that version. Staging intentionally has no fixed `CAKE_VERSION`.
