---
title: Chat
description: Read Cake's streamed transcript and switch model, thinking level, or provider key per conversation.
---

Cake's chat is a live view of a durable Pi conversation. It is designed to show the work inside a turn, not just the final answer.

## Starting and returning to a conversation

Select **+** beside a workspace and choose an agent when asked. The conversation belongs to that workspace and starts with the selected agent profile.

Enter sends the composer; Shift+Enter adds a line break. Rename a conversation from its top bar. Returning to the thread or reloading the browser rejoins the stored transcript.

Conversations are persisted with pi-durable in Postgres. A service restart can interrupt active work, but it does not erase the conversation history. Browser terminal sessions have a different lifecycle and do end when the backend restarts.

## What the transcript shows

During streaming, the transcript includes:

- the assistant's response as it arrives;
- **thinking**, when the selected model and thinking level produce it;
- **tool calls inside the turn**, including the operation and its result or running state;
- **context rows**, showing the system prompt sections and tools offered to the model; expand a row to inspect the exact recorded text;
- **compaction lines**, marking where earlier context was compacted so the conversation could continue.

These are parts of the same turn rather than separate hidden logs. You can inspect which file an agent read, which edit it made, or which command it ran before accepting its summary.
Tool-call arguments and results are clipped to 4,000 characters in the stream. Expand a clipped call to load its complete recorded output.

Tool location depends on the workspace. In a container-backed workspace, file and shell calls run in that container through pi-env. In General, only `web_fetch` is available and private addresses are refused. See [Tools](/docs/tools).

## Per-conversation controls

The conversation controls provide a quick switch for:

| Control | Effect |
| --- | --- |
| Model | Use another model allowed by the workspace and available through its provider access |
| Thinking level | Change the reasoning level for this chat |
| Provider key | Use another linked OpenCode Go key to pay for this chat |

These controls change the conversation without redefining the reusable agent profile. They do not expand the workspace's model allow-list, link a new key, or add tool grants. Configure those boundaries in the workspace first.

## Live updates and durability

The browser receives the run as it happens. Thinking, tool activity, and compaction remain visible in the transcript rather than disappearing when the final response arrives.

Postgres is the durable store. This is different from a terminal's in-memory scrollback and different from a workspace container's filesystem: chat history can survive a restart even when a live terminal attachment cannot.

MCP servers, skills/prompt grants reaching runs, and web search are planned. Do not read their presence in configuration as evidence that a run used them.
