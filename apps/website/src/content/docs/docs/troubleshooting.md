---
title: Troubleshooting
description: Diagnose Cake startup, certificates, providers, tools, terminals, secrets, and upgrades.
---

Most checks use the same Compose invocation. These first two are read-only:

```bash
docker compose --env-file /var/lib/cake-harness/.env \
  -f /opt/cake-harness/compose.yaml ps

docker compose --env-file /var/lib/cake-harness/.env \
  -f /opt/cake-harness/compose.yaml logs app
```

Do not omit `--env-file`: required values such as `DOMAIN`, `STATE_DIR`, `POSTGRES_PASSWORD`, the image references, and `CIPHERGATE_TOKEN` do not have usable Compose defaults.

## The app does not answer

1. Check whether `app` is running and `postgres` is healthy with `ps`.
2. Inspect `logs app` for `Invalid environment configuration:`. Startup validation lists each bad or missing value.
3. Check `logs postgres` and `logs ciphergate` if their dependencies are not ready.
4. Query the public health route from inside the app container:

```bash
docker compose --env-file /var/lib/cake-harness/.env \
  -f /opt/cake-harness/compose.yaml exec -T app \
  node -e "fetch('http://127.0.0.1:8080/health').then(r => r.text().then(t => console.log(r.status, t)))"
```

The installer waits two minutes for this same endpoint on a first boot.

## Certificates do not issue

- Confirm the domain's A/AAAA record points to this server and `DOMAIN` contains only that bare hostname.
- Confirm port 443 reaches Traefik. TLS-ALPN issuance needs 443; port 80 handles the HTTP redirect.
- Inspect `logs traefik` for the certificate resolver error.
- Check `/var/lib/cake-harness/traefik/acme.json`. Traefik writes it with mode `0600` and refuses a wider mode. Do not pre-create it with permissive permissions.

Removing `acme.json` discards the certificates Traefik holds and forces re-issuance. Do not treat that as the first diagnostic step.

## An agent has no provider access

The error **“No OpenCode Go key reaches this agent”** means the provider chain is incomplete:

1. Add the key under **Settings → Credentials**. Validation must succeed before it is stored.
2. Link the key on the workspace's **Providers** tab.
3. Allow the selected model, or enable **Allow every model**.
4. Check the agent profile and the conversation's key/model overrides.

Related errors:

| Code | Meaning |
| --- | --- |
| `AGENT_NO_KEY` | No provider key reaches the agent |
| `AGENT_KEY_NOT_LINKED` | The selected key is not linked to this workspace |
| `AGENT_MODEL_UNKNOWN` | The provider does not serve the selected model |
| `AGENT_MODEL_NOT_ALLOWED` | The workspace does not allow the selected model |
| `CAPABILITY_NOT_ALLOWED` | A selected capability exceeds the workspace ceiling |

## An agent cannot use a tool

For a new workspace, open **Tools** and select **Sync from registry**. A new workspace has no tool grants until you select tools or enable **Reach every capability**. Then check the individual agent's grants.

If `read`, `write`, `edit`, or `bash` is expected, make sure this is a container-backed workspace and its container is running. General has no container and receives only `web_fetch`; private-address URLs are refused there and anywhere that tool runs.

Tool calls appear in the transcript. Inspect the failed call rather than inferring its location from the final response.

## Sign-in problems

- `429 auth.too_many_attempts`: ten failures from one resolved address within 15 minutes. Wait for `Retry-After`; restarting `app` also clears the in-memory counter.
- `400 auth.invalid_password`: use a password from 12 through 200 characters.
- `401 auth.pending`: finish the pending sign-in step, such as TOTP verification.
- No login screen: check whether the installer's first-owner step completed and inspect its output and `first-run-credentials` handling.

Do not re-run account bootstrap as a password reset: an owner that already has a password is left unchanged.

## A terminal will not open

| Symptom | Cause |
| --- | --- |
| `409 ENVIRONMENT_STOPPED` | The workspace container is not running |
| `409 TERMINAL_LIMIT_REACHED` | The container already has `TERMINAL_MAX_SESSIONS` sessions (default 8) |
| `409 TERMINAL_BUSY` or close code `4409` | Another client is attached to that session |
| Close code `4404` | The session is gone, commonly because the backend restarted |
| No terminal for General | General has no container |

Create another session for a second browser tab. Reattach to replay retained scrollback. Chat durability does not imply terminal-session durability.

## Secrets-store failures

- A backend startup error about CipherGate can mean `CIPHERGATE_URL` and `CIPHERGATE_TOKEN` are not both set. Compose supplies both for a normal install.
- If the store cannot write its state, check ownership of `/var/lib/cake-harness/ciphergate`. The service runs as `1000:1000`, matching the installer's ownership.
- If a stored secret cannot be decrypted, `gateway.key` may not match `gateway.db`. Restore the matching keyfile; rotating it does not re-encrypt the database.
- After rotating the `cake-backend` consumer key, put the new token in `.env` as `CIPHERGATE_TOKEN` and restart `app`.

Provider keys and TOTP enrolments becoming unreadable after a configuration change points to a changed `SECRET_KEY`. Restore the original value from a secure backup.

## Updates and Docker errors

A staging install has no fixed version, so a newest-release comparison is not meaningful. On production, check `CAKE_VERSION`, `CAKE_CHANNEL`, and `UPDATE_CHECK_INTERVAL_MS`. A release notice does not apply an update; use [Upgrading](/docs/upgrading).

For host update-socket diagnostics:

```bash
systemctl status cake-updater.socket
journalctl -u 'cake-updater@*'
```

The backend reaches Docker through `socket-proxy-rw`. A `403` from that proxy means an endpoint is disabled. Containers, exec, images, volumes, networks, info, and events are enabled; unrelated administrative endpoints are not.

A Traefik `504` after a network change can mean its Docker provider selected an unreachable network. Compose pins the provider to `cake-edge` to avoid that mismatch.
