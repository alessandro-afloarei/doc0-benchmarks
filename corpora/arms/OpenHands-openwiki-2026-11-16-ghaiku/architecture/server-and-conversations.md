---
type: architecture
title: Server, Routes, and Conversation Management
description: How the OpenHands server exposes REST routes and a Socket.IO channel, how a ConversationManager starts and tracks per-conversation agent sessions (standalone or nested in Docker), how WebSession and AgentSession wire a controller and runtime together, and how user authentication, settings, and secrets are pluggable.
tags: [server, fastapi, socketio, routes, conversation-manager, sessions, authentication, settings]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-f8228654e759fdf2fd0ec8f2
    resource: repo://openhands/server/app.py
  - id: openwiki-source-50d13a3f8c24f3a49234fd56
    resource: repo://openhands/server/config/server_config.py
  - id: openwiki-source-a21eb8e59e5cc8b245ede396
    resource: repo://openhands/server/conversation_manager/standalone_conversation_manager.py
  - id: openwiki-source-4c63f45832e5c3f5c9eb0fcb
    resource: repo://openhands/server/listen_socket.py
  - id: openwiki-source-c959928a0c3c7ad69fd438cc
    resource: repo://openhands/server/listen.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-7e3b4bedad14af18fc5d861e
    resource: repo://openhands/server/shared.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Server, Routes, and Conversation Management

The server is the public face of OpenHands. It serves the web app, offers REST endpoints for
conversations, settings, secrets, files, and git, and carries live agent events over Socket.IO. Behind
the routes, a **conversation manager** decides which agent loop runs for which conversation, and
a per-conversation **session** holds the controller, runtime, and event stream. This page covers
the server side. The step-by-step message path is in
[Conversation Lifecycle End to End](../workflows/conversation-lifecycle.md).

## Application assembly

- `openhands/server/app.py` creates a FastAPI application and includes the routers. Public options,
  files, security, feedback, conversations, settings, secrets, and trajectory routers are included
  directly; the git router is included only in OSS app mode (`app.py:75-85`). The application also
  mounts an MCP endpoint at `/mcp` (`app.py:37`, `app.py:62-63`).
- `openhands/server/listen.py` adds the static SPA mount, CORS, cache-control, and a simple in-memory
  rate limiter (`requests=10, seconds=1`), and wraps everything in a Socket.IO ASGI app
  (`listen.py:1-27`).
- `openhands/server/shared.py` instantiates the singletons: the conversation manager, the settings
  store, the secrets store, and the file store. The implementations are chosen by fully qualified
  class names from `server_config` through `get_impl` (`shared.py:59-72`).

## Routes

Routers are grouped by concern under `openhands/server/routes/`. Most use the `/api` prefix and the
shared `get_dependencies()` list, which applies session-key checks.

| Module | Scope |
| --- | --- |
| `manage_conversations.py` | Create, list, read, delete, start, stop, and update conversations (`/api/conversations...`). Start calls `maybe_start_agent_loop` on the conversation manager (`manage_conversations.py:508`). |
| `conversation.py` | Per-conversation utilities under `/api/conversations/{conversation_id}`: event search, event add, microagent lookup, VS Code and host information, and remote runtime configuration. |
| `settings.py`, `secrets.py` | Per-user settings and stored secrets, read and written through the settings and secrets stores. |
| `files.py`, `git.py` | Workspace files and git operations for the conversation's repository. |
| `public.py` | Unauthenticated option lists under `/api/options`. |
| `security.py`, `feedback.py`, `trajectory.py`, `health.py` | Security analysis settings, feedback submission, trajectory export, and health checks. |
| `mcp.py` | The FastMCP server mounted at `/mcp`, with pull-request tools for GitHub, GitLab, and Bitbucket. See [Model Context Protocol Integration](../integrations/mcp.md). |

Route handlers depend on `get_user_id`, `get_user_settings`, `get_user_secrets`, and
`get_provider_tokens`, all of which come from the user-auth abstraction below. The handler itself
does not know which authentication scheme is active.

## Real-time channel

`openhands/server/listen_socket.py` defines the Socket.IO handlers:

- `connect(connection_id, environ)` (`listen_socket.py:35`) handles new socket connections;
- `oh_action(connection_id, data)` (`listen_socket.py:149`) forwards an action from the browser to the
  conversation's event stream;
- `oh_user_action` (`listen_socket.py:144`) carries user-originated actions such as confirmation
  responses;
- `disconnect` (`listen_socket.py:156`) removes the connection from the conversation's room
  (`disconnect_from_session`, `standalone_conversation_manager.py:397`).

Outbound events flow the other way: a subscriber on the event stream (the `SERVER` key) hands each
event to the session, which sends it to the room for that conversation.

## Conversation managers

`ConversationManager` (`openhands/server/conversation_manager/conversation_manager.py:20`) is the
abstract interface. It defines methods for attaching and detaching connections, joining
conversations, starting and checking agent loops, listing running loops and connections, sending
events, closing sessions, and requesting LLM completions on behalf of a session.

Two implementations exist:

- **`StandaloneConversationManager`** (`standalone_conversation_manager.py:53`) runs agent loops in
  the server process. It is the default, selected by the `CONVERSATION_MANAGER_CLASS` environment
  variable (`server_config.py:25-28`).
  - `_start_agent_loop` (`standalone_conversation_manager.py:296`) enforces the per-user concurrency
    limit. When the limit is reached, it sends an `AGENT_ERROR$TOO_MANY_CONVERSATIONS` status to the
    oldest conversation and closes that session first (`standalone_conversation_manager.py:310-347`).
  - It builds a registry and conversation statistics for the session, then starts the session.
  - A background task closes sessions that have been idle longer than `sandbox.close_delay`
    (`_cleanup_stale`, `standalone_conversation_manager.py:179`).
  - `maybe_start_agent_loop` reuses an existing local loop for the same `sid` and only starts one
    when none exists (`standalone_conversation_manager.py:280-294`).
- **`DockerNestedConversationManager`** (`docker_nested_conversation_manager.py:50`) documents its
  agent loops as running inside Docker containers. It queries the nested runtime for its status
  (`_get_runtime_status_from_nested_runtime`, `docker_nested_conversation_manager.py:345`).

Both managers are created once per process through `get_instance` and used through the shared
instance in `shared.py`.

## Sessions

Two classes split the work for one conversation:

- **`AgentSession`** (`openhands/server/session/agent_session.py:42`) owns the agent-side objects.
  Its `start` method (`agent_session.py:90`) refuses to start twice, creates the runtime
  (`_create_runtime`, `agent_session.py:296`), creates the controller (`_create_controller`,
  `agent_session.py:386`), creates memory (`_create_memory`, `agent_session.py:448`), and restores a
  saved state or replays a trajectory when one is supplied (`_maybe_restore_state`, `_run_replay`).
  Provider tokens can be overridden by a custom secret (`override_provider_tokens_with_custom_secret`,
  `agent_session.py:277`). `close` (`agent_session.py:224`) tears these down.
- **`WebSession`** (`openhands/server/session/session.py:40`) is the server-facing wrapper. It holds
  the `sid`, the socket connection, the `AgentSession`, and a publish queue. `initialize_agent`
  (`session.py:132`) builds the agent from settings, and `_on_event` (`session.py:314`) forwards
  events to the client. Status messages, such as LLM retry notices (`session.py:306`), are queued
  with `queue_status_message` (`session.py:444`) and sent through `_send_status_message`.

## Authentication, settings, and secrets

Authentication is an interface, `UserAuth` (`openhands/server/user_auth/user_auth.py:23`), that
exposes the user ID, email, access token, provider tokens, settings store, and secrets store for the
current request. `DefaultUserAuth` (`default_user_auth.py:16`) is the open-source implementation; it is
selected by `user_auth_class` (`server_config.py:30-32`). A deployment that needs a different identity
source supplies its own class, which is what the enterprise server does
([Enterprise SaaS Layer](../enterprise/saas-server.md)).

Settings and secrets are also pluggable through `settings_store_class` and `secret_store_class`
(`server_config.py:16-21`). The conversation store, which records conversation metadata for listing
and restart, is selected by `conversation_store_class` (`server_config.py:22-24`).

## Failure and ordering semantics

- Attaching a second connection to a conversation does not start a second agent loop: the standalone
  manager reuses the loop keyed by `sid`, and the nested manager checks `is_agent_loop_running`
  before starting one.
- Disconnecting a socket removes that connection only. A loop ends when it finishes, is stopped,
  is idle past `sandbox.close_delay`, or is closed to make room under the concurrency limit.
- A session that is already started cannot be started again; close it and create a new one.
- Rate limiting is applied per process by the in-memory limiter, so limits do not coordinate across
  multiple server replicas. Use the enterprise rate limit or an external gateway in multi-replica
  deployments.

## Extension seams

- New authentication: subclass `UserAuth`, implement `get_instance` for the request, and set
  `user_auth_class`.
- New storage: subclass the settings, secrets, or conversation store interface, and set the matching
  `*_class` setting.
- New conversation placement: subclass `ConversationManager`, implement `get_instance`, and set
  `CONVERSATION_MANAGER_CLASS`.
- New HTTP surface: add a router under `routes/` and include it in `app.py`.

## Tests

`tests/unit/server/` covers route handlers and the conversation manager (its `conversation_manager/`
subfolder). The enterprise server has its own tests under `enterprise/tests/`.

## Related pages

- [Event Model and Event Stream](event-stream.md)
- [Agent Controller and Step Loop](agent-controller.md)
- [Conversation Lifecycle End to End](../workflows/conversation-lifecycle.md)
- [Enterprise SaaS Layer](../enterprise/saas-server.md)
