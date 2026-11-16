---
type: architecture
title: Server conversations and reconnection
description: How REST creation, Socket.IO replay, conversation managers and agent sessions cooperate to run and resume conversations.
tags: [server, conversations, lifecycle, socketio]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-a21eb8e59e5cc8b245ede396
    resource: repo://openhands/server/conversation_manager/standalone_conversation_manager.py
  - id: openwiki-source-4c63f45832e5c3f5c9eb0fcb
    resource: repo://openhands/server/listen_socket.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Server conversations and reconnection

## Ownership

The HTTP application exposes conversation management alongside files, settings, secrets, security and trajectory routes. The ASGI entrypoint wraps it with Socket.IO. Shared server initialization selects a `ConversationManager`, stores and monitoring listener from configured implementation classes. The default manager is `StandaloneConversationManager`, whose agent loops live in this server process.

Three objects have different lifetimes: the manager tracks conversation IDs and socket connections; `WebSession` bridges serialized events and Socket.IO; `AgentSession` owns the event stream, runtime, memory and controller. `ServerConversation` supplies an attachable view used by server operations. Closing a browser socket does not itself close the agent loop.

## Creation and startup

1. The new-conversation route receives repository, branch, initial message, optional replay and MCP configuration. It verifies a selected repository through `ProviderHandler` and delegates creation to the conversation service. Bearer-authenticated creation requires an initial message. Missing settings and LLM authentication errors become structured HTTP 400 responses.
2. The standalone manager creates per-conversation model services and statistics, constructs a session, and schedules agent initialization asynchronously. Its concurrency limit can close the oldest existing conversations after emitting a status error.
3. `AgentSession.start` connects the runtime, installs secret masking, creates memory, discovers MCP tools and creates or restores a controller. MCP discovery precedes controller creation so the system message includes those tools.
4. An initial message enters the event stream and moves the agent toward running; without one, startup requests the awaiting-user-input state. Startup logs record duration, runtime connection success and whether controller state was restored.

## Socket connection and replay

Clients connect with `conversation_id` and `latest_event_id`, plus configured authentication/provider information. The socket handler validates access using the conversation validator and optional session API key, then replays persisted events beginning at `latest_event_id + 1`. An invalid numeric cursor falls back to `-1`. Null actions, null observations and recall actions are skipped; the most recent agent-state observation is sent after the other replayed events. Replay is therefore a presentation of history, not another execution of its commands.

After replay the handler loads initialization settings and joins the manager's conversation room. Incoming `oh_user_action` messages pass through the manager to session dispatch; `oh_action` remains a compatibility alias. Dispatch deserializes the event and records it with user provenance. Image messages are rejected with a client error when the selected model disables or lacks vision support.

## Detach, shutdown and failure boundaries

The manager reuses active or detached `ServerConversation` handles under a lock. Its cleanup task disconnects detached handles and, when `sandbox.close_delay` is enabled, closes inactive agent sessions only after checking state and connected sockets. A running agent is excluded from this idle-close selection. A falsy close delay disables that idle sandbox closure.

Explicit session closure disconnects mapped sockets and closes the owning session. `AgentSession.close` closes the stream, saves controller state, closes the controller and schedules runtime cleanup. Persistent history and saved controller state support later restoration; they do not guarantee the external workspace or runtime still exists. Runtime availability, socket authorization and model authentication are separate failure boundaries.

## Working on this system

Follow [manage_conversations.py](../../openhands/server/routes/manage_conversations.py), [listen_socket.py](../../openhands/server/listen_socket.py), [standalone_conversation_manager.py](../../openhands/server/conversation_manager/standalone_conversation_manager.py) and [agent_session.py](../../openhands/server/session/agent_session.py). Focused coverage lives in `tests/unit/server/test_socket_events.py`, `tests/unit/server/session/` and `tests/unit/server/conversation_manager/`.

Read [events and persistence](events-and-storage.md) for history semantics, [browser workflow](../workflows/frontend.md) for client cursors, and [enterprise boundaries](../integrations/enterprise.md) for alternate server implementations. The [quickstart](../quickstart.md) routes other tasks.
