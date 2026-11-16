---
title: "Web Server and REST API"
---
## Overview

The web server is what the GUI talks to. It is a FastAPI application for the REST API, wrapped in a Socket.IO server for the live event stream, and it can also serve the built frontend. `openhands/server/app.py` assembles the FastAPI app and its routers; `openhands/server/listen.py` adds the static files and middleware and wraps everything in `socketio.ASGIApp`, which is the object uvicorn runs.

Sources: [openhands/server/app.py:58-86](repo://openhands/server/app.py#L58-L86), [openhands/server/listen.py:1-27](repo://openhands/server/listen.py#L1-L27)

The REST routes manage conversations, settings, secrets and repositories, and read a running conversation's files and events. Starting, running and streaming a conversation is the job of the conversation manager and sessions, covered in [[Conversations and Sessions]].

Sources: [openhands/server/app.py:75-86](repo://openhands/server/app.py#L75-L86)

## Starting the server

`python -m openhands.server` runs uvicorn on `openhands.server.listen:app` at `0.0.0.0` and the port in the `port` environment variable (default 3000), at debug log level when `DEBUG` is set. `make start-backend` runs the same app with auto-reload for development, as [[Quickstart]] shows.

Sources: [openhands/server/__main__.py:1-20](repo://openhands/server/__main__.py#L1-L20), [Makefile:249-251](repo://Makefile#L249-L251)

`listen.py` mounts the frontend build from `./frontend/build` at `/` unless `SERVE_FRONTEND=false`, using `SPAStaticFiles` so client-side routes fall back to the app's HTML. It then adds three middlewares and wraps the app with the Socket.IO server from `listen_socket.py`, whose `connect` handler is described in [[Conversations and Sessions]].

Sources: [openhands/server/listen.py:15-27](repo://openhands/server/listen.py#L15-L27), [openhands/server/static.py:1-12](repo://openhands/server/static.py#L1-L12)

| Middleware | Behaviour |
| --- | --- |
| `LocalhostCORSMiddleware` | Allows any `localhost` or `127.0.0.1` origin on any port, plus the origins in `PERMITTED_CORS_ORIGINS` |
| `CacheControlMiddleware` | Caches `/assets` for 30 days as immutable (their file names are fingerprinted); disables caching for everything else |
| `RateLimitMiddleware` | 10 requests per second per client host, with a short sleep over the limit and a 429 with `Retry-After: 1` past twice the limit; `/assets` is exempt |

Sources: [openhands/server/middleware.py:14-131](repo://openhands/server/middleware.py#L14-L131)

The FastAPI app's lifespan enters the conversation manager's async context, so its background tasks start and stop with the server, and combines it with the lifespan of the MCP server mounted at `/mcp`. An `AuthenticationError` from a git provider anywhere in a route becomes a 401 response.

Sources: [openhands/server/app.py:37-72](repo://openhands/server/app.py#L37-L72)

## Shared singletons

`openhands/server/shared.py` builds the server's process-wide objects when first imported: the `OpenHandsConfig` from [[Configuration]], the `ServerConfig`, the `FileStore`, the Socket.IO server, the monitoring listener, the conversation manager, and the classes for the settings, secrets and conversation stores. With `REDIS_HOST` set, Socket.IO uses a Redis client manager (with `REDIS_PASSWORD`) so several server processes can share connections; its buffer is raised to 4 MB to allow 3 MB uploads after base64 encoding.

Sources: [openhands/server/shared.py:1-77](repo://openhands/server/shared.py#L1-L77)

`ServerConfig` names the implementation of each pluggable part as a class path, loaded with `get_impl`. A deployment replaces any of them by pointing `OPENHANDS_CONFIG_CLS` at a `ServerConfig` subclass, which is how the [[Enterprise Server]] adds its own authentication and stores.

Sources: [openhands/server/config/server_config.py:8-60](repo://openhands/server/config/server_config.py#L8-L60)

| Setting | Default |
| --- | --- |
| `app_mode` | `OSS` |
| `conversation_manager_class` | `StandaloneConversationManager`, or `CONVERSATION_MANAGER_CLASS` |
| `settings_store_class` | `FileSettingsStore` |
| `secret_store_class` | `FileSecretsStore` |
| `conversation_store_class` | `FileConversationStore` |
| `user_auth_class` | `DefaultUserAuth` |
| `monitoring_listener_class` | `MonitoringListener` |

Sources: [openhands/server/config/server_config.py:8-32](repo://openhands/server/config/server_config.py#L8-L32)

`get_config` is what the frontend reads at startup through `/api/options/config`: the app mode, GitHub client id, analytics key, and feature flags for billing and hiding LLM settings.

Sources: [openhands/server/config/server_config.py:38-49](repo://openhands/server/config/server_config.py#L38-L49), [openhands/server/routes/public.py:62-69](repo://openhands/server/routes/public.py#L62-L69)

## Authentication

Two mechanisms protect the API. First, when the server has `SESSION_API_KEY` in its environment, `get_dependencies` adds a dependency to every router that rejects requests whose `X-Session-API-Key` header does not match with 401. Without it, the routers have no key check.

Sources: [openhands/server/dependencies.py:1-24](repo://openhands/server/dependencies.py#L1-L24)

Second, routes find out who the user is through `UserAuth`, an abstract class whose docstring describes it as the extension point for authentication: subclass it and set `server_config.user_auth_class`. It provides the user id, email, access token, git provider tokens, settings store and settings, and secrets store and secrets, and `get_instance(request)` builds one per request. The helper functions in `openhands/server/user_auth/__init__.py` (`get_user_id`, `get_provider_tokens`, `get_user_settings` and so on) are what routes use as FastAPI dependencies.

Sources: [openhands/server/user_auth/user_auth.py:23-94](repo://openhands/server/user_auth/user_auth.py#L23-L94), [openhands/server/user_auth/__init__.py:1-56](repo://openhands/server/user_auth/__init__.py#L1-L56)

`DefaultUserAuth`, the open-source default, has no users: the user id, email and access token are `None`, and settings and secrets come from the single file-based stores, so the provider tokens are whatever the user saved in settings. This matches the README's warning that OpenHands is meant for a single user on their own workstation.

Sources: [openhands/server/user_auth/default_user_auth.py:16-94](repo://openhands/server/user_auth/default_user_auth.py#L16-L94), [README.md:114-116](repo://README.md#L114-L116)

## Conversation routes

`/api/conversations` in `manage_conversations.py` is the list of conversations and their lifecycle:

Sources: [openhands/server/routes/manage_conversations.py:78-78](repo://openhands/server/routes/manage_conversations.py#L78-L78)

| Route | Purpose |
| --- | --- |
| `POST /api/conversations` | Create a conversation, optionally with a repository, branch, first message and images, and start its agent loop |
| `GET /api/conversations` | Page through conversations (`page_id`, `limit`), dropping ones older than `conversation_max_age_seconds`, with each one's live status |
| `GET /api/conversations/{id}` | One conversation's metadata and status |
| `PATCH /api/conversations/{id}` | Rename |
| `POST /api/conversations/{id}/start` | Start or resume the agent loop |
| `POST /api/conversations/{id}/stop` | Stop the agent loop |
| `DELETE /api/conversations/{id}` | Close the session, delete the runtime and the metadata |

Sources: [openhands/server/routes/manage_conversations.py:81-109](repo://openhands/server/routes/manage_conversations.py#L81-L109), [openhands/server/routes/manage_conversations.py:189-300](repo://openhands/server/routes/manage_conversations.py#L189-L300), [openhands/server/routes/manage_conversations.py:330-370](repo://openhands/server/routes/manage_conversations.py#L330-L370), [openhands/server/routes/manage_conversations.py:473-560](repo://openhands/server/routes/manage_conversations.py#L473-L560), [openhands/server/routes/manage_conversations.py:639-660](repo://openhands/server/routes/manage_conversations.py#L639-L660)

Routes under `/api/conversations/{conversation_id}` act on a running conversation. They take it through the `get_conversation` dependency, which asks the conversation manager to attach to it and answers 404 when it is not running.

Sources: [openhands/server/utils.py:96-115](repo://openhands/server/utils.py#L96-L115)

| Route | Purpose |
| --- | --- |
| `GET .../events` | Page through stored events with `start_id`, `end_id`, `reverse`, a filter and `limit` (at most 100); returns `has_more` |
| `POST .../events` | Send an event to the conversation, like a socket message |
| `GET .../config`, `.../vscode-url`, `.../web-hosts` | Runtime details for the UI |
| `GET .../microagents` | The microagents loaded for the conversation |
| `GET .../list-files` | Workspace files from the runtime, minus ignored names and `.gitignore` matches |
| `GET .../select-file` | One file's content |
| `GET .../zip-directory` | Download the workspace as a zip |
| `POST .../upload-files` | Upload files into the workspace |
| `GET .../git/changes`, `.../git/diff` | Changed files and a file's diff |
| `GET .../trajectory` | The conversation as a trajectory |
| `GET .../security/...` | Forwarded to the security analyzer's own API |

Sources: [openhands/server/routes/conversation.py:19-104](repo://openhands/server/routes/conversation.py#L19-L104), [openhands/server/routes/conversation.py:105-200](repo://openhands/server/routes/conversation.py#L105-L200), [openhands/server/routes/files.py:30-117](repo://openhands/server/routes/files.py#L30-L117), [openhands/server/routes/files.py:118-221](repo://openhands/server/routes/files.py#L118-L221), [openhands/server/routes/files.py:222-318](repo://openhands/server/routes/files.py#L222-L318), [openhands/server/routes/trajectory.py:12-50](repo://openhands/server/routes/trajectory.py#L12-L50), [openhands/server/routes/security.py:14-42](repo://openhands/server/routes/security.py#L14-L42)

The events route reads straight from an `EventStore` on the file store rather than going through the session, so it also works for conversations that are not currently running. It asks for one more event than the limit to know whether more remain. [[Event Stream]] describes the store.

Sources: [openhands/server/routes/conversation.py:105-169](repo://openhands/server/routes/conversation.py#L105-L169)

The file routes call the runtime on a worker thread: `list-files` uses `runtime.list_files` and then reads `.gitignore` through a `FileReadAction` to filter the list, and the git routes use the runtime's `get_git_changes` and `get_git_diff`, which [[Runtime Architecture]] describes.

Sources: [openhands/server/routes/files.py:43-110](repo://openhands/server/routes/files.py#L43-L110), [openhands/server/routes/files.py:222-286](repo://openhands/server/routes/files.py#L222-L286)

## Settings, secrets and options

| Router | Routes |
| --- | --- |
| Settings (`settings.py`) | `GET /api/settings`, `POST /api/settings` (merges with what is stored and validates provider tokens), `POST /api/reset-settings` (now answers 410 Gone) |
| Secrets (`secrets.py`) | `POST /api/add-git-providers`, `POST /api/unset-provider-tokens`, `GET`, `POST`, `PUT` and `DELETE` on `/api/secrets` for custom secrets |
| Git (`git.py`, OSS mode only) | `/api/user/installations`, `/repositories`, `/info`, `/search/repositories`, `/search/branches`, `/suggested-tasks`, `/repository/branches`, and microagent listings |
| Options (`public.py`) | `GET /api/options/models`, `/agents`, `/security-analyzers`, `/config` |
| Feedback (`feedback.py`) | `POST /api/conversations/{id}/submit-feedback` |
| Health (`health.py`) | `GET /alive`, `/health`, `/server_info` |

Sources: [openhands/server/routes/settings.py:25-93](repo://openhands/server/routes/settings.py#L25-L93), [openhands/server/routes/settings.py:133-180](repo://openhands/server/routes/settings.py#L133-L180), [openhands/server/routes/secrets.py:100-215](repo://openhands/server/routes/secrets.py#L100-L215), [openhands/server/routes/secrets.py:255-350](repo://openhands/server/routes/secrets.py#L255-L350), [openhands/server/routes/git.py:35-130](repo://openhands/server/routes/git.py#L35-L130), [openhands/server/routes/git.py:132-250](repo://openhands/server/routes/git.py#L132-L250), [openhands/server/routes/git.py:292-360](repo://openhands/server/routes/git.py#L292-L360), [openhands/server/routes/public.py:11-69](repo://openhands/server/routes/public.py#L11-L69), [openhands/server/routes/feedback.py:14-67](repo://openhands/server/routes/feedback.py#L14-L67), [openhands/server/routes/health.py:1-17](repo://openhands/server/routes/health.py#L1-L17)

The settings and secrets routes persist through the stores described in [[Storage]]. The git router is only mounted in OSS mode; it calls the provider services described in [[Git Provider Integrations]] with the user's tokens.

Sources: [openhands/server/app.py:81-85](repo://openhands/server/app.py#L81-L85), [openhands/server/routes/settings.py:133-180](repo://openhands/server/routes/settings.py#L133-L180)
