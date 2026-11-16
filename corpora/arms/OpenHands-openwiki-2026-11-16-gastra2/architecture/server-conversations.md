---
type: architecture
title: Server and conversation lifecycle
description: How REST, Socket.IO, conversation managers, web sessions, and agent sessions cooperate across startup, reconnection, and cleanup.
tags: [server, conversations, socketio, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-a21eb8e59e5cc8b245ede396
    resource: repo://openhands/server/conversation_manager/standalone_conversation_manager.py
  - id: openwiki-source-4c63f45832e5c3f5c9eb0fcb
    resource: repo://openhands/server/listen_socket.py
  - id: openwiki-source-c959928a0c3c7ad69fd438cc
    resource: repo://openhands/server/listen.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-e6edead93b3c17764753cbdb
    resource: repo://openhands/server/user_auth/default_user_auth.py
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# Server and conversation lifecycle

`openhands.server.listen:app` is the browser application's ASGI entrypoint. It wraps the FastAPI application with Socket.IO, optionally serves `frontend/build`, and adds localhost CORS, cache-control, and rate-limit middleware. REST manages resources and queries; Socket.IO carries live actions and observations.

## Ownership

| Component | Responsibility |
| --- | --- |
| FastAPI app and route modules | Conversation management, settings, secrets, files, Git, security, trajectories, health, and MCP endpoints |
| Conversation manager | Connection-to-conversation mapping, agent-loop creation/reuse, attachment, and cleanup |
| `WebSession` | Browser publication, incoming action deserialization, session settings, and runtime-status delivery |
| `AgentSession` | Event stream, runtime, memory, controller, startup, restoration, and closure |
| `ServerConversation` | Server-side attachment for operations against a conversation and its runtime |

The default manager is `StandaloneConversationManager`; configuration can replace it. A Socket.IO connection ID is not the durable conversation ID, and several connections can join the conversation's room.

## Connecting and starting

The socket connect handler requires `conversation_id`, parses `latest_event_id`, validates the conversation through a configurable validator, and checks a session API key when configured. It reads stored events starting after the client's cursor before joining the live conversation. It omits null and recall actions from catch-up and sends the latest state-change observation last.

The manager enters the socket room, records the connection mapping, and starts or reuses an agent loop. `WebSession.initialize_agent` applies user settings to the session configuration, including security, runtime images, model configuration, budget, and MCP configuration. Treat stored user settings and process configuration as separate inputs when diagnosing different behavior between CLI and browser sessions.

`AgentSession.start` creates/connects the runtime, registers provider and custom secrets for event redaction, creates memory, and discovers MCP tools before controller creation. That ordering ensures the initial system message can describe the tools. It then restores or creates controller state. An initial message is appended as a user event and followed by a request to run; without one, the session requests the awaiting-input state. Starting a session that already owns a controller or runtime raises an error.

## Live traffic and reconnects

Clients emit `oh_user_action`; the legacy `oh_action` alias remains supported. The manager resolves the connection to its running session. `WebSession.dispatch` deserializes payloads, checks image support for image-bearing messages, and inserts accepted events with user source. Outgoing events are filtered and published through a queue to the conversation room.

Catch-up from stored events is UI synchronization, distinct from trajectory replay that executes old actions. A reconnect should send its latest event cursor and retain the durable conversation ID. Trace missing updates through stored history, session publication, room membership, and the frontend event handler.

## Closure and retention

Disconnect removes a connection mapping and leaves the room; it does not immediately terminate the agent. The standalone manager's cleanup checks last activity, excludes running or unknown-state sessions, and excludes conversations that still have connections. A falsy sandbox `close_delay` disables this delayed session closure path. Separately, server-side conversation attachments are reference-counted and can be detached for cleanup.

Closing `AgentSession` closes the event stream, saves controller state, awaits controller closure, and submits runtime closure to an executor. Whether runtime close also destroys the sandbox depends on the selected implementation and its keep-alive configuration. Saved event history and a live workspace are different prerequisites for useful resumption.

## Authentication and extension seams

The OSS `DefaultUserAuth` returns no user ID, email, or access token and explicitly does not implement multi-tenancy. It loads settings and secrets through configured stores; Git provider tokens come from user secrets. Do not interpret a configured Git token as full server user isolation. Enterprise supplies different authentication, validation, storage, and manager implementations through the interfaces described in [enterprise boundaries](../integrations/enterprise.md).

Focused coverage lives in `tests/unit/server/test_socket_events.py`, `tests/unit/server/conversation_manager/test_standalone_conversation_manager.py`, and `tests/unit/server/session/`. For client behavior see [frontend conversations](../workflows/frontend.md); for cursor, event, and snapshot details see [persistence](events-persistence.md).
