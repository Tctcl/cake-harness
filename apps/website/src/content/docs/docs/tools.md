---
title: Tools
description: Learn where Cake tools execute and how workspace ceilings and agent grants fit together.
---

Cake separates a workspace's tool ceiling from an agent's grants. A run receives the agent's selected capabilities, limited by what the workspace allows.

## What runs where

| Tool | Container-backed workspace | General workspace |
| --- | --- | --- |
| `read` | Reads through pi-env in the workspace container | Not granted |
| `write` | Writes through pi-env in the workspace container | Not granted |
| `edit` | Edits through pi-env in the workspace container | Not granted |
| `bash` | Runs through pi-env in the workspace container | Not granted |
| `web_fetch` | Retrieves a public URL when granted | Available as the environment-free tool |

A pi-env daemon inside the workspace container performs file and shell operations. Cake does not publish a container port for each tool call. The workspace container does not join the database, Docker socket proxy, or secrets networks.

General has no container. It receives only environment-free tools, currently `web_fetch`; it is not a host shell and cannot use the coding tools against the server filesystem. `web_fetch` refuses private addresses to keep it from becoming a proxy into the install's private network. It fetches known URLs rather than performing web search.

## Configure a new workspace

A newly created workspace has no tool grants until you configure them:

1. Open the workspace's **Tools** tab.
2. Select **Sync from registry**. This loads the registry's current capabilities into the workspace manager.
3. Select the capabilities the workspace may use, such as `read`, `write`, `edit`, and `bash`.
4. Or enable **Reach every capability** when you deliberately do not want a per-tool ceiling.
5. On **Agents**, select each profile's grants within that ceiling.

If a profile should plan but never change code, grant `read` and `web_fetch` only. If it should implement and verify changes, add `write`, `edit`, and `bash` deliberately.

## Two levels of permission

```text
registry capabilities
        ↓ Sync from registry
workspace ceiling (selected tools, or Reach every capability)
        ↓ per-agent selection
agent profile used by a conversation
        ↓
tool call shown in the live transcript
```

A capability selected on an agent cannot exceed the workspace ceiling. Removing a workspace capability therefore matters even if an older profile still names it.

Provider permissions are separate: the **Providers** tab controls keys and models, not tools. Conversation model/key switches do not change tool grants.

## What is not connected yet

MCP servers and skills/prompt grants reaching runs are planned. Web search is also planned. Saving related configuration is not a claim that today's run consumed it. The implemented tools above execute as described and appear in the chat transcript.
