---
title: "Server Application and REST API"
---
## Overview

The OpenHands web application is one ASGI app, `openhands.server.listen:app`. It is a FastAPI application for the REST API and the static frontend, wrapped by a Socket.IO server that carries the live event channel of each conversation. `make run` and `python -m openhands.server` start it with uvicorn on port 3000.

Sources: [openhands/server/listen.py:1-27](repo://openhands/server/listen.py#L1-L27), [openhands/server/__main__.py:7-16](repo://openhands/server/__main__.py#L7-L16), [Makefile:249-251](repo://Makefile#L249-L251)

This page covers how the app is assembled and what the REST routes do. The Socket.IO channel and the per-conversation session objects are on [[Sessions and Socket.IO]]; who owns running conversations is on [[Conversation Managers]].

Sources: [openhands/server/listen_socket.py:36-40](repo://openhands/server/listen_socket.py#L36-L40)

## Assembly

### listen.py

`listen.py` takes the FastAPI app from `app.py`, mounts the built frontend from `./frontend/build` at `/` unless `SERVE_FRONTEND` is `false`, adds three middlewares, and wraps everything in `socketio.ASGIApp(sio, other_asgi_app=base_app)`, so Socket.IO requests go to the socket server and everything else to FastAPI. `SPAStaticFiles` answers unknown paths with `index.html`, which lets the single-page app handle its own routes.

Sources: [openhands/server/listen.py:15-27](repo://openhands/server/listen.py#L15-L27), [openhands/server/static.py:6-12](repo://openhands/server/static.py#L6-L12)

### Middleware

| Middleware | Behaviour |
| --- | --- |
| `LocalhostCORSMiddleware` | allows origins listed in `PERMITTED_CORS_ORIGINS`; with none listed, allows any `localhost` or `127.0.0.1` origin on any port |
| `CacheControlMiddleware` | caches `/assets` (fingerprinted files) for 30 days; disables caching everywhere else |
| `RateLimitMiddleware` with `InMemoryRateLimiter(10, 1)` | per client host, delays requests beyond 10 per second and answers 429 beyond 20, except for `/assets` |

Sources: [openhands/server/middleware.py:16-131](repo://openhands/server/middleware.py#L16-L131), [openhands/server/listen.py:20-25](repo://openhands/server/listen.py#L20-L25)

### app.py

`app.py` creates the FastAPI app with a lifespan that enters the conversation manager's context, so its background tasks start and stop with the server, combined with the lifespan of the MCP server mounted at `/mcp` (see [[MCP Integration]]). It maps `AuthenticationError` from git providers to 401, includes the routers, and adds `/alive`, `/health` and `/server_info`.

Sources: [openhands/server/app.py:37-86](repo://openhands/server/app.py#L37-L86), [openhands/server/routes/health.py:6-17](repo://openhands/server/routes/health.py#L6-L17)

## Shared objects and overrides

### shared.py

`shared.py` builds the process-wide singletons once at import: the `OpenHandsConfig` from `config.toml` and the environment, the `ServerConfig`, the file store, the Socket.IO `AsyncServer` (with a Redis client manager when `REDIS_HOST` is set, so several server processes share sockets, and a 4 MB buffer for file uploads), the monitoring listener, the conversation manager, and the store classes for settings, secrets and conversations.

Sources: [openhands/server/shared.py:21-77](repo://openhands/server/shared.py#L21-L77)

### ServerConfig

`ServerConfig` names the implementation class of every replaceable server component as a dotted path, and `get_impl` imports and type-checks each one. `load_server_config` itself is resolved from `OPENHANDS_CONFIG_CLS`, so a deployment can swap all of them at once; this is how the [[Enterprise Server]] runs on the same code.

Sources: [openhands/server/config/server_config.py:8-60](repo://openhands/server/config/server_config.py#L8-L60), [openhands/utils/import_utils.py:42-73](repo://openhands/utils/import_utils.py#L42-L73)

| Setting | OSS default |
| --- | --- |
| `app_mode` | `AppMode.OSS` (`SAAS` in the cloud) |
| `conversation_manager_class` | `StandaloneConversationManager`, or `CONVERSATION_MANAGER_CLASS` |
| `settings_store_class`, `secret_store_class`, `conversation_store_class` | file-based stores, see [[Storage]] |
| `user_auth_class` | `DefaultUserAuth`, see [[Settings, Secrets and User Auth]] |
| `monitoring_listener_class` | `MonitoringListener` |
| feature flags | `ENABLE_BILLING`, `HIDE_LLM_SETTINGS` |

Sources: [openhands/server/config/server_config.py:8-49](repo://openhands/server/config/server_config.py#L8-L49), [openhands/server/types.py:6-32](repo://openhands/server/types.py#L6-L32)

`get_config` returns the app mode, GitHub client id, PostHog key and feature flags, which the frontend loads from `/api/options/config` to adapt its UI.

Sources: [openhands/server/config/server_config.py:38-49](repo://openhands/server/config/server_config.py#L38-L49), [openhands/server/routes/public.py:62-69](repo://openhands/server/routes/public.py#L62-L69)

### Session API key

When `SESSION_API_KEY` is set, every router gets a dependency that requires it in the `X-Session-API-Key` header and answers 401 otherwise. This protects a server that runs nested inside a sandbox, as the Docker nested conversation manager does.

Sources: [openhands/server/dependencies.py:6-24](repo://openhands/server/dependencies.py#L6-L24)

## REST routes

### Conversations

| Method and path | Purpose |
| --- | --- |
| `POST /api/conversations` | create a conversation with an optional repository, branch, git provider, first message, images, replay trajectory, suggested task, conversation instructions and MCP config; returns its id |
| `GET /api/conversations` | list the user's conversations, paginated, hiding ones older than `conversation_max_age_seconds` |
| `GET`, `PATCH`, `DELETE /api/conversations/{id}` | read, rename, delete one |
| `POST /api/conversations/{id}/start`, `/stop` | start or stop its agent loop |
| `GET /api/conversations/{id}/remember-prompt` | build a prompt to save a lesson from an event as a microagent |
| `GET /api/microagent-management/conversations` | conversations created to manage microagents |

Sources: [openhands/server/routes/manage_conversations.py:160-188](repo://openhands/server/routes/manage_conversations.py#L160-L188), [openhands/server/routes/manage_conversations.py:189-290](repo://openhands/server/routes/manage_conversations.py#L189-L290), [openhands/server/routes/manage_conversations.py:291-371](repo://openhands/server/routes/manage_conversations.py#L291-L371), [openhands/server/routes/manage_conversations.py:473-480](repo://openhands/server/routes/manage_conversations.py#L473-L480), [openhands/server/routes/manage_conversations.py:534-540](repo://openhands/server/routes/manage_conversations.py#L534-L540), [openhands/server/routes/manage_conversations.py:639-645](repo://openhands/server/routes/manage_conversations.py#L639-L645), [openhands/server/routes/manage_conversations.py:773-780](repo://openhands/server/routes/manage_conversations.py#L773-L780)

Creating a conversation verifies that the repository belongs to the chosen provider, then calls `create_new_conversation`; missing LLM settings or a bad LLM key come back as 400 with a message id the UI translates.

Sources: [openhands/server/routes/manage_conversations.py:241-290](repo://openhands/server/routes/manage_conversations.py#L241-L290)

### Inside one conversation

These routes live under `/api/conversations/{conversation_id}` and resolve the conversation through `get_conversation`, which attaches to it in the conversation manager and answers 404 if it is not running.

Sources: [openhands/server/utils.py:96-112](repo://openhands/server/utils.py#L96-L112)

| Path | Purpose |
| --- | --- |
| `GET /config` | runtime id and session id |
| `GET /vscode-url`, `GET /web-hosts` | URLs of the sandbox's VS Code and app ports |
| `GET /events` | search the event history with filters, at most 100 per page, with `has_more` |
| `POST /events` | send an event to the conversation, as the socket does |
| `GET /microagents` | microagents loaded for this conversation |
| `GET /list-files`, `GET /select-file` | browse and read workspace files through the runtime |
| `GET /zip-directory`, `POST /upload-files` | download the workspace, upload files to it |
| `GET /git/changes`, `GET /git/diff` | changed files and per-file diffs |
| `GET /trajectory` | the full event trajectory for export |
| `POST /submit-feedback` | send feedback on the conversation |
| `/security/{path}` | passed to the security analyzer, see [[Security Analyzers and Confirmation Mode]] |

Sources: [openhands/server/routes/conversation.py:19-110](repo://openhands/server/routes/conversation.py#L19-L110), [openhands/server/routes/conversation.py:171-191](repo://openhands/server/routes/conversation.py#L171-L191), [openhands/server/routes/files.py:30-40](repo://openhands/server/routes/files.py#L30-L40), [openhands/server/routes/files.py:118-122](repo://openhands/server/routes/files.py#L118-L122), [openhands/server/routes/files.py:185-190](repo://openhands/server/routes/files.py#L185-L190), [openhands/server/routes/files.py:222-226](repo://openhands/server/routes/files.py#L222-L226), [openhands/server/routes/files.py:262-287](repo://openhands/server/routes/files.py#L262-L287), [openhands/server/routes/trajectory.py:12-17](repo://openhands/server/routes/trajectory.py#L12-L17), [openhands/server/routes/feedback.py:14-19](repo://openhands/server/routes/feedback.py#L14-L19)

### User, settings and options

| Path | Purpose |
| --- | --- |
| `GET`, `POST /api/settings` | read and store the user's settings |
| `POST /api/add-git-providers`, `/api/unset-provider-tokens` | store or remove git provider tokens |
| `GET`, `POST`, `PUT`, `DELETE /api/secrets` | custom secrets |
| `GET /api/user/repositories`, `/info`, `/installations`, `/search/*`, `/suggested-tasks`, `/repository/branches` | git provider queries (OSS mode only) |
| `GET /api/user/repository/{name}/microagents` and `/content` | a repository's microagents |
| `GET /api/options/models`, `/agents`, `/security-analyzers`, `/config` | choices for the settings screen and frontend config |

Sources: [openhands/server/routes/settings.py:25-137](repo://openhands/server/routes/settings.py#L25-L137), [openhands/server/routes/secrets.py:103-110](repo://openhands/server/routes/secrets.py#L103-L110), [openhands/server/routes/secrets.py:156-160](repo://openhands/server/routes/secrets.py#L156-L160), [openhands/server/routes/secrets.py:184-215](repo://openhands/server/routes/secrets.py#L184-L215), [openhands/server/routes/secrets.py:260-315](repo://openhands/server/routes/secrets.py#L260-L315), [openhands/server/routes/git.py:35-110](repo://openhands/server/routes/git.py#L35-L110), [openhands/server/routes/git.py:132-245](repo://openhands/server/routes/git.py#L132-L245), [openhands/server/routes/git.py:292-360](repo://openhands/server/routes/git.py#L292-L360), [openhands/server/routes/public.py:11-69](repo://openhands/server/routes/public.py#L11-L69), [openhands/server/app.py:83-84](repo://openhands/server/app.py#L83-L84)

The settings and secrets routes are covered on [[Settings, Secrets and User Auth]]; the git routes on [[Git Provider Integrations]].

Sources: [openhands/server/app.py:75-86](repo://openhands/server/app.py#L75-L86)
