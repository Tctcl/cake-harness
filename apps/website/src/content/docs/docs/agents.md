---
title: Agents
description: Configure Cake agent profiles and build a read-only Plan agent with its own prompt and tool grants.
---

An agent is a reusable profile inside a workspace. Profiles let the same Pi harness act as a builder, reviewer, researcher, or planner without changing workspaces or rewriting a global prompt.

## Profile settings

| Setting | What it controls |
| --- | --- |
| Name and description | How the profile appears when starting a conversation |
| Model | The model the profile uses; it must be allowed by the workspace and served by a linked provider key |
| Provider key | The OpenCode Go key that pays for calls, or the workspace default |
| Thinking level | `off`, `low`, `medium`, `high`, `xhigh`, or `max` |
| System prompt | The profile's base behaviour and boundaries |
| Instructions | Standing instructions for its work |
| Tool grants | Every available tool, or exactly the capabilities this profile may use |

A model or key that the workspace does not permit is rejected when the profile is saved. Cake does not silently fall back to an unrelated credential. If no provider key reaches an agent, add one in **Settings → Credentials**, link it on **Providers**, and select an allowed model.

Changing a profile does not rewrite earlier transcript messages. For a one-chat change, use the conversation's model, thinking-level, and key controls instead of changing the profile itself.

## Example: a Plan agent

This profile inspects code and public documentation, then returns a plan. It cannot edit files or run shell commands.

### 1. Create the profile and select its tools

New container-backed workspaces already include a **Plan** profile with these grants. To make your own, open **Agents**, select **New agent**, and name it **Plan**. Turn off **All tools available here**, then grant only `read` and `web_fetch`. Do not grant `write`, `edit`, or `bash`.

The registry's tool catalog is synchronized at startup, so there is no manual sync step. Other agents in the same workspace can independently keep editing and shell tools.

### 2. Choose its run settings

Use a description such as “Inspect and plan without changing files.” Choose the model, thinking level, and provider key you want planning conversations to use. A higher thinking level can be useful, but it is not required.

### 3. Add the system prompt

```text
You are Plan, a read-only software planning agent.

Inspect the relevant code and configuration before proposing changes. Use read to
examine the workspace and web_fetch for specific public documentation URLs.
Never modify files, run shell commands, or claim to have done so.

Ask a question when a requirement changes the implementation materially.
Otherwise, return:
1. A short statement of the problem and the constraints you found.
2. The relevant existing files and behaviour.
3. An ordered implementation plan, small enough to verify step by step.
4. The tests and operational checks that would prove the change.
5. Risks, migrations, and explicitly out-of-scope work.

Do not invent APIs or files. Say what you could not inspect.
```

Add any repository-specific standing instructions separately. For example, point to the project's contributor guide or name the test command a future implementation agent should run; the Plan agent itself cannot execute that command without `bash`.

### 4. Use it

Start a conversation with **Plan** and ask for an implementation plan. The transcript still shows its thinking and every `read`/`web_fetch` call. When the plan is ready, start or switch to a conversation with a profile that has the editing and testing grants you want.

## Profiles versus conversation overrides

Use a **profile** for a durable role you will reuse. Use the **per-conversation controls** for a temporary change in model, thinking level, or provider key. The workspace's provider rules still provide the outer boundary for keys and models.
