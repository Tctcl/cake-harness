---
title: Cake documentation
description: Install, operate, and use Cake, the self-hosted agent harness built on Pi.
---

Cake is an agent harness built on top of [Pi](https://pi.dev). It adds a web interface, workspaces with isolated Docker containers, and agent profiles. Pi has one agent profile; Cake lets you define your own, including a read-only planning agent that works like plan mode.

One install runs on your Linux server, behind your domain and a Let's Encrypt certificate. The browser interface works on phones as well as desktops. There is no hosted control plane and no vendor account to create.

:::note[Early software]
Cake is under active development. Its APIs and screens are expected to change. Follow a released version rather than `staging` when you want a stable install.
:::

## What works today

- **One-script installation and upgrades.** Docker Compose runs Cake, Postgres, Traefik, a secrets store, and narrowly scoped Docker socket proxies. Production installs pin a release; staging follows `main`.
- **Sign-in and account protection.** Password sign-in, a per-address sign-in throttle, cookie sessions, and optional TOTP two-factor authentication. An install has one owner account; multi-user is planned.
- **Workspaces and containers.** Each container-backed workspace isolates its files and tools. The browser terminal opens a PTY in that container. Workspace containers do not need published ports.
- **Agent profiles.** Set a model, provider key, thinking level, system prompt, instructions, and tool grants for each agent in a workspace.
- **Per-conversation controls.** Quickly switch model, thinking level, or provider key without editing the agent profile.
- **Visible, durable chat.** pi-durable stores conversations in Postgres. The interface streams thinking, tool calls within the turn, and compaction lines; conversations survive service restarts.
- **Provider credentials.** Add an OpenCode Go key, link it to selected workspaces, and allow selected models. Stored provider keys are encrypted.
- **Real tool grants.** Sync the registry on a workspace's **Tools** tab, choose its ceiling, and grant capabilities to agents. Container-backed agents run `read`, `write`, `edit`, and `bash` through a pi-env daemon in the workspace container.

The **General** workspace is deliberately different: its container serves skills, MCP servers and user terminals, while its agent receives only environment-free tools and no shell or file tools.

## What is not wired up yet

- MCP servers and skills/prompt grants do not reach runs yet. This is planned.
- Web search is planned. `web_fetch` retrieves a URL; it is not a search engine.
- Multi-user and an admin page are planned. Cake is single-user by default.

## Read next

1. [Requirements](/docs/requirements) covers the host, DNS, and ports.
2. [Install](/docs/install) installs a production or staging instance.
3. [First steps](/docs/first-steps) goes from sign-in to the first conversation.
4. [Using Cake](/docs/workspaces) explains workspaces, profiles, chat, and tools.
5. [Architecture](/docs/architecture) maps the services, networks, images, and state on disk.

The source and release notes are on [GitHub](https://github.com/Tctcl/cake-harness). The project's staging app is available at [cake.tctcl.de](https://cake.tctcl.de).
