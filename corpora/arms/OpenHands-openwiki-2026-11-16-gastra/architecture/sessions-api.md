---
type: architecture
title: Sessions and server APIs
description: Conversation creation, Socket.IO replay and routing, agent-session startup ordering, cleanup, and server extension boundaries.
tags: [server, sessions, api, websocket]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-a21eb8e59e5cc8b245ede396
    resource: repo://openhands/server/conversation_manager/standalone_conversation_manager.py
  - id: openwiki-source-4c63f45832e5c3f5c9eb0fcb
    resource: repo://openhands/server/listen_socket.py
  - id: openwiki-source-c959928a0c3c7ad69fd438cc
    resource: repo://openhands/server/listen.py
  - id: openwiki-source-8ba2c1538eda07356c0947f1
    resource: repo://openhands/server/routes/manage_conversations.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-2c04600c29d2c5701b2c02fd
    resource: repo://openhands/storage/conversation/conversation_validator.py
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# Sessions and server APIs

The web server has three distinct owners: HTTP routes handle requests and metadata, the conversation manager routes connections and agent loops, and `AgentSession` owns the event stream, runtime, memory, and controller for a running task. `WebSession` bridges that session to Socket.IO clients.

## Application composition

`openhands.server.listen:app` wraps the FastAPI application in `socketio.ASGIApp`. It optionally mounts `frontend/build` when `SERVE_FRONTEND` is true, and adds localhost CORS, cache-control, and rate-limit middleware. The FastAPI app includes conversation, file, settings, secrets, security, feedback, trajectory, and public routes; Git routes are conditionally mounted in OSS mode. It also mounts an MCP application.

Shared initialization loads application configuration and server configuration, builds the file store, and resolves manager, monitoring, and storage implementation classes. `REDIS_HOST` enables a Socket.IO Redis client manager; that alone does not replace the standalone agent-loop manager or turn local runtime state into distributed state.

## Creating and connecting to a conversation

The management router uses the `/api` prefix. Its main surfaces are:

| Operation | Route |
| --- | --- |
| Create/list | `POST /api/conversations`, `GET /api/conversations` |
| Read/update/delete metadata | `GET/PATCH/DELETE /api/conversations/{conversation_id}` |
| Start/stop execution | `POST /api/conversations/{conversation_id}/start` or `/stop` |

Creation accepts repository/branch selection, an initial message, images, conversation instructions, MCP configuration, and replay data. It obtains provider credentials and custom secrets from auth dependencies, verifies repository/provider compatibility when selected, and delegates setup to the conversation service. Bearer-authenticated creation requires an initial user message. Missing settings and model-authentication failures become structured 400 responses.

Socket.IO connection then supplies `conversation_id`, optional `latest_event_id`, provider selection, and session-key information. The server validates the session key and calls the configured conversation validator. The default validator ensures metadata exists; it is not a multi-user authorization layer. Enterprise replaces this boundary.

## Replay and live traffic

On connect, `listen_socket.connect` constructs an event store and replays from `latest_event_id + 1`; an invalid cursor falls back to -1. Null actions/observations and recall actions are suppressed. State-change observations are held back so only the latest one is sent after other replayed events.

After replay, the server loads initialization settings and joins the conversation through the manager. The standalone manager places the connection in the conversation room, records its session mapping, and starts or reuses the agent loop. User actions arrive through `oh_user_action`; `oh_action` remains a compatibility handler. Live output uses `oh_event`.

Replay reconstructs the client display. It is separate from the controller's checkpoint restoration described in [events and storage](events-storage.md).

## Agent-session startup order

`AgentSession.start` rejects an already-started session and performs these dependent steps:

1. Create/connect the runtime and establish workspace information.
2. Register provider/custom-secret values with the event stream.
3. Create memory with repository, workspace, and conversation instructions.
4. Add MCP tools when enabled and connected.
5. Create or restore the controller, or initialize replay mode.
6. Publish an initial message and running transition, or await user input.

MCP tools must be attached before controller construction because the controller emits the system-message event. Controller creation requires the runtime and uses interactive (`headless_mode=False`) semantics. Startup records duration, runtime-connect success, and whether controller state was restored.

## Ownership and cleanup

The standalone manager keeps local agent loops, connection-to-session mappings, active attached conversation wrappers, and detached wrappers. Attachments reuse existing runtime/event-stream objects when possible. Active wrappers are reference-counted; detached wrappers are eligible for disconnection.

Agent-loop cleanup considers configured `sandbox.close_delay`, last activity, state, and current connections. Running sessions and connected candidates are not closed by the stale-session selection. A false/zero close delay disables that idle close policy.

Session close marks the session closed, closes the stream, saves/closes the controller, and schedules runtime close on an executor. Runtime retention settings still determine container cleanup. Disconnecting a browser, stopping an agent loop, and deleting conversation data are different operations.

## Extension and focused checks

`ServerConfig` selects store, user-auth, monitoring, and conversation-manager classes; `OPENHANDS_CONFIG_CLS` selects a server-config override. `OPENHANDS_CONVERSATION_VALIDATOR_CLS` controls socket conversation validation. Keep HTTP auth dependencies and socket validation consistent when extending either.

See [enterprise extensions](../integrations/enterprise.md) for deployed replacements and [frontend workflow](../workflows/frontend.md) for client state. Representative checks include `tests/unit/server/routes/test_conversation_routes.py` for metadata permissions/failures and `tests/unit/server/test_openapi_schema_generation.py` for API schema generation.
