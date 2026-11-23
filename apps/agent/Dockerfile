# Universal development environment for one workspace.
#
# The base image provides the runtime for the bootstrap and the floor of tooling;
# everything above that floor is installed by reconciliation against the desired
# configuration the backend serves. See docs/remote-development.md.
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DEV_ENV_CONFIG_DIR=/etc/dev-env

# hadolint ignore=DL3008 — versions are deliberately unpinned: this image is rebuilt
# often, and a pinned apt version disappears from the mirror before long.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      less \
      openssh-server \
      procps \
      python3 \
      sudo \
 && rm -rf /var/lib/apt/lists/*

# Development user: non-root, passwordless sudo so an agent can install system
# packages without a privileged container. The base image already occupies uid
# 1000 as `node`; that uid is reused so host bind mounts line up with the usual
# first-user id instead of landing on a second account nobody can write to.
# `usermod --password '*'` replaces the `!` useradd leaves behind. sshd refuses a
# locked account before it ever reads authorized_keys, and `*` stays unmatched by
# any password while counting as unlocked.
RUN userdel --remove --force node \
 && useradd --create-home --uid 1000 --shell /bin/bash dev \
 && usermod --password '*' dev \
 && printf 'dev ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/dev \
 && chmod 0440 /etc/sudoers.d/dev

# Credentials are written by the bootstrap and sourced by interactive logins, so
# `gh` and friends are already authenticated when somebody SSHes in.
# hadolint ignore=SC2016 — $HOME has to expand when a user logs in, not at build time.
RUN printf '%s\n' \
      '[ -f "$HOME/.config/dev-env/credentials.env" ] && . "$HOME/.config/dev-env/credentials.env"' \
      > /home/dev/.profile \
 && chown dev:dev /home/dev/.profile

COPY docker/sshd_config /etc/ssh/sshd_config
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && mkdir -p /run/sshd /etc/dev-env /home/dev/workspace \
 && chown dev:dev /home/dev/workspace

# Compiled bootstrap. Rebuild with `pnpm build` in apps/agent before `docker build`.
COPY dist /opt/dev-env/dist

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
