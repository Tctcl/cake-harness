# Remote development environments

The goal this repository is building toward, written down so it can be reviewed
before it is implemented.

Status: **first slice built.** Sections 2, 4 and 9 partially exist in `apps/agent`:
a development image, public-key SSH, a bootstrap that reads the tooling and
credential documents, reports what is installed and plans the reconcile, and
credential materialisation. Installing, reporting to the backend, tunnels and the
workspace model do not exist. `infrastructure/` holds a single `.gitkeep`. The gap
between this document and the code is tracked in [`docs/deferred.md`](./deferred.md),
items 2 (grants do not yet drive the run), 3 (workspaces get no container) and 10
(`apps/agent` does not run the harness).

## Goal: a universal remote development environment

Build a universal Docker image that serves as the development environment for the
platform. The same environment is used by AI agents and by human developers.

The goal is isolated, persistent, fully functional development workspaces that the
backend provisions on demand.

### 1. Workspace concept

Each application workspace can request its own development environment.

- Each environment runs in its own Docker container.
- Environments are isolated from one another.
- Each environment has its own filesystem and installed tooling.
- Environments persist independently of agent sessions.
- Agents and developers can connect, disconnect and reconnect without losing
  their work.
- Multiple agents or users may work in the same workspace environment, subject to
  workspace permissions.

The environment must not be tied to a particular project, programming language or
agent.

### 2. Universal development image

One reusable, generic Docker image rather than separate images per language or
project.

The image provides the foundational environment; additional development tooling
is downloaded and installed dynamically at startup.

The environment should support a broad range of development technologies,
including but not limited to:

- Node.js, TypeScript and JavaScript
- Python
- Go
- Rust
- PHP
- Other languages and development tools as needed

A non-root development user is used. This user has sudo permissions so agents can
install additional system dependencies when necessary.

### 3. Dynamic tooling configuration

The backend database is the source of truth for the desired development
environment configuration.

Each environment retrieves its tooling configuration from the backend during
startup. The configuration contains exact tool versions, not floating version
requirements.

The container must:

- Retrieve the desired tooling configuration.
- Install missing tools and versions.
- Reconcile its installed tooling with the desired configuration.
- Report its actual installed tooling and versions to the backend.
- Notify the backend when new tooling is installed or relevant changes occur.

The backend maintains the desired configuration separately from the actual
installed state. The configuration stays extensible as new languages, runtimes and
tools are introduced.

### 4. Remote access

Every development container provides SSH access. SSH is a first-class part of the
environment, not an afterthought.

It must support:

- Interactive shell access.
- File access and manipulation.
- Remote development through Visual Studio Code Remote - SSH.
- SSH port forwarding and tunneling.
- Public-key-based authentication.

SSH access works for both AI agents and human developers, with appropriate
authentication and authorization.

**Where this stands.** The image implements its half: `apps/agent/Dockerfile`
installs `openssh-server`, runs it as the `dev` user, and `docker/sshd_config`
allows public keys and TCP forwarding while refusing passwords. The platform does
not publish the port yet: containers are created with no port bindings
(`apps/backend/src/environments/container-runtime.ts`), so
`GET /environments/:id/ssh` inspects the container, reports the mapping when one
exists and answers `null` when it does not. Tunnels are the agent process's, and
none exists, so `GET /environments/:id/ssh/tunnels` answers an empty list. Both
routes are honest about the gap rather than returning a command nobody can run;
`compose.dev.yml` is the only place port 22 is published today, on loopback.

### 5. Development server access

Developers must be able to reach HTTP services running inside their development
environment from their local machines.

If an agent starts a Vite development server on port 5173, that server is
reachable through a tunnel on the developer's own PC. This works for arbitrary
development ports and services, not only predefined applications.

Eventually the frontend displays active development ports and offers convenient
access to them.

### 6. Backend integration

The application backend manages the development environments. The backend:

- Provisions and removes containers.
- Starts, stops and restarts environments.
- Manages workspace isolation.
- Provides tooling configurations.
- Integrates with CipherGate for secrets management.
- Manages SSH access and credentials.
- Tracks environment status and installed tooling.
- Provides authorized access to agents and users.

The backend itself runs in Docker on the same host and is responsible for all
Docker operations, but it does not mount the Docker socket: it talks to a
read-write `docker-socket-proxy` over a private network, and Traefik gets a second,
read-only instance of the same proxy (`docs/deployment.md`). Development containers
receive neither the socket nor a route to either proxy.

The backend and development containers communicate through private Docker
networking. Workspace isolation must be maintained.

### 7. Security and isolation

Treat every development environment as potentially untrusted, because AI agents
can execute arbitrary commands and install software.

Requirements:

- No privileged containers.
- No host Docker socket access. The backend is not exempt from this: it reaches
  Docker only through the restricted proxy, which narrows the API surface but is
  not an isolation boundary.
- No unnecessary host filesystem mounts.
- Workspace-level isolation.
- SSH authentication through authorized keys.
- Secrets supplied through CipherGate, never baked into images.
- Appropriate resource limits.
- No unnecessary exposure of container ports to the public internet.

### 8. Design principles

- One universal, reusable base image.
- Dynamic, backend-controlled tooling configuration.
- Exact and reproducible tool versions.
- Persistent environments independent of agent sessions.
- SSH as the primary remote access mechanism.
- Support for VS Code Remote Development.
- Convenient local access to forwarded development ports.
- Strong workspace isolation.
- Keep the architecture extensible.

### 9. Credentials

Tooling has to arrive already authenticated: `gh` needs to know who it is, git
needs a credential helper for HTTPS pushes, npm needs a registry token. A
development environment where the first thing an agent does is `gh auth login` is
not usable.

Decisions taken:

- **Two documents, one request.** Desired tooling and credentials are separate
  documents because credentials rotate on a different clock than tooling and
  coupling them would make every token rotation trigger a full reconcile, but
  they arrive together in one manifest: two round trips at boot would only add
  a half-configured window.
- **The backend fetches and hands over.** CipherGate access never leaves the
  backend, so a development container never holds credentials for the secret
  store itself. The container receives resolved values for the workspace it
  belongs to, and nothing else.

Two channels, because env vars alone do not configure the tools that matter.
`gh` reads `GH_TOKEN` or `GITHUB_TOKEN`, but git over HTTPS still needs a
credential helper written into `~/.gitconfig`; npm reads `~/.npmrc`, cargo reads
`~/.cargo/credentials.toml`, ssh reads key files. So a credential entry carries an
env map *and* a list of files with explicit modes, and the bootstrap materialises
both.

Known cost: an env var is readable by every process in the container and is
inherited by every child, so an agent that runs `env`, or a log line that dumps
the environment, leaks the token into a transcript and from there into Postgres.
That is why credentials are written to `0600` files owned by the development user
and sourced by its profile, rather than exported into the bootstrap's own
environment, and why the actual-state report never echoes a credential value —
only which credential ids were applied.

One gap this leaves open: `~/.profile` is read by login shells, so
`ssh dev@host gh pr list` would run without the variables. Wiring the environment
for non-login shells is part of the next slice.

Status: both halves are implemented. `apps/backend/src/environments/manifest.ts`
builds the manifest from CipherGate through `apps/backend/src/secrets/ciphergate.ts`
and is served at `GET /environments/:id/manifest`; the container fetches it from
`DEV_ENV_MANIFEST_URL` and materialises it. A credential whose secret the store
will not hand over is left out of the manifest rather than failing the boot: a
workspace without `GH_TOKEN` is usable, a workspace that refuses to start is not.
Installing the tools those credentials belong to is still pending.

## Where this stands

Two halves meet here. The backend serves an environment's manifest at
`GET /environments/:id/manifest` — the tooling floor plus whatever credentials the
secrets store will hand over — and records what a container reports at
`PUT /environments/:id/state`, straight onto `dev_environments.reported_state`.
The container boots from that manifest (`DEV_ENV_MANIFEST_URL`), reads
`/var/lib/dev-env/installed.json` to tell an installed tool from an image one,
plans the reconcile work, materialises credentials as `0600` files and reports
what it found back.

`apps/agent/compose.dev.yml` runs the container without a backend, so no manifest
URL is set and the bootstrap is skipped: what remains is the image's floor over
SSH. The deployed stack passes `WORKSPACE_BACKEND_URL` and `WORKSPACE_NETWORK`, the
backend adds both to the container it creates, and the container joins
`tctcl-workspaces`, from where `app` is the only thing it can reach.

The next slice is the part that changes the machine: apply the plan instead of
logging it, and write what it installed into the record the next boot reads.

The outcome this is aiming at: a reusable remote development environment that
feels like a full Linux development machine per workspace, reachable by both AI
agents and human developers.
