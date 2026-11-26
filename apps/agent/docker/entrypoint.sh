#!/bin/sh
set -eu

# Host keys live on the environment's named volume, so recreating its container
# does not change the identity already recorded in a developer's known_hosts.
SSH_HOST_KEY_DIR=/var/lib/cake/ssh
mkdir -p "$SSH_HOST_KEY_DIR" /run/sshd
chmod 0700 "$SSH_HOST_KEY_DIR"
if [ ! -f "$SSH_HOST_KEY_DIR/ssh_host_ed25519_key" ]; then
  ssh-keygen -q -t ed25519 -N '' -f "$SSH_HOST_KEY_DIR/ssh_host_ed25519_key"
fi
if [ ! -f "$SSH_HOST_KEY_DIR/ssh_host_rsa_key" ]; then
  ssh-keygen -q -t rsa -b 4096 -N '' -f "$SSH_HOST_KEY_DIR/ssh_host_rsa_key"
fi

# Cake writes authorized_keys with docker exec after start and after every key
# change; the old SSH_AUTHORIZED_KEYS_FILE handoff is intentionally not used.

# Bootstrap runs as the development user so anything it writes belongs to dev.
# A failing bootstrap stops the container: a half-configured environment that
# accepts SSH would be worse than one that refuses to start. `env` is used rather
# than `--preserve-env` because it passes exactly these variables and nothing
# else from the root environment. DEV_ENV_TOKEN is the bearer token the backend
# requires for the manifest and the state report: leaving it off this list
# makes every boot fail with 401.
if [ -n "${DEV_ENV_MANIFEST_URL:-}" ]; then
  sudo -u dev -H env \
    DEV_ENV_MANIFEST_URL="${DEV_ENV_MANIFEST_URL}" \
    DEV_ENV_STATE_URL="${DEV_ENV_STATE_URL:-}" \
    DEV_ENV_TOKEN="${DEV_ENV_TOKEN:-}" \
    DEV_ENV_INSTALL_RECORD="${DEV_ENV_INSTALL_RECORD:-/var/lib/dev-env/installed.json}" \
    node /opt/dev-env/dist/index.js
else
  echo '{"level":"warn","event":"entrypoint.no_manifest_url"}'
fi

# sshd stays in the foreground as PID 1 and keeps the container alive.
exec /usr/sbin/sshd -D -e
