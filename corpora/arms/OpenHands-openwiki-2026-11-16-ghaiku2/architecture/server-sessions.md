---
type: architecture-component
title: Server, Sockets, and Conversation Sessions
description: How the OpenHands web server is assembled (Socket.IO wrapping a FastAPI app), how REST routes start and stop conversations, how a browser socket joins a conversation and replays its event log, how the conversation manager runs one agent loop per conversation with a per-user concurrency cap and idle cleanup, and the WebSession and AgentSession objects that hold the runtime, memory, and controller for a conversation.
tags: [server, fastapi, socketio, websocket, conversation-manager, sessions, replay, rest-api, concurrency, cleanup]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-a21eb8e59e5cc8b245ede396
    resource: repo://openhands/server/conversation_manager/standalone_conversation_manager.py
  - id: openwiki-source-4c63f45832e5c3f5c9eb0fcb
    resource: repo://openhands/server/listen_socket.py
  - id: openwiki-source-8ba2c1538eda07356c0947f1
    resource: repo://openhands/server/routes/manage_conversations.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Server, Sockets, and Conversation Sessions

The web server turns the in-process agent into a multi-user service. A browser talks to it in two ways: REST calls to create, list, stop, and inspect conversations, and a persistent Socket.IO connection per conversation that streams events in both directions. Behind both sits a **conversation manager** that keeps one live agent loop per conversation and a set of **session** objects that hold the components of each loop.

## Application assembly

`openhands/server/listen.py` builds the outer ASGI app. It optionally mounts the built frontend at `/` (when `SERVE_FRONTEND` is `true`, serving `./frontend/build`), adds CORS, cache-control, and a rate limiter (`InMemoryRateLimiter`, 10 requests per second), and wraps everything in a Socket.IO ASGI application (`socketio.ASGIApp(sio, other_asgi_app=base_app)`).

`openhands/server/app.py` defines the FastAPI application with a combined lifespan that also starts the MCP app. It mounts the FastMCP server at `/mcp` and includes these routers (~L56-L86): public, files, security, feedback, conversation, manage-conversation, settings, secrets, git (only in `OSS` app mode), and trajectory. Health endpoints are added last. A `AuthenticationError` is translated to HTTP 401.

## REST routes

The conversation routes are in `openhands/server/routes/manage_conversations.py`:

- `new_conversation` (~L190) creates a conversation's metadata and initial settings.
- `search_conversations` (~L292) and `get_conversation` (~L331) read metadata through the conversation store.
- `start_conversation` (~L474) calls `conversation_manager.maybe_start_agent_loop` with the conversation's settings and returns the agent loop information. This is the endpoint that makes the agent run.
- `stop_conversation` (~L535) reads the loop status and stops the conversation through the conversation manager's `close_session`.
- `delete_conversation` (~L353) closes the session if its agent loop is running, then deletes the runtime's state for the conversation.

Other routers serve files, settings, secrets, git operations, and per-conversation security analyzer requests (`/api/conversations/{id}/security/...`, which return 404 when no analyzer is configured).

## Socket.IO connection

`openhands/server/listen_socket.py` defines the Socket.IO handlers. The `connect` handler (~L36) does the following in order:

1. Parses the query string: `conversation_id` is required, `latest_event_id` says where to resume (default `-1`), `providers_set` lists git providers, and `session_api_key` is checked against `SESSION_API_KEY` when that is set. Any failure refuses the connection.
2. Validates the user for the conversation with `conversation_validator` (cookies or authorization header). The validator is in `openhands/storage/conversation/conversation_validator.py`.
3. **Replays** the stored event log for the conversation from `latest_event_id + 1` through `AsyncEventStoreWrapper`. Null actions and observations and `RecallAction` events are skipped. The last `AgentStateChangedObservation` is held and emitted after the rest, so the client's state is correct when replay finishes.
4. Initializes conversation settings for the user (`setup_init_conversation_settings`) and joins the conversation through `conversation_manager.join_conversation`. If that returns nothing, the connection is refused.

<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
After connection, `oh_user_action` (~L144) forwards the payload to `conversation_manager.send_to_event_stream`, which publishes it to the conversation's [event stream](/openwiki/architecture/event-stream.md) as a user event. `oh_action` is a retained alias for older clients. `disconnect` (~L156) detaches the connection, and the agent loop keeps running.

Outbound events reach the browser through `WebSession`, which subscribes to the stream and emits `oh_event` messages to the connected socket.

## Conversation manager

`ConversationManager` (`openhands/server/conversation_manager/conversation_manager.py`, abstract class at ~L20) defines the contract: attach and detach connections, join a conversation, query running loops and connections, start a loop, send events in, request an LLM completion, and close a session. `StandaloneConversationManager` (`standalone_conversation_manager.py`, class at ~L53) is the implementation used in OSS. A Docker-nested variant (`docker_nested_conversation_manager.py`) and a SaaS variant in `enterprise/` provide their own runtime placement.

### Starting a loop

`maybe_start_agent_loop` (~L280-L294) returns the existing session for a conversation ID if one is already running. Otherwise it calls `_start_agent_loop` (~L296), which first enforces the per-user limit. If the user already has `max_concurrent_conversations` loops, the oldest conversations are closed. Each is sent an `AGENT_ERROR$TOO_MANY_CONVERSATIONS` status message first. Then it creates the session and runs `start`.

### Stale cleanup

`_cleanup_stale` (~L179-L229) runs periodically. It closes a session whose `last_active_ts` is older than `sandbox.close_delay`, unless the agent is in a state that must be kept. This is what frees sandboxes of abandoned conversations. Setting `close_delay` to a falsy value disables it.

## Sessions

Two session classes split the work:

- **`WebSession`** (`openhands/server/session/session.py`, class at ~L40) is the per-connection-facing object. Its constructor (~L35-L72) holds the socket server reference, the file store, the LLM registry, conversation stats, and the user ID, and it owns an `AgentSession`. It dispatches incoming socket messages to the agent session and sends outgoing events back over the socket (`dispatch`, `send`, and `_send`, ~L353-L416). It also applies the per-session confirmation-mode override from user settings (~L140-L148).
<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **`AgentSession`** (`openhands/server/session/agent_session.py`, class at ~L42) owns the agent-side components. `start` (~L90) builds them: the runtime (`_create_runtime`, ~L296), the memory (`_create_memory`, ~L448), and the controller (`_create_controller`, ~L386). It attaches the MCP tools once the runtime is initialized (see [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md)) and can run a replay of a saved trajectory (`_run_replay`, ~L247). `close` (~L224) marks the session closed, waits for an in-progress start to finish, closes the event stream, saves the controller state and closes the controller, and submits the runtime's `close` to an executor. `get_state` (~L483) reports the agent state, and `_maybe_restore_state` (~L492) restores a saved state when a conversation resumes.

The same component assembly is used by the headless path in `openhands/core/setup.py`, so the server and the CLI create identical agents, controllers, and runtimes.

## Invariants and failure behavior

- A conversation has at most one live agent loop in a process. Starting an already-running conversation returns its existing session.
- A socket connection refused for a missing ID, a bad session key, a failed validation, or a missing event log is closed with `ConnectionRefusedError`.
- Replay runs during connection, starting after the `latest_event_id` the client supplies, so a reconnecting client receives the events it has not yet seen as stored history.
- A disconnect does not stop the agent. The loop stops only on an explicit stop, an error or terminal state handled by the controller, or stale cleanup.
- The per-user cap is enforced at loop start, by closing the oldest conversations rather than refusing the new one.

## Configuration

- `max_concurrent_conversations` limits running loops per user.
- `sandbox.close_delay` controls idle cleanup.
- `SESSION_API_KEY` requires a matching key on socket connections.
- `SERVE_FRONTEND` controls whether the built frontend is served.
- The rate limit is set in `listen.py`.

## Extension seams

- A new REST resource is a router included in `app.py`.
- A new socket message is a `@sio.event` handler in `listen_socket.py` that forwards to the conversation manager.
- A new placement strategy is a `ConversationManager` subclass implementing `_start_agent_loop` and the session lookup.

## Representative tests

- `tests/unit/server/` holds 16 test files in total. Eight are under `routes/` and cover the REST routes; `session/test_agent_session.py` covers the agent session; `test_socket_events.py` covers the socket handlers; `conversation_manager/` covers the managers.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md)
<!-- openwiki: broken internal link [/openwiki/architecture/storage-persistence.md] link "/openwiki/architecture/storage-persistence.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Storage, Persistence, and Secrets](/openwiki/architecture/storage-persistence.md)
<!-- openwiki: broken internal link [/openwiki/workflows/conversation-lifecycle.md] link "/openwiki/workflows/conversation-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Conversation Lifecycle, End to End](/openwiki/workflows/conversation-lifecycle.md)
<!-- openwiki: broken internal link [/openwiki/enterprise/saas-platform.md] link "/openwiki/enterprise/saas-platform.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Enterprise SaaS Platform](/openwiki/enterprise/saas-platform.md)
