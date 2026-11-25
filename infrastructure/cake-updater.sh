#!/usr/bin/env bash
#
# One connection on /run/cake/updater.sock.
#
#   in:   UPDATE 1.2.3
#   out:  progress lines, then a final OK line or ERR line
#
# Started by cake-updater@.service (socket activation with Accept=yes): systemd
# owns the listening socket, accepts the connection, and binds this process's
# stdin and stdout to it. Journald holds the failures; the update log holds the
# installer's output.
#
# The backend never runs docker commands itself. It writes one line here, and the
# privileged part stays on the host where journalctl and this file can see it.
#
set -uo pipefail

INSTALL_SCRIPT="${CAKE_INSTALL_SCRIPT:-/opt/cake-harness/install.sh}"
STATE_DIR="${CAKE_STATE_DIR:-/var/lib/cake-harness}"
LOG="$STATE_DIR/updater.log"
LOCK="/run/cake/updater.lock"

fail() {
  printf 'ERR %s\n' "$*"
  exit 1
}

[ -x "$INSTALL_SCRIPT" ] || fail "missing installer: $INSTALL_SCRIPT"
[ -d "$STATE_DIR" ] || fail "missing state directory: $STATE_DIR"

IFS=' ' read -r verb version _ || true

[ -n "${verb:-}" ] || fail "empty request"
[ "$verb" = "UPDATE" ] || fail "unknown command: $verb"

# The value reaches a root shell command line, so it is a strict semver or it is
# nothing at all. No ranges, no prerelease tags, no whitespace.
[[ ${version:-} =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "invalid version: ${version:-}"

# One update at a time: a second request waits for the first instead of racing it.
exec 9>"$LOCK" || fail "cannot open $LOCK"
flock -w 600 9 || fail "another update is already running"

printf 'START %s\n' "$version"

# Streaming to the socket keeps a watcher informed; the tee keeps an audit trail,
# because stdout is the connection and never reaches the journal.
if "$INSTALL_SCRIPT" --version "$version" 2>&1 | tee -a "$LOG"; then
  printf 'OK %s\n' "$version"
else
  fail "install failed, see $LOG"
fi
