---
title: Requirements
description: The server, architecture, DNS records, and ports needed by a Cake install.
---

Cake supports one fresh server running one Cake stack. It is not a cluster, a multi-tenant service, or an add-on to an existing reverse proxy.

## Host

| Item | Requirement |
| --- | --- |
| Operating system | A freshly installed Ubuntu server |
| Architecture | `linux/amd64`; published images are amd64 only |
| Docker | Installed by the installer if `docker compose version` does not already work |
| Access | Root through `sudo` for installation and upgrades |
| Provider | An OpenCode Go API key for model calls |

The installer checks `uname -m` and refuses architectures other than amd64. It reads `/etc/os-release` and warns on distributions other than Ubuntu; those systems may need a different Docker repository.

No fixed disk minimum is declared. Allow room for the three first-party images, workspace files, Postgres, secrets, and logs. Code lives in `/opt/cake-harness`, mutable state in `/var/lib/cake-harness`, and Postgres in the named volume `cake_postgres-data`.

## Domain and DNS

Choose a bare hostname such as `cake.example.com`. Create an A or AAAA record that points it to the server before requesting a certificate. Traefik requests a certificate for the hostname in `DOMAIN`; it does not provision DNS for you.

## Ports

| Port | Purpose |
| --- | --- |
| `22/tcp` | SSH administration, if you use it |
| `80/tcp` | HTTP, redirected to HTTPS |
| `443/tcp` | HTTPS and Let's Encrypt TLS-ALPN validation |
| `22000-22999/tcp` | Workspace SSH by default; the configured `CAKE_SSH_PORT_RANGE` if changed |

Only Traefik publishes the web ports. Workspace containers publish one stable host port each for SSH from the configured range; development-server ports are not published individually. Postgres and the secrets store do not publish host ports. Agent tools communicate with the pi-env daemon inside a workspace container without opening a port for each tool.

Certificate issuance uses **TLS-ALPN**, so port 443 must reach Traefik. Port 80 is still needed for the normal HTTP-to-HTTPS redirect. Open the full configured SSH port range in the server firewall and allow clients to reach `CAKE_SSH_HOST` on those ports.

## Deliberately manual steps

The installer does not edit `sshd_config` or your firewall. Harden SSH yourself, then allow the ports you need. A script that changes SSH settings on the machine you are currently using can lock you out.

Membership in the `docker` group is root-equivalent. Using a normal account with `sudo` is useful for file ownership and an audit trail, but it is not a Docker security boundary.
