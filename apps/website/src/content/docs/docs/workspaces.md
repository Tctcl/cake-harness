---
title: Workspaces
description: Understand Cake workspaces, their isolated containers, provider access, and browser terminals.
---

A workspace is the boundary around a piece of work. It groups conversations and agent profiles, decides which provider keys and models may be used, and provides the container where coding tools run.

## General and container-backed workspaces

| | General | A workspace you create |
| --- | --- | --- |
| Container | One for skills, MCP servers and user access | One Docker container owned by the workspace |
| File and shell tools | Not available to the agent | Run through pi-env inside the container |
| Environment-free tools | `web_fetch`, `codemode`, `ask_user` | Available when granted |
| Browser terminal | PTY inside General's container | PTY inside the workspace container |
| Provider setup | Can use the owner's stored provider access | Link keys and allow models explicitly |
| Initial agents | **General**, allow-all (environment-free tools only) | **Build**, allow-all; **Plan**, with `read` and `web_fetch` |

`web_fetch` retrieves public HTTP(S) resources and refuses private addresses. It is not web search and does not turn General into a shell on the host.

## A workspace container

Outside General, `read`, `write`, `edit`, and `bash` execute through a pi-env daemon in that workspace's Docker container. General's container is reserved for skills, MCP servers and user terminals; its agent has no shell or file tools. No per-tool or per-workspace host ports are opened. The agent harness asks the daemon to perform the operation; tools are not silently executed in the backend process.

The container joins the `cake-workspaces` Docker network. On that network it can reach the Cake app, but it does not join the database, Docker API, or secrets networks. This keeps those services out of the workspace's normal network reach.

The workspace image comes from `WORKSPACE_IMAGE`. A production install sets it to the released `ghcr.io/tctcl/cake-harness/workspace` image at the same version as the app.

The **Environment** tab reports running, stopped, or missing state; starts, stops, and restarts the container; samples CPU, memory, network, and disk use; opens its terminal; and provides SSH configuration, a VS Code Remote-SSH link, and a live list of listening development ports. SSH uses a stable host port assigned to the environment. The owner's public keys are written to the container when it starts and when keys are added or removed.

## Persistent tooling

The image includes pnpm (through Corepack), GitHub CLI, ripgrep, jq, unzip, and a C/C++ build toolchain. The development user's npm global prefix is `/home/dev/.local`, so `npm install --global <package>` works without sudo and survives container recreation. The whole `/home/dev` directory is a named volume, including VS Code's server and package-manager caches; the container's root filesystem is not persistent.

Use **Environment → Tooling** to add or remove apt and npm packages. Choose an exact package version or leave `latest`, then save and restart. Apt packages are installed together on every boot because they live on the root filesystem. Global npm packages are installed only when missing because their files persist on the home volume. A failed package does not prevent the others or SSH from starting; the table shows the last reported installed, failed, or missing state and any failure text.

For GitHub access, add a **GitHub token** under **Settings → Credentials**. Set your commit name and email under **Settings → Account → Git identity**. On the next container start, Cake writes git's identity and GitHub credential helper plus GitHub CLI authentication for `gh` and Git HTTPS operations. Secrets are never returned by the credentials API.

See [Connect with SSH and VS Code](/docs/connect-with-ssh-and-vscode) for setup steps and port forwarding.

## Tools belong to each agent

The tool catalog syncs from the harness registry automatically at startup. On the workspace's **Agents** tab, each profile either enables **All tools available here** or selects exactly the tools it may use. There is no separate workspace tool ceiling.

Every new workspace starts with:

- **Build**, the default agent, with every available tool;
- **Plan**, a read-only agent granted exactly `read` and `web_fetch`.

You can rename and reconfigure these profiles or add others, such as a **Review** agent with only `read`. Tools that need a container are marked unavailable in General. See [Agents](/docs/agents) for the profile fields and planning instructions.

## Providers and models

The **Providers** tab links stored OpenCode Go keys to the workspace and allow-lists models. Agent model and key choices must fit those rules. A new workspace starts empty rather than inheriting every credential by default.

The provider key remains a stored credential; linking it does not copy its plaintext into the workspace configuration. Stored provider keys are encrypted with the installation's secret-box key.

## Terminal lifecycle

A browser terminal attaches with `docker exec` and a TTY to the workspace container. It uses the container's shell and user, not a host shell.

- One client may attach to a terminal session at a time; open another session for another tab.
- Reattaching replays the configured scrollback.
- Closing a view leaves the process running until the session is reaped or the backend restarts.
- The default idle timeout is 30 minutes; the default maximum is eight sessions per container.

Terminal sessions are in memory and do not survive a backend restart. Durable chat history is separate and remains in Postgres.
