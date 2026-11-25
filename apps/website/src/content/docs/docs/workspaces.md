---
title: Workspaces
description: Understand Cake workspaces, their isolated containers, provider access, and browser terminals.
---

A workspace is the boundary around a piece of work. It groups conversations and agent profiles, decides which provider keys and models may be used, and sets the ceiling for tool grants.

## General and container-backed workspaces

| | General | A workspace you create |
| --- | --- | --- |
| Container | None | One Docker container owned by the workspace |
| File and shell tools | Not available | Run through pi-env inside the container |
| Environment-free tools | `web_fetch` | Available when granted |
| Browser terminal | No container terminal | PTY inside the workspace container |
| Provider setup | Can use the owner's stored provider access | Link keys and allow models explicitly |
| Initial tool grants | `web_fetch` only | None until configured |

`web_fetch` retrieves public HTTP(S) resources and refuses private addresses. It is not web search and does not turn General into a shell on the host.

## A workspace container

For a container-backed workspace, `read`, `write`, `edit`, and `bash` execute through a pi-env daemon in that workspace's Docker container. No per-tool or per-workspace host ports are opened. The agent harness asks the daemon to perform the operation; tools are not silently executed in the backend process.

The container joins the `cake-workspaces` Docker network. On that network it can reach the Cake app, but it does not join the database, Docker API, or secrets networks. This keeps those services out of the workspace's normal network reach.

The workspace image comes from `WORKSPACE_IMAGE`. A production install sets it to the released `ghcr.io/tctcl/cake-harness/workspace` image at the same version as the app.

## Tools are a workspace ceiling

Creating a workspace does not implicitly grant every tool. On **Tools**, select **Sync from registry**, then allow the tools the workspace needs. Agent profiles can select from that set. **Reach every capability** is the explicit alternative to a selected ceiling.

This two-level arrangement lets one workspace contain, for example:

- an **Assistant** with `read`, `write`, `edit`, and `bash`;
- a **Plan** agent with only `read` and `web_fetch`;
- a **Review** agent with only `read`.

The names and prompts are yours. See [Agents](/docs/agents) for the profile fields and a worked planner.

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
