---
type: architecture
title: Conversation server and persistence
description: HTTP creation, Socket.IO replay, session ownership, storage boundaries, and cleanup in the standalone OpenHands server.
tags: [server, conversations, persistence, lifecycle]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-a21eb8e59e5cc8b245ede396
    resource: repo://openhands/server/conversation_manager/standalone_conversation_manager.py
  - id: openwiki-source-4c63f45832e5c3f5c9eb0fcb
    resource: repo://openhands/server/listen_socket.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Conversation server and persistence

The web server combines a FastAPI application with Socket.IO. `openhands.server.listen:app` wraps the FastAPI application from `server/app.py` and optionally mounts the built browser application at `/`. FastAPI registers conversation, file, settings, secrets, feedback, security, trajectory, and public routes, plus MCP and health endpoints. Git routes are included for OSS mode. The application lifespan enters the conversation manager and the MCP application.

## From creation to a connected conversation

1. The browser posts to `/api/conversations` with repository/branch, initial message, optional images, instructions, replay data, or MCP configuration.
2. The conversation service creates metadata and prepares initialization data from settings, provider tokens, and custom secrets, then calls `maybe_start_agent_loop`.
3. The standalone manager creates per-conversation LLM/statistics services and a `WebSession`, records it in its local loop map, and starts initialization as an asynchronous task.
4. The client connects to Socket.IO with the conversation ID and replay cursor. The server checks any configured session API key, validates conversation access, opens the stored event history, and replays events after `latest_event_id`.
5. After replay, it obtains initialization settings and joins the conversation's Socket.IO room, starting or reusing its agent loop.

Replay skips null events and recall actions. It withholds agent-state changes and emits only the last encountered state change after the other replayed events. This lets the interface settle on a recent execution state rather than stepping through every historical state transition.

## Ownership and boundaries

| Component | Responsibility |
| --- | --- |
| Conversation manager | Conversation-to-loop and connection-to-conversation maps; runtime setup/teardown; attachment and cleanup |
| `WebSession` (`Session` compatibility alias) | Web settings adaptation, client event dispatch, event forwarding, serialized publish queue |
| `AgentSession` | Event stream, runtime, memory, security analyzer, controller, startup and shutdown |
| `ServerConversation` | API-side access to a conversation/runtime, reused by reference-counted attachments |
| Stores | Events and checkpoints, conversation metadata, user settings, and secrets through separate interfaces |

Incoming `oh_user_action` messages are routed by connection ID to the session, deserialized, and appended as user events. Image messages are checked against the active model's vision support. Outgoing events pass through the session's publish queue and are emitted as `oh_event` to the conversation room. Some environment observations are presented to the UI as agent events. Runtime error status callbacks also move an initialized controller into an error state.

## Persistence and recovery

`server/shared.py` loads process configuration, selects the file store, builds Socket.IO, and resolves configured implementations for conversation management, monitoring, settings, secrets, and metadata. Redis can coordinate Socket.IO messages when `REDIS_HOST` is configured; distributed loop ownership requires a conversation manager designed for it.

File-store selection supports local files, S3, Google Cloud, and an in-memory fallback, with optional webhook wrapping. The logical storage layout is `sessions/<sid>/` without a user ID or `users/<user_id>/conversations/<sid>/` with one. Conversation data includes numbered event JSON files, metadata, initialization data, controller state, LLM registry, and conversation statistics. Durable event history and a runtime workspace are different persistence concerns.

The default user-auth implementation returns no user identity and is intended for the OSS single-user model. Conversation access validation is an explicit replacement seam via `OPENHANDS_CONVERSATION_VALIDATOR_CLS`; its default ensures metadata exists. Multi-tenant deployments must use the appropriate authentication, validator, and store implementations together; see [enterprise composition](../integrations/enterprise.md).

## Disconnect and cleanup

A socket disconnect removes its connection mapping; it does not immediately terminate execution. Periodic cleanup disconnects detached API conversation wrappers and, when `sandbox.close_delay` is enabled, closes old inactive loops that are not running and have no connected clients. Reaching `max_concurrent_conversations` closes older conversations after sending a status error.

Closing an agent session closes its event stream, saves and closes the controller, and schedules runtime closure. Reconnecting can recover controller state and replay stored events, but preserving the runtime workspace still depends on the selected runtime and deployment.

Focused tests are in `tests/unit/server/test_socket_events.py`, `tests/unit/server/session/`, and `tests/unit/server/conversation_manager/test_standalone_conversation_manager.py`. Pair transport changes with [browser-client behavior](browser-client.md) and changes to history or checkpoints with [events and state](../concepts/events-state.md).
