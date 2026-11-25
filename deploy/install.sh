#!/usr/bin/env bash
#
# Installs or updates one self-hosted Cake instance.
#
# The supported host is a fresh Ubuntu server that runs nothing else: Docker from
# Docker's own apt repository, the stack in compose.yaml, and the host-side update
# socket. Harden SSH and open 80/443 yourself; this script does not touch sshd or
# the firewall on a machine you are currently logged into.
#
# Every step is idempotent. Running the script again with a different --version is
# the upgrade path (and, with an older version, the rollback path).
#
#   sudo ./install.sh --domain chat.example.com
#   sudo ./install.sh --version 1.2.3
#   ./install.sh --dry-run --domain chat.example.com
#
set -euo pipefail

REPO="Tctcl/cake-harness"
INSTALL_DIR="${CAKE_INSTALL_DIR:-/opt/cake-harness}"
STATE_DIR="${CAKE_STATE_DIR:-/var/lib/cake-harness}"

# Fixed so the container user can be given the same gid by the backend image.
SOCKET_GROUP="cake-updater"
SOCKET_GID=1001
SOCKET_DIR="/run/cake"

DRY_RUN=false
VERSION="latest"
# Which release channel this install follows. `production` pins a released version; `staging` tracks the moving
# `staging` tag, which every merge to main overwrites. A `dev` install is a checkout and `pnpm dev`, not this script.
# Empty means "what this install already follows" (CAKE_CHANNEL in .env), and production for a first install: re-running
# the script without --channel must not quietly move a staging install onto releases.
CHANNEL=""
IMAGE=""
WORKSPACE_IMAGE=""
CIPHERGATE_IMAGE=""
DOMAIN="${CAKE_DOMAIN:-}"
SSH_HOST="${CAKE_SSH_HOST:-}"
SSH_PORT_RANGE="${CAKE_SSH_PORT_RANGE:-}"
ACME_EMAIL=""
ADMIN_USER="admin"

log() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}
step() { printf '\n== %s\n' "$*"; }

# Sets KEY=value in a file, replacing the line when it exists and appending it when it does not.
set_env() {
  local file=$1 key=$2 value=$3
  if grep -q "^$key=" "$file"; then
    sed -i "s|^$key=.*|$key=$value|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

# Everything that changes the host goes through this, so --dry-run is honest
# about the whole list instead of the parts a human remembered to guard.
run() {
  if [ "$DRY_RUN" = true ]; then
    printf '   would: %s\n' "$*"
  else
    "$@"
  fi
}

usage() {
  cat <<'EOF'
Installs or updates one self-hosted Cake instance.

  --version X.Y.Z     release to install (default: latest)
  --channel NAME      production or staging (default: what the install already follows, else production)
  --admin-user NAME   username of the first admin, created once (default: admin)
  --domain HOST       hostname to serve; required for a first install
  --ssh-host HOST     public hostname for workspace SSH (default: --domain)
  --ssh-port-range N-M host ports for workspace SSH (default: 22000-22999)
  --acme-email ADDR   Let's Encrypt contact (default: admin@HOST)
  --dry-run           print the changes instead of making them
  -h, --help          this text
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --channel)
      CHANNEL="${2:-}"
      shift 2
      ;;
    --domain)
      DOMAIN="${2:-}"
      shift 2
      ;;
    --ssh-host)
      SSH_HOST="${2:-}"
      shift 2
      ;;
    --ssh-port-range)
      SSH_PORT_RANGE="${2:-}"
      shift 2
      ;;
    --acme-email)
      ACME_EMAIL="${2:-}"
      shift 2
      ;;
    --admin-user)
      ADMIN_USER="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1 (try --help)" ;;
    esac
  done
}

# Reads KEY's value from the install's .env, or nothing on a fresh host. A missing file has to be an empty answer: under
# `set -euo pipefail` a failing sed inside $( ) would otherwise end the whole script silently with its exit status.
env_value() {
  [ -f "$STATE_DIR/.env" ] || return 0
  sed -n "s/^$1=//p" "$STATE_DIR/.env" | tail -n1
}

validate() {
  if [ -z "$DOMAIN" ]; then
    DOMAIN="$(env_value DOMAIN)"
  fi
  if [ -z "$SSH_HOST" ]; then
    SSH_HOST="$(env_value CAKE_SSH_HOST)"
  fi
  if [ -z "$SSH_PORT_RANGE" ]; then
    SSH_PORT_RANGE="$(env_value CAKE_SSH_PORT_RANGE)"
  fi
  SSH_PORT_RANGE="${SSH_PORT_RANGE:-22000-22999}"
  SSH_HOST="${SSH_HOST:-$DOMAIN}"

  if [ -z "$CHANNEL" ]; then
    CHANNEL="$(env_value CAKE_CHANNEL)"
    CHANNEL="${CHANNEL:-production}"
  fi

  case "$CHANNEL" in
  production | staging) ;;
  dev)
    die "a dev install is a checkout and \`pnpm dev\`; there is no container to install"
    ;;
  *) die "--channel must be production or staging, got: $CHANNEL" ;;
  esac

  # Staging is a moving tag, so a version would be a claim the channel cannot keep.
  if [ "$CHANNEL" = staging ] && [ "$VERSION" != latest ]; then
    die "--version does not apply to --channel staging, which follows the staging tag"
  fi

  [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ || $VERSION == latest ]] ||
    die "--version must be X.Y.Z or latest, got: $VERSION"

  if [ -n "$DOMAIN" ]; then
    [[ $DOMAIN =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] ||
      die "--domain must be a bare hostname like chat.example.com, got: $DOMAIN"
    ACME_EMAIL="${ACME_EMAIL:-admin@$DOMAIN}"
  fi
  [ -n "$DOMAIN" ] || die "--domain is required for a first install"
  [[ $SSH_HOST =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] ||
    die "--ssh-host must be a bare hostname like chat.example.com, got: $SSH_HOST"
  [[ $SSH_PORT_RANGE =~ ^([0-9]{1,5})-([0-9]{1,5})$ ]] ||
    die "--ssh-port-range must be FIRST-LAST, got: $SSH_PORT_RANGE"
  local ssh_first="${BASH_REMATCH[1]}" ssh_last="${BASH_REMATCH[2]}"
  (( ssh_first >= 1 && ssh_last <= 65535 && ssh_first <= ssh_last )) ||
    die "--ssh-port-range must satisfy 1 <= FIRST <= LAST <= 65535, got: $SSH_PORT_RANGE"

  case "$(uname -m)" in
  x86_64 | amd64) ;;
  *) die "only linux/amd64 is published; this host reports $(uname -m)" ;;
  esac

  if [ "$DRY_RUN" = false ] && [ "$(id -u)" -ne 0 ]; then
    die "run as root: sudo $0 $*"
  fi
}

check_os() {
  [ -r /etc/os-release ] || die "/etc/os-release is missing; this is not Linux"
  # shellcheck disable=SC1091
  . /etc/os-release
  if [ "${ID:-}" != ubuntu ]; then
    warn "tested on Ubuntu; ${PRETTY_NAME:-this system} may need a different Docker repository"
  fi
}

resolve_version() {
  if [ "$CHANNEL" = staging ]; then
    VERSION=staging
    return
  fi

  if [ "$VERSION" != latest ]; then
    return
  fi

  local resolved
  resolved="$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
    "https://github.com/$REPO/releases/latest" 2>/dev/null)" ||
    die "cannot reach github.com to resolve the latest release; pass --version X.Y.Z"
  VERSION="${resolved##*/tag/v}"

  [[ $VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] ||
    die "could not read a version from $resolved; pass --version X.Y.Z"
}

# The two images this channel pulls. GHCR paths are lowercase; the GitHub slug is not.
resolve_images() {
  local registry tag
  registry="ghcr.io/${REPO,,}"
  tag="$VERSION"
  [ "$CHANNEL" = staging ] && tag=staging

  IMAGE="$registry:$tag"
  WORKSPACE_IMAGE="$registry/workspace:$tag"
  CIPHERGATE_IMAGE="$registry/ciphergate:$tag"
}

install_docker() {
  step "Docker"
  if docker compose version >/dev/null 2>&1; then
    log "already installed: $(docker --version)"
    return
  fi

  log "installing Docker from download.docker.com"
  export DEBIAN_FRONTEND=noninteractive
  run apt-get update -qq
  run apt-get install -y -qq ca-certificates curl gnupg
  run install -m 0755 -d /etc/apt/keyrings

  if [ "$DRY_RUN" = false ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc ||
      die "cannot download the Docker signing key"
    chmod a+r /etc/apt/keyrings/docker.asc
    printf 'deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu %s stable\n' \
      "${VERSION_CODENAME:-noble}" >/etc/apt/sources.list.d/docker.list
  fi

  run apt-get update -qq
  run apt-get install -y -qq docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin
  run systemctl enable --now docker
}

fetch_bundle() {
  step "Release bundle v$VERSION"

  local here
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  # Staging has no release bundle to download: nothing tags a staging commit, so the files have to be at hand.
  if [ "$CHANNEL" = staging ] && [ ! -f "$here/compose.yaml" ]; then
    die "a staging install has no bundle to download: run this from a checkout of main"
  fi

  run mkdir -p "$INSTALL_DIR"

  # A checkout keeps the bundle's files in two directories (deploy/ and infrastructure/); assemble the same flat layout
  # .github/workflows/bundle.yml builds, so a staging install and a release install have identical install directories.
  if [ -f "$here/compose.yaml" ] && [ -d "$here/../infrastructure/systemd" ]; then
    log "assembling the bundle from the checkout at $(cd "$here/.." && pwd)"
    run install -m 0755 "$here/install.sh" "$INSTALL_DIR/install.sh"
    run install -m 0644 "$here/compose.yaml" "$INSTALL_DIR/compose.yaml"
    run install -m 0644 "$here/.env.example" "$INSTALL_DIR/.env.example"
    run install -m 0755 "$here/../infrastructure/cake-updater.sh" "$INSTALL_DIR/updater.sh"
    run install -m 0644 "$here/../infrastructure/systemd/cake-updater.socket" "$INSTALL_DIR/cake-updater.socket"
    run install -m 0644 "$here/../infrastructure/systemd/cake-updater@.service" "$INSTALL_DIR/cake-updater@.service"
    return
  fi

  # Running from an unpacked bundle (the install directory itself, or the tarball already downloaded) means the files
  # are right here; otherwise fetch them.
  if [ -f "$here/compose.yaml" ]; then
    log "using the bundle beside this script ($here)"
    if [ "$here" != "$INSTALL_DIR" ]; then
      run cp -a "$here/." "$INSTALL_DIR/"
    fi
    run chmod 0755 "$INSTALL_DIR/install.sh" "$INSTALL_DIR/updater.sh"
    return
  fi

  local url="https://github.com/$REPO/releases/download/v$VERSION/cake-deploy-v$VERSION.tar.gz"
  log "downloading $url"
  if [ "$DRY_RUN" = true ]; then
    printf '   would: download and unpack into %s\n' "$INSTALL_DIR"
    return
  fi

  local tmp
  tmp="$(mktemp -d)"
  curl -fsSL "$url" -o "$tmp/bundle.tar.gz" || {
    rm -rf "$tmp"
    die "cannot download $url"
  }
  tar -xzf "$tmp/bundle.tar.gz" -C "$INSTALL_DIR" --no-same-owner
  rm -rf "$tmp"
  chmod 0755 "$INSTALL_DIR/install.sh" "$INSTALL_DIR/updater.sh"
}

prepare_host() {
  step "State directory"
  log "$STATE_DIR"
  run mkdir -p "$STATE_DIR/traefik" "$STATE_DIR/workspaces" "$STATE_DIR/backups"
  run chmod 0750 "$STATE_DIR"

  # The updater socket's group. The backend container runs with this gid and is
  # the only unprivileged writer on the socket.
  if ! getent group "$SOCKET_GROUP" >/dev/null 2>&1; then
    log "creating group $SOCKET_GROUP ($SOCKET_GID)"
    run groupadd --system --gid "$SOCKET_GID" "$SOCKET_GROUP"
  fi
  run mkdir -p "$SOCKET_DIR"
}

# What .env records as the running version: the release, or nothing for staging, which follows a moving tag and has no
# version to compare against. The backend refuses anything that is not X.Y.Z, so "staging" must not reach it.
env_version() {
  if [ "$CHANNEL" = staging ]; then printf ''; else printf '%s' "$VERSION"; fi
}

write_env() {
  step "Environment"
  local env_file="$STATE_DIR/.env"

  if [ -f "$env_file" ]; then
    log "keeping the existing $env_file (secrets are never regenerated)"
  else
    log "writing $env_file"
    if [ "$DRY_RUN" = false ]; then
      local password secret_key
      password="$(openssl rand -hex 32)"
      secret_key="$(openssl rand -hex 32)"
      (
        umask 077
        cat >"$env_file" <<EOF
INSTALL_DIR=$INSTALL_DIR
STATE_DIR=$STATE_DIR
DOMAIN=$DOMAIN
CAKE_SSH_HOST=$SSH_HOST
CAKE_SSH_PORT_RANGE=$SSH_PORT_RANGE
ACME_EMAIL=$ACME_EMAIL
POSTGRES_DB=cake
POSTGRES_USER=cake
POSTGRES_PASSWORD=$password
CAKE_VERSION=$(env_version)
CAKE_CHANNEL=$CHANNEL
CAKE_IMAGE=$IMAGE
CAKE_WORKSPACE_IMAGE=$WORKSPACE_IMAGE
CAKE_CIPHERGATE_IMAGE=$CIPHERGATE_IMAGE
# Seals the second-factor secrets. Regenerating it makes every enrolled authenticator unreadable.
SECRET_KEY=$secret_key
EOF
      )
    fi
  fi

  # Rewritten every run, so re-running with --channel switches what the stack pulls. An .env from before the
  # channels existed gains the keys here.
  if [ "$DRY_RUN" = false ]; then
    set_env "$env_file" CAKE_VERSION "$(env_version)"
    set_env "$env_file" CAKE_CHANNEL "$CHANNEL"
    set_env "$env_file" CAKE_IMAGE "$IMAGE"
    set_env "$env_file" CAKE_WORKSPACE_IMAGE "$WORKSPACE_IMAGE"
    set_env "$env_file" CAKE_CIPHERGATE_IMAGE "$CIPHERGATE_IMAGE"
    set_env "$env_file" CAKE_SSH_HOST "$SSH_HOST"
    set_env "$env_file" CAKE_SSH_PORT_RANGE "$SSH_PORT_RANGE"
  fi
}

# Secrets that exist exactly once (the first admin password, the CipherGate admin key), root-only. Appended, never
# rewritten, so a later run cannot erase what an earlier one recorded.
CREDENTIALS_FILE="$STATE_DIR/first-run-credentials"

record_credential() {
  (
    umask 077
    printf '%s: %s
' "$1" "$2" >>"$CREDENTIALS_FILE"
  )
}

compose() {
  docker compose --env-file "$STATE_DIR/.env" -f "$INSTALL_DIR/compose.yaml" "$@"
}

# The secrets store. Nothing about it is pre-required: the keyfile is generated here, `init` creates the
# database and the admin consumer, and a reader consumer is created for the backend. The admin key is
# printed once and never stored; the reader key goes into .env, which is why the whole stack needs exactly
# one bootstrap secret of its own.
#
# The keyfile is the root of trust for every value in the store: whoever can read it can read every
# secret. It is generated once and never rotated by this script, because rotating it does not re-encrypt
# anything.
provision_secrets() {
  step "Secrets store"
  local data_dir="$STATE_DIR/ciphergate"
  local env_file="$STATE_DIR/.env"
  local consumer="cake-backend"
  # Compose interpolates the whole file before it runs a single service, and the app service requires
  # CIPHERGATE_TOKEN with `:?`. Until the consumer below exists there is no real key, so these two CLI
  # calls carry a placeholder in the environment, which takes precedence over the env file.
  local pending_token="not-created-yet"

  run mkdir -p "$data_dir"
  run chown 1000:1000 "$data_dir"
  run chmod 0700 "$data_dir"

  if [ -f "$data_dir/gateway.key" ]; then
    log "keeping the existing $data_dir/gateway.key"
  else
    log "generating $data_dir/gateway.key — back it up separately from the database"
    if [ "$DRY_RUN" = false ]; then
      (
        umask 077
        head -c 32 /dev/urandom | base64 >"$data_dir/gateway.key"
      )
      chown 1000:1000 "$data_dir/gateway.key"
      chmod 0600 "$data_dir/gateway.key"
    fi
  fi

  if [ -f "$data_dir/gateway.db" ]; then
    log "keeping the existing $data_dir/gateway.db"
  else
    log "initialising the database"
    if [ "$DRY_RUN" = false ]; then
      local admin_key
      admin_key="$(CIPHERGATE_TOKEN="$pending_token" compose run --rm --no-deps --entrypoint gateway ciphergate init | tail -n1)"
      # The store keeps no copy, so this is the only one. It goes into the root-only credentials file next to the first
      # admin password, for the operator to move into a password manager and then delete.
      record_credential "CipherGate admin API key" "$admin_key"
      log "admin API key written to $CREDENTIALS_FILE (move it somewhere safe, then delete the file)"
    fi
  fi

  if grep -q '^CIPHERGATE_TOKEN=' "$env_file" 2>/dev/null; then
    log "keeping the existing backend consumer key"
  else
    log "creating the backend reader consumer ($consumer)"
    if [ "$DRY_RUN" = false ]; then
      local token
      if ! token="$(CIPHERGATE_TOKEN="$pending_token" compose run --rm --no-deps --entrypoint gateway ciphergate consumer add "$consumer" | tail -n1)"; then
        die "could not create the '$consumer' consumer — if it already exists, rotate it with 'docker compose exec ciphergate gateway consumer rotate-key $consumer' and write the key into $env_file as CIPHERGATE_TOKEN"
      fi
      (
        umask 077
        set_env "$env_file" CIPHERGATE_TOKEN "$token"
      )
    fi
  fi
}

start_stack() {
  step "Stack"
  run compose pull --quiet
  run compose up -d --remove-orphans
}

# Two minutes: the first boot runs every schema migration, and Postgres and the secrets store come up before the app.
wait_for_app() {
  local _
  for _ in $(seq 1 60); do
    if compose exec -T app node -e "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  die "the app did not answer /health within two minutes; see: docker compose -f $INSTALL_DIR/compose.yaml logs app"
}

# The first sign-in. Without it the install is in single-user mode, where every request is the owner holding every
# permission, which is no state for a public address. The password is generated here and handed to the app on stdin;
# it is written only to the root-only credentials file. An owner that already has a password is left alone.
bootstrap_admin() {
  step "First admin"
  if [ "$DRY_RUN" = true ]; then
    printf '   would: create the admin account %s and write its password to %s
' "$ADMIN_USER" "$CREDENTIALS_FILE"
    return
  fi

  wait_for_app

  local password outcome
  password="$(openssl rand -base64 33 | tr -d '/+=
' | cut -c1-28)"
  outcome="$(printf '%s
' "$password" | compose exec -T app node dist/bootstrap-admin.js "$ADMIN_USER")" ||
    die "could not create the admin account: $outcome"

  case "$outcome" in
  created)
    record_credential "Admin username" "$ADMIN_USER"
    record_credential "Admin password" "$password"
    log "created the admin account '$ADMIN_USER'; its password is in $CREDENTIALS_FILE"
    ;;
  exists) log "the admin account already has a password; nothing changed" ;;
  *) die "unexpected answer from bootstrap-admin: $outcome" ;;
  esac
}

install_units() {
  step "Update socket"
  run install -m 0644 "$INSTALL_DIR/cake-updater.socket" /etc/systemd/system/cake-updater.socket
  run install -m 0644 "$INSTALL_DIR/cake-updater@.service" /etc/systemd/system/cake-updater@.service
  run systemctl daemon-reload
  run systemctl enable --now cake-updater.socket
}

summary() {
  step "Done"
  log "channel:   $CHANNEL"
  log "version:   $VERSION"
  log "install:   $INSTALL_DIR"
  log "state:     $STATE_DIR"
  log "secrets:   $STATE_DIR/ciphergate (keyfile: gateway.key, back it up)"
  if [ -f "$CREDENTIALS_FILE" ]; then
    log "sign-in:   $CREDENTIALS_FILE (root only; move its contents to a password manager, then delete it)"
  fi
  if [ -n "$DOMAIN" ]; then
    log "url:       https://$DOMAIN (once DNS points here and 443 is open)"
  fi
  log "ssh:       $SSH_HOST, TCP ports $SSH_PORT_RANGE"
  cat <<EOF

Next, if this is a fresh host:
  - point the domain's A/AAAA record at this server
  - allow 80/tcp and 443/tcp, and 22/tcp if you use a firewall
  - allow TCP ports ${SSH_PORT_RANGE} for workspace SSH access
  - copy the secrets keyfile somewhere safe, away from the database: without it the
    store's contents cannot be decrypted, and a copy beside the database is one leak
    away from handing over every credential
EOF
  printf '  - upgrade: %s/install.sh --version X.Y.Z, or over the socket\n' "$INSTALL_DIR"
}

main() {
  parse_args "$@"
  validate "$@"
  check_os
  resolve_version
  resolve_images
  log "installing Cake $CHANNEL $VERSION into $INSTALL_DIR"
  install_docker
  fetch_bundle
  prepare_host
  write_env
  provision_secrets
  start_stack
  bootstrap_admin
  install_units
  summary
}

main "$@"
