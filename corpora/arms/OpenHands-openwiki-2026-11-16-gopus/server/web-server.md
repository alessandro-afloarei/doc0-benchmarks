---
type: subsystem
title: Web Server, Sessions, and Conversation Management
description: How the OpenHands FastAPI + Socket.IO server works — app assembly and middleware, the REST API surface, Socket.IO connect/replay/user-action flow, conversation managers (standalone with concurrency limits and idle cleanup, docker-nested), Session and AgentSession lifecycle, conversation creation, and event forwarding to clients.
tags: [server, fastapi, socket-io, sessions, conversation-manager, rest-api]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-f8228654e759fdf2fd0ec8f2
    resource: repo://openhands/server/app.py
  - id: openwiki-source-c5420a81121cc66753b2ae30
    resource: repo://openhands/server/conversation_manager/docker_nested_conversation_manager.py
  - id: openwiki-source-a21eb8e59e5cc8b245ede396
    resource: repo://openhands/server/conversation_manager/standalone_conversation_manager.py
  - id: openwiki-source-4c63f45832e5c3f5c9eb0fcb
    resource: repo://openhands/server/listen_socket.py
  - id: openwiki-source-c959928a0c3c7ad69fd438cc
    resource: repo://openhands/server/listen.py
  - id: openwiki-source-7ca33214d02805cba86265c4
    resource: repo://openhands/server/middleware.py
  - id: openwiki-source-8ba2c1538eda07356c0947f1
    resource: repo://openhands/server/routes/manage_conversations.py
  - id: openwiki-source-ac3a4cd2021762247f5a9861
    resource: repo://openhands/server/services/conversation_service.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Web Server, Sessions, and Conversation Management

The backend for the web UI is a FastAPI app wrapped in a Socket.IO ASGI app. The entrypoint is `uvicorn openhands.server.listen:app`, which both `make run` and the Docker image use ([Build and Deploy](../operations/build-and-deploy.md)).

## Assembly

- `openhands/server/app.py` creates `FastAPI(title='OpenHands')` with a lifespan that enters the `conversation_manager` context (starting background cleanup) and the MCP app's lifespan. It mounts the built-in MCP server at `/mcp` ([MCP](../integrations/mcp.md#built-in-openhands-mcp-server)) and maps `AuthenticationError` to 401. It includes these routers: public options, files, security, feedback, conversation, manage-conversations, settings, secrets, git (**OSS mode only**), and trajectory, plus health endpoints.
- `openhands/server/listen.py` mounts the SPA build at `/` (`SPAStaticFiles` over `./frontend/build`, unless `SERVE_FRONTEND=false`). It adds `LocalhostCORSMiddleware` (any localhost or 127.0.0.1 origin, plus `PERMITTED_CORS_ORIGINS`), `CacheControlMiddleware`, and an in-memory `RateLimitMiddleware` (10 requests/second). It exposes `app = socketio.ASGIApp(sio, other_asgi_app=base_app)`.
<!-- openwiki: broken internal link [storage-and-settings.md#process-wide-wiring-openhandsservershared-py] heading anchor "process-wide-wiring-openhandsservershared-py" does not exist in "storage-and-settings.md". Fix the href or restore the target, then delete this comment. -->
- Singletons such as config, `sio`, file store, conversation manager, and stores come from `openhands/server/shared.py` ([Storage and Extension Points](storage-and-settings.md#process-wide-wiring-openhandsservershared-py)).
- When `SESSION_API_KEY` is set, every router requires the `X-Session-API-Key` header.

## REST API

| Router (prefix) | Endpoints |
| --- | --- |
| `manage_conversations.py` (`/api`) | `POST /conversations` (create and start), `GET /conversations` (paginated search), `GET/PATCH/DELETE /conversations/{id}`, `POST /conversations/{id}/start`, `POST /conversations/{id}/stop`, `GET /conversations/{id}/remember-prompt`, `POST /conversations/{id}/exp-config`, `GET /microagent-management/conversations` |
| `conversation.py` (`/api/conversations/{id}`) | `GET /config` (runtime id, session id), `GET /vscode-url`, `GET /web-hosts`, `GET /events` (search with `start_id`, `end_id`, `reverse`, filter, `limit`), `POST /events` (inject an event, used by nested servers), `GET /microagents` |
| `files.py` (`/api/conversations/{id}`) | `GET /list-files`, `GET /select-file`, `GET /zip-directory`, `GET /git/changes`, `GET /git/diff`, `POST /upload-files` |
| `trajectory.py`, `feedback.py`, `security.py` | Trajectory export, feedback submission, security-analyzer passthrough ([Security](../security/security-analyzers.md#security-api-route)) |
| `settings.py`, `secrets.py` (`/api`) | User settings and secrets ([Storage](storage-and-settings.md#settings-and-secrets)) |
| `git.py` (`/api/user`) | Repositories, branches, suggested tasks ([Git Providers](../integrations/git-providers.md#server-api)) |
| `public.py` (`/api/options`) | `models`, `agents`, `security-analyzers`, `config` |
| `health.py` | `/alive`, `/health`, `/server_info` |

### Creating a conversation

`POST /api/conversations` (`manage_conversations.py` → `services/conversation_service.py`):

1. Takes an optional `repository`, `selected_branch`, `git_provider`, `initial_user_msg`, `image_urls`, `suggested_task` (rendered into the initial message), `create_microagent`, `replay_json`, and `conversation_instructions`.
2. Verifies that the user can access the repository (`ProviderHandler.verify_repo_provider`).
3. `create_new_conversation(...)`:
   - `initialize_conversation` writes `ConversationMetadata` with the trigger, repository, branch, and provider.
   - `start_conversation` loads the user's settings, merges provider tokens, custom secrets, MCP config, and conversation instructions into `ConversationInitData`, and calls `conversation_manager.maybe_start_agent_loop(...)`.
4. Returns the conversation id and status. The client then opens a Socket.IO connection.

## Socket.IO transport (`listen_socket.py`)

**`connect`** has query params `conversation_id`, `latest_event_id`, `providers_set`, and `session_api_key`:

1. Rejects the connection if `conversation_id` is missing or the session API key is wrong.
2. Runs `ConversationValidator.validate(conversation_id, cookies, authorization)` to get the `user_id`.
3. **Replays history:** iterates the conversation's `EventStore` from `latest_event_id + 1` and `emit`s each event as `oh_event`. It skips null and recall events, and holds back the latest `AgentStateChangedObservation` so it can be sent **last**. That way the UI ends up in the correct state.
4. Builds init data from stored settings and secrets (`setup_init_conversation_settings`). If there are no settings, it refuses with `CONFIGURATION$SETTINGS_NOT_FOUND`.
5. Calls `conversation_manager.join_conversation(...)`. This adds the connection to the room `ROOM_KEY.format(sid)` and starts the agent loop if it isn't running.

**`oh_user_action`** (and the legacy `oh_action`) goes to `conversation_manager.send_to_event_stream(connection_id, data)`, which ends in `Session.dispatch`. **`disconnect`** detaches the connection, but the agent loop keeps running.

## Conversation managers

`ConversationManager` (`conversation_manager/conversation_manager.py`) is the abstract interface:

- attach and detach (REST access to a conversation), and `join_conversation` (Socket.IO);
- `maybe_start_agent_loop`, `is_agent_loop_running`, `get_running_agent_loops`, `get_connections`, `get_agent_loop_info`;
- `send_to_event_stream` and `send_event_to_conversation`;
- `close_session`;
- `request_llm_completion`, for helper LLM calls such as titles.

`server_config.conversation_manager_class` selects the implementation.

### StandaloneConversationManager (default)

This manager runs everything in a single server process:

- Keeps `_local_agent_loops_by_sid` (running `Session`s), a connection-to-sid map, and REST-attached conversations, which it reference-counts and disconnects after detaching.
- **Concurrency limit:** before it starts a loop, if the user already has `max_concurrent_conversations` running, it closes the *least recently updated* ones. Those receive an `AGENT_ERROR$TOO_MANY_CONVERSATIONS` status message first.
- **Idle cleanup** (`_cleanup_stale`, a periodic background task): it closes sessions that have been inactive longer than `sandbox.close_delay`, are not `RUNNING`, and have no connected clients. With `close_delay` unset, nothing is cleaned up and disconnected sandboxes stay open.
- Subscribes a `SERVER` callback on each conversation's stream that keeps `ConversationMetadata` current: `last_updated_at`, accumulated cost and tokens, an auto-generated title from `request_llm_completion`, and the current git branch after git-related commands. It emits metadata updates to the room.
- `get_agent_loop_info` returns the conversation URL, session API key, event store, and status for each running loop.

### DockerNestedConversationManager

This manager runs **a whole OpenHands server inside each runtime container**:

1. Starts a `DockerRuntime` for the conversation.
2. `POST`s `{nested_url}/api/conversations` with the initial message, repository, MCP config, and so on, and injects settings, provider tokens, and secrets.
3. Forwards events with `POST {nested_url}/api/conversations/{sid}/events`.
4. Stops the conversation with `/stop`.

Clients connect to the nested server directly, so the outer server's join, attach, and connection methods are unsupported. Events are read through `NestedEventStore` ([Event Stream](../architecture/event-stream.md#reading-history-eventstore)). The SaaS uses the same pattern ([Enterprise](../enterprise/saas-server.md#conversation-managers)).

## Session and AgentSession

`Session` (`session/session.py`) is one running conversation inside the server:

- `initialize_agent(settings, initial_message, replay_json)` builds the per-conversation config from user settings. That includes the agent class, confirmation mode, security analyzer, sandbox images, max iterations and budget, search and sandbox API keys, and MCP config merged with the default OpenHands MCP server. It sets up the default condenser pipeline when `enable_default_condenser` is on ([Condensers](../architecture/memory-and-condensers.md#defaults)), creates the agent, installs an LLM retry listener that posts `LLM_RETRY` status, and calls `AgentSession.start(...)`. Microagent-related `ValueError`s are reported to the user. Other errors only report the exception class, so secrets are not exposed.
- `_on_event` (subscribed as `SERVER`) forwards agent and user events to clients. It also forwards environment `CmdOutputObservation`, `AgentStateChangedObservation`, and `RecallObservation`, plus all `ErrorObservation`s, relabeled as agent events. Null events are dropped. Messages go through a publish queue. On the first send it waits up to 2 seconds for a client to join the room.
- `dispatch(data)` deserializes client actions. It rejects image messages when the model has vision disabled or doesn't support vision, and publishes everything else as `USER` events.
- `queue_status_message` and `send_error` push `status_update` messages (runtime status, errors) to the UI.

`AgentSession` (`session/agent_session.py`) owns the runtime, controller, memory, and event stream for that session. `start()` follows the assembly described in [System Architecture Overview](../architecture/overview.md#assembly-server-path):

1. `_create_runtime`: builds the runtime, connects it, clones the repository and branch, runs `setup.sh` and the git hooks, and reports status.
2. Registers token and secret masking.
3. `_create_memory`.
4. MCP tools.
5. `_create_controller`, which restores state if one exists (`_maybe_restore_state`), or `_run_replay`.
6. Sends the initial message with `RUNNING`, or `AWAITING_USER_INPUT` when there is no message.

`close()` shuts down the controller (saving state), runtime, and memory. `ServerConversation` (`session/conversation.py`) is a lighter attachment used by REST routes to reach a conversation's runtime and event stream.

## Tests

`tests/unit/server/` covers `listen` wiring, middleware, OpenAPI schema generation, Socket.IO events, conversation managers, sessions, and routes. `tests/e2e/` drives the full app with Playwright ([Testing Guide](../testing/testing-guide.md)).

## Related pages

- [Storage, Settings, Secrets, and Auth Extension Points](storage-and-settings.md)
- [Web Frontend](../frontend/web-ui.md)
- [System Architecture Overview](../architecture/overview.md)
- [Enterprise (SaaS) Server](../enterprise/saas-server.md)
