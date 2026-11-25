---
title: First steps
description: Sign in, add a provider key, configure a workspace, and start your first Cake conversation.
---

After installation, open the HTTPS URL for your domain. Keep the generated owner credentials in a password manager and remove `/var/lib/cake-harness/first-run-credentials` from the server.

## 1. Sign in

Use the owner username and password created by the installer. Cake is single-user: the installer enables password sign-in for this owner, and additional accounts are not available yet.

For another factor, open **Settings → Account**, enrol an authenticator with the displayed TOTP URI, and confirm a code. Two-factor authentication is active only after that confirmation.

## 2. Add an OpenCode Go key

Open **Settings → Credentials** and add an **OpenCode Go API key**. Cake validates the key against the provider's usage endpoint before storing it, then loads the models that key serves. Invalid or uncovered keys are rejected rather than saved.

Accepted keys are encrypted before they reach the database. A key added here is not automatically available to every new workspace; link it explicitly in the next step.

## 3. Create a workspace

Use **New workspace…** in the sidebar. Cake creates the workspace, its container record, and an initial **Assistant** agent.

The built-in **General** workspace is different. It has no container and only environment-free tools: currently `web_fetch`, which refuses private addresses. Use a container-backed workspace for reading project files, editing, or running shell commands.

## 4. Allow providers and models

Open the workspace's **Providers** tab:

1. Under **Keys**, link each OpenCode Go key this workspace may spend.
2. Under **Models**, allow the models its agents may use, or choose **Allow every model**.

A workspace's usable models are the union of the models offered by its linked keys, narrowed by its model allow-list. Removing a key does not silently substitute another key for an agent that explicitly used it.

## 5. Grant tools

A new workspace starts with **no tool grants**. Open its **Tools** tab and:

1. Choose **Sync from registry** to load the available capabilities.
2. Select the tools this workspace may use. For a normal coding agent, select `read`, `write`, `edit`, and `bash` as needed.
3. Alternatively, enable **Reach every capability** to remove the per-tool ceiling.
4. Open **Agents** and give each agent only the tools it should use within the workspace ceiling.

For a read-only planner, grant only `read` and `web_fetch`. The [Plan agent example](/docs/agents#example-a-plan-agent) includes a complete prompt.

## 6. Configure an agent

On the workspace's **Agents** tab, set:

- a model and the provider key that pays for it;
- a thinking level (`off`, `low`, `medium`, `high`, `xhigh`, or `max`);
- a system prompt and standing instructions;
- the agent's tool grants.

Cake rejects a key not linked to the workspace, an unknown model, or a model outside the workspace's allow-list instead of saving a profile that cannot run.

## 7. Start a conversation

Select **+** beside the workspace. If more than one agent is available, choose which profile should answer. Enter sends a message; Shift+Enter inserts a newline.

While the answer streams, the transcript shows thinking, tool calls and results within the turn, and compaction lines. Use the conversation controls to switch model, thinking level, or provider key for this chat without editing the underlying profile.

Conversations are stored with pi-durable in Postgres. Reloading or restarting the service does not discard them.

## 8. Open a terminal

The workspace's terminal is a real PTY inside its container. Closing a terminal view does not stop a running build; reattaching replays retained scrollback. A terminal session accepts one attached client at a time.

Defaults are eight sessions per workspace container, 256 KiB of replayed scrollback per session, and reaping after 30 minutes without a client. Backend restarts end terminal sessions even though chat conversations remain durable. General has no container and therefore no container terminal.
