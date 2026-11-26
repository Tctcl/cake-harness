# Universal development environment for one workspace.
#
# The base image provides the runtime for the bootstrap and the floor of tooling;
# everything above that floor is installed by reconciliation against the desired
# configuration the backend serves. See docs/remote-development.md.
FROM node:26-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    DEV_ENV_INSTALL_RECORD=/home/dev/.local/share/cake/installed.json \
    PATH=/home/dev/.local/bin:${PATH}

# hadolint ignore=DL3008 — versions are deliberately unpinned: this image is rebuilt
# often, and a pinned apt version disappears from the mirror before long.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential \
      ca-certificates \
      curl \
      git \
      jq \
      less \
      openssh-server \
      procps \
      python3 \
      ripgrep \
      sudo \
      unzip \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
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

# pnpm comes from Corepack, while npm's global packages belong to dev on the persistent home volume.
RUN npm install --global corepack \
 && corepack enable pnpm \
 && sudo -u dev -H corepack prepare pnpm@12.16.1 --activate

# npm i -g needs no root. Cover Docker exec, SSH login shells and non-login interactive bash alike.
# hadolint ignore=SC2016 — $HOME and $PATH expand in the user's shell, not while building.
RUN printf 'prefix=/home/dev/.local\n' > /home/dev/.npmrc \
 && printf 'PATH=/home/dev/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n' > /etc/environment \
 && printf '%s\n' 'export PATH="$HOME/.local/bin:$PATH"' > /etc/profile.d/cake-local.sh \
 && printf '%s\n' 'export PATH="$HOME/.local/bin:$PATH"' >> /home/dev/.bashrc \
 && printf '%s\n' \
      '[ -f "$HOME/.config/dev-env/credentials.env" ] && . "$HOME/.config/dev-env/credentials.env"' \
      > /home/dev/.profile \
 && chown dev:dev /home/dev/.profile /home/dev/.npmrc /home/dev/.bashrc

COPY docker/sshd_config /etc/ssh/sshd_config
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 0755 /usr/local/bin/entrypoint.sh \
 && mkdir -p /run/sshd /etc/dev-env /var/lib/cake/ssh /home/dev/workspace /home/dev/.local/share/cake \
 && chown -R dev:dev /home/dev

# Compiled bootstrap. Rebuild with `pnpm build` in apps/agent before `docker build`.
COPY dist /opt/dev-env/dist

EXPOSE 22
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
