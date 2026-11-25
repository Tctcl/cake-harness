---
title: Accounts and security
description: Operate Cake's single-owner sign-in, sessions, TOTP, encrypted credentials, and Docker access.
---

Cake installs as a single-owner system. The installer creates the owner account, enables password sign-in, and writes the generated credentials to the root-only first-run file. Multi-user and an admin page are planned; they are not available today.

## Passwords and sessions

Passwords are 12–200 characters and hashed with `scrypt`, using a per-password salt and a timing-safe comparison. Unknown usernames and incorrect passwords receive the same sign-in failure.

The session cookie is named `cake_session` and is `HttpOnly`, `SameSite=Lax`, and scoped to `/`. Production Compose sets `TRUST_PROXY=true`, so HTTPS requests behind Traefik receive a `Secure` cookie.

Session tokens are 32 random bytes encoded with base64url; only their SHA-256 hash is stored. Sessions last 30 days with sliding activity. Logout, password changes, and account security changes end affected sessions.

## Sign-in throttle

Ten failed sign-ins from one resolved client address within 15 minutes produce `429 auth.too_many_attempts` and a `Retry-After` response. The counter is in memory: the single backend process enforces it, and a backend restart clears it.

`TRUST_PROXY=true` is important behind Traefik. Without it, forwarded client addresses are not trusted and clients can share one throttle bucket.

## TOTP two-factor authentication

Enable TOTP under **Settings → Account**:

1. Add the displayed `otpauth://` URI to an authenticator.
2. Return a current six-digit code to confirm enrolment.
3. Keep the authenticator available for future sign-ins.

Cake uses RFC 6238 TOTP with a 30-second period and one step of accepted drift. The account is not protected until the confirmation code succeeds. Disabling the second factor requires the password.

TOTP secrets are encrypted with AES-256-GCM using the key derived from `SECRET_KEY`. A database dump alone therefore does not reveal the second factor. Keep `SECRET_KEY` stable; replacing it makes existing enrolments unreadable.

## Provider credentials

OpenCode Go keys are validated before storage and encrypted at rest. A workspace receives access by linking a stored key on its **Providers** tab, not by copying plaintext into a profile.

The same `SECRET_KEY` protects stored provider keys. Losing or rotating it without a migration makes those keys unreadable. Back up the installation environment securely and restrict access to it.

## Secrets store

The Compose stack runs a secrets store on an internal Docker network. Only the backend joins that network; no host port is published and its browser UI listener is disabled.

Two different keys matter:

- `/var/lib/cake-harness/ciphergate/gateway.key` is the root of trust for values in the store. Back it up **separately** from `gateway.db`.
- `CIPHERGATE_TOKEN` in `/var/lib/cake-harness/.env` is the backend reader consumer's bootstrap key.

The store's admin key is printed only during initialisation and recorded in `first-run-credentials`. Move it to a password manager and delete that file.

Rotate the backend reader key with:

```bash
docker compose --env-file /var/lib/cake-harness/.env \
  -f /opt/cake-harness/compose.yaml exec ciphergate \
  gateway consumer rotate-key cake-backend
```

Write the resulting value as `CIPHERGATE_TOKEN` in `.env`, then restart `app`.

## Docker access is root-equivalent

Only the two socket proxies mount `/var/run/docker.sock`. Traefik gets a read-only view; the backend gets the container, exec, image, volume, and network operations needed to provision workspaces. Neither proxy joins the public edge or workspace networks.

This narrows accidental and unrelated API use. It is **not** a host isolation boundary: the backend can create containers by design, and Docker container creation is root-equivalent. Workspace containers cannot reach the proxies through their normal networks, but anyone who controls the backend's Docker API access can affect the host. Rootless Docker is not part of this install.
