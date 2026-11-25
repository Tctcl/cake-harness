---
title: Workspaces
description: Understand Cake workspaces, their isolated containers, provider access, and browser terminals.
---

A workspace is the boundary around a piece of work. It groups conversations and agent profiles, decides which provider keys and models may be used, and provides the container where coding tools run.

## General and container-backed workspaces

| | General | A workspace you create |
| --- | --- | --- |
| Container | None | One Docker container owned by the workspace |
| File and shell tools | Not available | Run through pi-env inside the container |
| Environment-free tools | `web_fetch` | Available when granted |
| Browser terminal | No container terminal | PTY inside the workspace container |
| Provider setup | Can use the owner's stored provider access | Link keys and allow models explicitly |
| Initial agents | **General**, allow-all (only `web_fetch` is available here) | **Build**, allow-all; **Plan**, with `read` and `web_fetch` |

`web_fetch` retrieves public HTTP(S) resources and refuses private addresses. It is not web search and does not turn General into a shell on the host.

## A workspace container

For a container-backed workspace, `read`, `write`, `edit`, and `bash` execute through a pi-env daemon in that workspace's Docker container. No per-tool or per-workspace host ports are opened. The agent harness asks the daemon to perform the operation; tools are not silently executed in the backend process.

The container joins the `cake-workspaces` Docker network. On that network it can reach the Cake app, but it does not join the database, Docker API, or secrets networks. This keeps those services out of the workspace's normal network reach.

The workspace image comes from `WORKSPACE_IMAGE`. A production install sets it to the released `ghcr.io/tctcl/cake-harness/workspace` image at the same version as the app.

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
