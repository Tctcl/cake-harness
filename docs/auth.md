# Sign-in, roles and permissions

The backend resolves one identity per request and checks one permission per route.
This document is about how that works and what is deliberately not built yet.

## Single-user mode is the default

A fresh install has no accounts to sign in with. `app_settings.single_user` is
`true`, and in that mode:

- no cookie is read, and no session is created or expired;
- every request is the seeded owner row (`00000000-0000-4000-8000-000000000001`)
  holding **every** permission;
- `/auth/*` answers `404`, so nothing hints that accounts exist;
- the user, role and settings-management routes answer `404` as well — they are
  not merely hidden in the client.

This is the behaviour the app had before accounts existed, expressed as a
default rather than a hardcoded assumption. `GET /settings/public` is the only
unauthenticated read: the client cannot decide whether to draw a login screen
before it knows whether the install has accounts.

**An install turns it off once, for the owner alone.** The routes still resolve
the seeded owner for workspaces, agents, threads and environments, so a second
account would see the first one's material. Until ownership is per request:

- `node dist/bootstrap-admin.js <username>` (password on stdin) is the only way
  out of single-user mode. It gives the seeded owner a username, the `admin` role
  and a password, then sets `single_user` to `false`. `deploy/install.sh` runs it
  once inside the app container and writes the generated password to a root-only
  file. An owner that already has a password is left alone (`exists`), so
  re-running the installer never resets it.
- `PUT /settings` still refuses `{"singleUser": false}` and `POST /users` refuses
  every new account, both with `409 auth.accounts_pending`.

The rest of the model is in place, so per-user ownership is a change to the
handlers, not a redesign.

## Sessions

| | |
| --- | --- |
| Cookie | `cake_session`, `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` when `TRUST_PROXY=true` and the request is https |
| Token | 32 random bytes, base64url; only its SHA-256 is stored in `sessions` |
| Lifetime | 30 days, sliding — `last_seen_at` is written at most once a minute |
| Ends | logout, password change, role change, disable, reset, or either direction of the single-user switch |

Sign-in is `POST /auth/login { username, password }`. Passwords are hashed with
`scrypt` from `node:crypto` (per-password salt, `timingSafeEqual` comparison), so
there is no native dependency to keep current. A wrong username and a wrong
password answer identically, on purpose, and take as long: an unknown username is
still checked against a throwaway hash.

Ten failed sign-ins from one address within fifteen minutes answer
`429 auth.too_many_attempts` with `Retry-After` until the window passes
(`auth/login-throttle.ts`, in memory: one process serves an install). The address
is the one Fastify resolves, which is the client's own address only when
`TRUST_PROXY=true` makes it believe `X-Forwarded-For`. The production compose
file sets it, because Traefik is in front.

Passwords are 12 to 200 characters. Anything else answers
`400 auth.invalid_password`.

The client calls `GET /auth/session` on boot; it answers the same shape as
`GET /me`, so a reload does not guess.

## Half-signed-in sessions

A session row has `authenticated_at`. While it is `NULL` the session can reach a
few routes that finish signing in and nothing else — every other route answers
`401 auth.pending`. Three conditions leave a session in that state, in this
order:

1. `pending: 'password'` — the account was created or reset by an admin, and the
   password they chose is not the user's. Only `POST /auth/password/initial`.
2. `pending: 'totp-setup'` — the install requires a second factor and this
   account has none. Only `POST /auth/2fa/setup` and `POST /auth/2fa/enable`.
3. `pending: 'totp'` — an enrolled second factor has to be presented. Only
   `POST /auth/2fa/verify`.

The state is computed from the rows rather than stored, so an admin changing the
policy takes effect at the next sign-in without a migration.

## Second factor

TOTP (RFC 6238) via `otpauth`, 6 digits, 30 second period, one step of drift.
`POST /auth/2fa/setup` answers the base32 secret and an `otpauth://` URI; the
account is only considered protected after a code from it comes back to
`POST /auth/2fa/enable`.

The secret is sealed with AES-256-GCM under `SECRET_KEY` before it is stored, so
a database dump on its own is not a second factor as well. `SECRET_KEY` is
generated once by `install.sh` and must never be regenerated: a new key cannot
open what the old one sealed, and every enrolled authenticator is lost.

Users may turn their own second factor off with their password. Admins may reset
an account (`POST /users/:id/reset`), which sets a new password, clears the
secret and drops every session — that is the only account recovery.

## Permissions

Roles hold permissions; a role with `grants_all` holds every permission including
ones added later. A person's effective set is:

```text
(role ∪ their granted overrides) \ their denied overrides
```

A deny beats a grant from the same role, which is the only rule that makes "less
than the base role" mean anything. The list is `apps/backend/src/auth/permissions.ts`
and every name in it is checked by a route:

| Permission | What it allows |
| --- | --- |
| `workspaces.create` `agents.create` `environments.create` | building your own |
| `workspaces.manage_any` `agents.manage_any` `environments.manage_any` | the same, on someone else's |
| `tools.manage` `skills.manage` `mcp.manage` | the catalog the install shares |
| `updates.manage` | checking for and applying releases |
| `users.manage` `roles.manage` `settings.manage` | who else may sign in, and as what |

Ownership is **not** a permission. "This workspace is yours" is a column on a
row, so handlers scope their queries; a boolean cannot express it.

### Where it is enforced

A route declares `config: { permission }` and the actor hook refuses it before
the handler runs; `apps/backend/src/plugins/actor.ts` is the only place that
check lives. Marked today: `POST /updates`, `POST /workspaces`,
`POST /workspaces/:id/agents`, `POST /environments`, and — checked inside the
handler because the answer depends on the actor, not the route — `/settings`,
`/users` and `/roles`.

Every other route is signed-in only. Two groups are deliberately unmarked
until the next slice: the capability catalog writes (`tools.manage` and
friends), because a permission nothing can be denied by yet is a promise the
UI would draw and the backend would not keep, and the `manage_any` permissions,
because "someone else's" needs the ownership refactor to mean anything.

Two seeded roles: `admin` (`grants_all`) and `member` (the three `.create`
ones). Roles are read-only over HTTP for now — the editor that changes what a
role holds is the next slice, along with the owner scoping that unlocks
multi-user mode.

## Rules that protect the install from itself

- `SECRET_KEY` is required in production; development derives a throwaway one and
  says so once.
- The last admin cannot be demoted, disabled or deleted
  (`409 auth.last_admin`) — the settings screen must always have an owner.
- You cannot disable yourself, change your own role, or reset your own password.
- Turning single-user mode off requires the caller to have a password, and a
  confirmed second factor when the install requires one.
- Either direction of the single-user switch deletes every session.
