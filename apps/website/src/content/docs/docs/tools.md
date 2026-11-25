---
title: Tools
description: Learn where Cake tools execute and how agent grants work.
---

Each agent either receives every tool available in its workspace or exactly its selected grants. Coding tools require the workspace container; environment-free tools can also run in General.

## What runs where

| Tool | Container-backed workspace | General workspace |
| --- | --- | --- |
| `read` | Reads through pi-env in the workspace container | Unavailable |
| `write` | Writes through pi-env in the workspace container | Unavailable |
| `edit` | Edits through pi-env in the workspace container | Unavailable |
| `bash` | Runs through pi-env in the workspace container | Unavailable |
| `web_fetch` | Retrieves a public URL when granted | Available as the environment-free tool |

A pi-env daemon inside the workspace container performs file and shell operations. Cake does not publish a container port for each tool call. The workspace container does not join the database, Docker socket proxy, or secrets networks.

General has no container. It receives only environment-free tools, currently `web_fetch`; it is not a host shell and cannot use coding tools against the server filesystem. `web_fetch` refuses private addresses to keep it from becoming a proxy into the install's private network. It fetches known URLs rather than performing web search.

## Configure agents

The registry's tools are synchronized into the catalog automatically at startup. Every new container-backed workspace starts with **Build**, an allow-all default agent, and **Plan**, which is granted exactly `read` and `web_fetch`.

On the workspace's **Agents** tab:

1. Select a profile, or create one with **New agent**.
2. Leave **All tools available here** on to offer every tool that can run in this workspace.
3. Or turn it off and select individual grants. A planner normally needs only `read` and `web_fetch`; an implementation agent may also need `write`, `edit`, and `bash`.
4. Save the profile to write its grants.

In General, `read`, `write`, `edit`, and `bash` remain visible but are greyed out with **Needs a workspace container**. Disabled environment tools are never offered to a run, even if an old grant names them.

```text
harness registry
        ↓ automatic startup sync
agent profile: all available tools, or selected grants
        ↓ remove coding tools when no container is available
tools offered to the conversation
        ↓
tool call shown in the live transcript
```

Provider permissions are separate: the **Providers** tab controls keys and models, not tools. Conversation model/key switches do not change tool grants.

## What is not connected yet

MCP servers and skill grants reaching runs are planned. Web search is also planned. Saving related configuration is not a claim that today's run consumed it. The implemented tools above execute as described and appear in the chat transcript.
