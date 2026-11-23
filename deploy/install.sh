#!/usr/bin/env bash
#
# Installs or updates one self-hosted tctcl-platform instance.
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

REPO="Tctcl/tlabs-platform"
INSTALL_DIR="${TCTCL_INSTALL_DIR:-/opt/tctcl-platform}"
STATE_DIR="${TCTCL_STATE_DIR:-/var/lib/tctcl-platform}"

# Fixed so the container user can be given the same gid by the backend image.
SOCKET_GROUP="tctcl-updater"
SOCKET_GID=1001
SOCKET_DIR="/run/tctcl"

DRY_RUN=false
VERSION="latest"
# Which release channel this install follows. `production` pins a released version; `staging` tracks the moving
# `staging` tag, which every merge to main overwrites. A `dev` install is a checkout and `pnpm dev`, not this script.
CHANNEL="production"
IMAGE=""
WORKSPACE_IMAGE=""
DOMAIN="${TCTCL_DOMAIN:-}"
ACME_EMAIL=""

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
Installs or updates one self-hosted tctcl-platform instance.

  --version X.Y.Z     release to install (default: latest)
  --channel NAME      production or staging (default: production)
  --domain HOST       hostname to serve; required for a first install
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
    --acme-email)
      ACME_EMAIL="${2:-}"
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

validate() {
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

  # Running from an unpacked bundle (a git checkout, or the tarball already
  # downloaded) means the files are right here; otherwise fetch them.
  if [ -f "$here/compose.yaml" ]; then
    log "using the bundle beside this script ($here)"
    if [ "$here" != "$INSTALL_DIR" ]; then
      run cp -a "$here/." "$INSTALL_DIR/"
    fi
    run chmod 0755 "$INSTALL_DIR/install.sh" "$INSTALL_DIR/updater.sh"
    return
  fi

  local url="https://github.com/$REPO/releases/download/v$VERSION/tctcl-deploy-v$VERSION.tar.gz"
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

write_env() {
  step "Environment"
  local env_file="$STATE_DIR/.env"

  if [ -f "$env_file" ]; then
    log "keeping the existing $env_file (secrets are never regenerated)"
  else
    [ -n "$DOMAIN" ] || die "--domain is required for a first install"
    log "writing $env_file"
    if [ "$DRY_RUN" = false ]; then
      local password
      password="$(openssl rand -hex 32)"
      (
        umask 077
        cat >"$env_file" <<EOF
INSTALL_DIR=$INSTALL_DIR
STATE_DIR=$STATE_DIR
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
POSTGRES_DB=tctcl
POSTGRES_USER=tctcl
        POSTGRES_PASSWORD=$password
TCTCL_VERSION=$VERSION
TCTCL_CHANNEL=$CHANNEL
TCTCL_IMAGE=$IMAGE
TCTCL_WORKSPACE_IMAGE=$WORKSPACE_IMAGE
EOF
      )
    fi
  fi

  # Rewritten every run, so re-running with --channel switches what the stack pulls. An .env from before the
  # channels existed gains the keys here.
  if [ "$DRY_RUN" = false ]; then
    set_env "$env_file" TCTCL_VERSION "$VERSION"
    set_env "$env_file" TCTCL_CHANNEL "$CHANNEL"
    set_env "$env_file" TCTCL_IMAGE "$IMAGE"
    set_env "$env_file" TCTCL_WORKSPACE_IMAGE "$WORKSPACE_IMAGE"
  fi
}

compose() {
  docker compose --env-file "$STATE_DIR/.env" -f "$INSTALL_DIR/compose.yaml" "$@"
}

start_stack() {
  step "Stack"
  run compose pull --quiet
  run compose up -d --remove-orphans
}

install_units() {
  step "Update socket"
  run install -m 0644 "$INSTALL_DIR/tctcl-updater.socket" /etc/systemd/system/tctcl-updater.socket
  run install -m 0644 "$INSTALL_DIR/tctcl-updater@.service" /etc/systemd/system/tctcl-updater@.service
  run systemctl daemon-reload
  run systemctl enable --now tctcl-updater.socket
}

summary() {
  step "Done"
  log "channel:   $CHANNEL"
  log "version:   $VERSION"
  log "install:   $INSTALL_DIR"
  log "state:     $STATE_DIR"
  if [ -n "$DOMAIN" ]; then
    log "url:       https://$DOMAIN (once DNS points here and 443 is open)"
  fi
  cat <<'EOF'

Next, if this is a fresh host:
  - point the domain's A/AAAA record at this server
  - allow 80/tcp and 443/tcp, and 22/tcp if you use a firewall
EOF
  printf '  - upgrade: %s/install.sh --version X.Y.Z, or over the socket\n' "$INSTALL_DIR"
}

main() {
  parse_args "$@"
  validate "$@"
  check_os
  resolve_version
  resolve_images
  log "installing tctcl-platform $CHANNEL $VERSION into $INSTALL_DIR"
  install_docker
  fetch_bundle
  prepare_host
  write_env
  start_stack
  install_units
  summary
}

main "$@"
