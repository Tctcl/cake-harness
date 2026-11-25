#!/bin/sh
set -eu

# Host keys are per container: regenerating them at boot keeps one environment's
# identity out of another's known_hosts file.
if [ ! -f /etc/ssh/ssh_host_ed25519_key ]; then
  ssh-keygen -q -t ed25519 -N '' -f /etc/ssh/ssh_host_ed25519_key
  ssh-keygen -q -t rsa -b 4096 -N '' -f /etc/ssh/ssh_host_rsa_key
fi

mkdir -p /run/sshd

# The backend supplies the keys allowed to log in.
if [ -n "${SSH_AUTHORIZED_KEYS_FILE:-}" ] && [ -f "${SSH_AUTHORIZED_KEYS_FILE}" ]; then
  install -d -m 0700 -o dev -g dev /home/dev/.ssh
  install -m 0600 -o dev -g dev "${SSH_AUTHORIZED_KEYS_FILE}" /home/dev/.ssh/authorized_keys
fi

# Bootstrap runs as the development user so anything it writes belongs to dev.
# A failing bootstrap stops the container: a half-configured environment that
# accepts SSH would be worse than one that refuses to start. `env` is used rather
# than `--preserve-env` because it passes exactly these three variables and
# nothing else from the root environment.
if [ -n "${DEV_ENV_MANIFEST_URL:-}" ]; then
  sudo -u dev -H env \
    DEV_ENV_MANIFEST_URL="${DEV_ENV_MANIFEST_URL}" \
    DEV_ENV_STATE_URL="${DEV_ENV_STATE_URL:-}" \
    DEV_ENV_INSTALL_RECORD="${DEV_ENV_INSTALL_RECORD:-/var/lib/dev-env/installed.json}" \
    node /opt/dev-env/dist/index.js
else
  echo '{"level":"warn","event":"entrypoint.no_manifest_url"}'
fi

# sshd stays in the foreground as PID 1 and keeps the container alive.
exec /usr/sbin/sshd -D -e
