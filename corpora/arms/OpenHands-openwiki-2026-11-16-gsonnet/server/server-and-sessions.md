---
type: architecture
title: Server, Sessions and Conversation Management
description: The OpenHands web server — FastAPI app and Socket.IO listener, REST route groups, the WebSession/AgentSession pair per conversation, ConversationManager responsibilities (agent-loop start, limits, cleanup), user-auth and other pluggable classes, and how settings become runtime configuration.
tags: [server, fastapi, socket-io, session, conversation-manager, user-auth, routes]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-f8228654e759fdf2fd0ec8f2
    resource: repo://openhands/server/app.py
  - id: openwiki-source-a21eb8e59e5cc8b245ede396
    resource: repo://openhands/server/conversation_manager/standalone_conversation_manager.py
  - id: openwiki-source-6855f5cb740a117f0ec89b40
    resource: repo://openhands/server/dependencies.py
  - id: openwiki-source-4c63f45832e5c3f5c9eb0fcb
    resource: repo://openhands/server/listen_socket.py
  - id: openwiki-source-c959928a0c3c7ad69fd438cc
    resource: repo://openhands/server/listen.py
  - id: openwiki-source-1d0b37cb63291f1f3de36043
    resource: repo://openhands/server/session/conversation.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
  - id: openwiki-source-7e3b4bedad14af18fc5d861e
    resource: repo://openhands/server/shared.py
  - id: openwiki-source-e6edead93b3c17764753cbdb
    resource: repo://openhands/server/user_auth/default_user_auth.py
  - id: openwiki-source-a80e9a1da1515233f9c7a139
    resource: repo://openhands/server/user_auth/user_auth.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Server, Sessions and Conversation Management

`openhands/server/` turns the core loop ([Overview](../architecture/overview.md)) into a multi-conversation web service used by the [frontend](../clients/frontend.md), the API and the enterprise edition.

## Process layout

- **`app.py`** builds the FastAPI `app` (title "OpenHands"). Importing `openhands.agenthub` registers all agents. Its lifespan combines two async contexts: the global `conversation_manager` (`async with conversation_manager`) and the FastMCP app mounted at `/mcp` ([MCP](../integrations/mcp.md)). An `AuthenticationError` handler returns 401. Routers: public options, files, security, feedback, conversation, manage-conversations, settings, secrets, trajectory, health endpoints, and the git router **only when `server_config.app_mode == OSS`**.
- **`listen.py`** (the uvicorn entry: `uvicorn openhands.server.listen:app`) mounts the built SPA from `./frontend/build` unless `SERVE_FRONTEND=false`, adds `LocalhostCORSMiddleware`, `CacheControlMiddleware` and a `RateLimitMiddleware` (in-memory, 10 requests/second), and wraps everything in `socketio.ASGIApp(sio, other_asgi_app=base_app)` so WebSocket traffic and REST share one port (3000 by default).
- **`shared.py`** is the composition root, executed at import: loads `OpenHandsConfig` and the `ServerConfig`, creates the `file_store`, the Socket.IO `AsyncServer` (CORS `*`, 4 MB buffer for base64 uploads, optional **Redis** client manager when `REDIS_HOST` is set so multiple servers share rooms), and instantiates via `get_impl(...)` the monitoring listener, **conversation manager**, settings store, secrets store and conversation store classes named in `ServerConfig` ([Configuration](../configuration/configuration.md)).
- **`dependencies.py`**: if `SESSION_API_KEY` is set, every router gets a dependency requiring a matching `X-Session-API-Key` header (used when OpenHands itself runs as a nested/remote runtime server).

## REST routes

| Router (prefix) | Highlights |
|---|---|
| `manage_conversations` (`/api`) | `POST /conversations` (create: validates the repo with `ProviderHandler.verify_repo_provider`, derives an initial message from a suggested task or microagent-creation request, generates a conversation id and calls `create_new_conversation`), `GET /conversations` (search with age filtering), `GET/PATCH/DELETE /conversations/{id}`, `POST .../start` and `.../stop`, remember-prompt generation, experiment config. |
| `conversation` (`/api/conversations/{id}`) | `/config`, `/vscode-url`, `/web-hosts`, `GET/POST /events` (search/add events), `/microagents`. |
| `files` (same prefix) | `/list-files`, `/select-file`, `/zip-directory`, `/git/changes`, `/git/diff`, `/upload-files` — all executed through the conversation's runtime. |
| `settings`, `secrets` (`/api`) | Load/save/reset user settings; add/remove git provider tokens; CRUD for custom secrets. |
| `public` (`/api/options`) | `models`, `agents`, `security-analyzers`, `config` (server config incl. `APP_MODE` and feature flags). |
| `security`, `feedback`, `trajectory` | Analyzer passthrough ([Security](../security/security-and-confirmation.md)), feedback submission, trajectory download. |
| `git` (`/api/user`) | Repo/branch/microagent queries ([Git providers](../integrations/git-providers.md)). |

## Real-time channel (`listen_socket.py`)

Socket.IO events: `connect` (validates `conversation_id`, optional session API key, and user access through the `ConversationValidator`; replays stored events newer than `latest_event_id` straight from an `EventStore`, then calls `conversation_manager.join_conversation`), `oh_user_action` (and legacy `oh_action`) → `send_to_event_stream`, `disconnect` → `disconnect_from_session`. Server→client messages are `oh_event`. Each conversation is a Socket.IO **room** (`ROOM_KEY`), so several browser tabs can watch one conversation.

## `ServerConversation`, `WebSession` and `AgentSession`

- **`ServerConversation`** (`session/conversation.py`): a lightweight handle to an *existing* conversation for REST routes — an `EventStream` plus a `Runtime` created with `attach_to_existing=True` (or reusing the live session's runtime). `security_analyzer` is read through the runtime; `disconnect` closes the stream and runtime only if it created them.
- **`WebSession`** (`session/session.py`, alias `Session`): one per running conversation; it owns the `AgentSession`, subscribes to the stream as `EventStreamSubscriber.SERVER` and forwards events to the room as `oh_event` via a publish queue (null events skipped; environment `CmdOutputObservation`/`AgentStateChangedObservation`/`RecallObservation` and `ErrorObservation` are re-labelled as `agent` source for the UI; waits up to ~2 s for a listening client on first send; tracks `last_active_ts`). `dispatch` turns client dicts into events with `EventSource.USER`, rejecting image messages for models without vision. `queue_status_message` forwards runtime/LLM status (including retry notices) to the client.
- **`WebSession.initialize_agent(settings, initial_message, replay_json)`** is where **user settings override configuration** for one conversation: agent class (`settings.agent`), `confirmation_mode`, `security_analyzer`, sandbox base/runtime image, git user name/email, `max_iterations`, `max_budget_per_task`, search API key, sandbox API key, custom MCP config, and the default condenser (an LLM-summarizing condenser sized by `condenser_max_size`, default 120). Then it instantiates `Agent.get_cls(agent_cls)` and calls `AgentSession.start(...)` with provider tokens, custom secrets, selected repo/branch and conversation instructions from `ConversationInitData`. Failures are reported to the client with only the exception class name to avoid leaking sensitive details.
- **`AgentSession`** (`session/agent_session.py`) wires runtime → memory → MCP tools → controller in a fixed order and handles replay/state restore; details in the [Overview](../architecture/overview.md#server-path-web-ui--api). It records a monitoring signal (`agent_session_start`) with success and duration.

## `ConversationManager`

The abstract base (`conversation_manager/conversation_manager.py`) defines the contract: enter/exit lifecycle, `attach_to_conversation`/`detach_from_conversation`, `join_conversation`, `get_running_agent_loops`, `get_connections`, `maybe_start_agent_loop`, `send_to_event_stream`, `send_event_to_conversation`, `disconnect_from_session`, `close_session`, `get_agent_session`, `get_agent_loop_info`, `request_llm_completion`. The default **`StandaloneConversationManager`** keeps everything in one process:

- Local state: `_local_agent_loops_by_sid` (sid → `Session`), `_local_connection_id_to_session_id`, plus reference-counted `_active_conversations` and timestamped `_detached_conversations` for `ServerConversation` reuse.
- `join_conversation` puts the connection in the room and calls `maybe_start_agent_loop`, which starts a session only if one is not already local.
- `_start_agent_loop` enforces **`max_concurrent_conversations`** per user (default 3): when the limit is hit it closes the oldest running conversations of that user after emitting an `AGENT_ERROR$TOO_MANY_CONVERSATIONS` status event to their room. It then creates the per-conversation `LLMRegistry` + `ConversationStats`, a `Session`, schedules `initialize_agent` as a task, and subscribes a callback that updates conversation metadata (last-updated time, accumulated cost and token counts, the current branch after git-related commands, and an LLM-generated title when the default title is still in use, announced to the client as a status update) in the conversation store when events arrive.
- A background **`_cleanup_stale`** task runs every ~15 s: disconnects detached conversations, and — if `sandbox.close_delay` is non-zero — closes sessions idle longer than that delay whose agent is not running and that have no connected clients. On shutdown it closes all sessions. Runtime class `setup()`/`teardown()` run on enter/exit.

Alternative implementations are chosen via `ServerConfig.conversation_manager_class`: the enterprise `ClusteredConversationManager` (Redis-coordinated) and `SaasNestedConversationManager` (separate runtime hosting a nested server) — see [Enterprise](../enterprise/enterprise-saas.md).

## Pluggable server classes

All created through `get_impl` from dotted paths in `ServerConfig`:

- **`UserAuth`** (`user_auth/user_auth.py`): per-request object providing `get_user_id`, `get_user_email`, `get_access_token`, `get_provider_tokens`, `get_user_settings_store`, `get_user_settings`, `get_secrets_store`. `DefaultUserAuth` is single-tenant: user id/email/token are `None`, settings and secrets come from file-backed stores. Enterprise supplies `SaasUserAuth`.
- **Stores**: `SettingsStore`, `SecretsStore`, `ConversationStore` (default file-based; [Storage](storage-and-persistence.md)).
- **`MonitoringListener`**: no-op hooks (`on_session_event`, `on_agent_session_start`, `on_create_conversation`, ...) that deployments override for metrics; implementations must not block.
- **`ConversationValidator`** for socket access checks; experiment manager for per-conversation config variants.

Related: [Frontend](../clients/frontend.md), [Event stream](../architecture/event-stream.md), [Runtime](../runtime/runtime-and-sandbox.md).
