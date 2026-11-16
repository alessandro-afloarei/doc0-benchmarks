---
type: component
title: Enterprise (SaaS) Extension
description: How the source-available enterprise/ package stacks on and overrides the OSS server — SaaS server config, Keycloak-based auth, clustered and nested conversation managers, SQL storage with Alembic migrations, chat/issue integrations (GitHub, GitLab, Slack, Jira, Linear), callbacks and maintenance tasks — and its licensing.
tags: [enterprise, saas, keycloak, redis, integrations, migrations, licensing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-d86f93d802e392f9eeca05d4
    resource: repo://enterprise/integrations/manager.py
  - id: openwiki-source-4de6af6a71b889490ed33f04
    resource: repo://enterprise/LICENSE
  - id: openwiki-source-269fc6634b00dfcdd59e0be2
    resource: repo://enterprise/README.md
  - id: openwiki-source-ef19300e0224b1c749e7f626
    resource: repo://enterprise/run_maintenance_tasks.py
  - id: openwiki-source-957b5faddd905c3cfecf57d8
    resource: repo://enterprise/saas_server.py
  - id: openwiki-source-3eb5ee6b4c870f49659f879f
    resource: repo://enterprise/server/auth/saas_user_auth.py
  - id: openwiki-source-51b7523b4ee59d9cb4756234
    resource: repo://enterprise/server/clustered_conversation_manager.py
  - id: openwiki-source-45b562095b040bff8b7b5aef
    resource: repo://enterprise/server/config.py
  - id: openwiki-source-5d5a52038653307044c65964
    resource: repo://enterprise/server/saas_nested_conversation_manager.py
  - id: openwiki-source-b248296dc718a6b645448449
    resource: repo://enterprise/storage/maintenance_task.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Enterprise (SaaS) Extension

`enterprise/` is the code behind OpenHands Cloud. It is **not** MIT-licensed like the rest of the repository: `enterprise/LICENSE` is the PolyForm Free Trial License (usage limited to 30 days per calendar year without a commercial license), as `enterprise/README.md` warns. It has its own `pyproject.toml`, `Dockerfile`, `Makefile`, Alembic setup and tests, and imports OSS modules from `openhands.*` while its own packages (`server`, `storage`, `integrations`) are top-level.

## Two ways enterprise extends OSS

The README describes both:

1. **Stacking** — enterprise adds on top of OSS. `enterprise/saas_server.py` imports the OSS FastAPI app (`openhands.server.app.app`) and the Socket.IO server (`openhands.server.listen_socket.sio`), then adds routers and middleware to that same app: readiness, OAuth/auth, SaaS user routes, billing (Stripe), API keys, GitHub proxy, debugging (non-production), Slack, email, feedback and an event webhook; GitHub/GitLab integration routers are included only when `GITHUB_APP_CLIENT_ID`/`GITLAB_APP_CLIENT_ID` is set and Jira, Jira DC and Linear routers only when their `ENABLE_*` flags are set. It adds CORS (`PERMITTED_CORS_ORIGINS`), cache-control and an auth-cookie middleware, a rate-limit handler, `401` handlers for `NoCredentialsError`/`ExpiredError`, mounts a metrics app under `/internal/metrics`, serves the SPA from `FRONTEND_DIRECTORY`, and finally wraps everything with `socketio.ASGIApp`. The OSS and enterprise middleware both run in SaaS, which the README notes can conflict.
2. **Overriding** — enterprise replaces an OSS implementation via dynamic import. `SaaSServerConfig` (`enterprise/server/config.py`) extends `ServerConfig` with `app_mode = SAAS` and swaps every pluggable class path: `SaasSettingsStore`, `SaasSecretsStore`, `SaasConversationStore`, `ClusteredConversationManager` (default, overridable with `CONVERSATION_MANAGER_CLASS`), `SaaSMonitoringListener` and `SaasUserAuth`. OSS `load_server_config()` picks it up through the `OPENHANDS_CONFIG_CLS` environment variable (see [Configuration](../configuration/configuration.md)). The frontend learns the mode from `/saas` and the server config's feature flags.

## Authentication model

The README's central warning: on OSS the app revolves around the **git provider token** the user pastes into settings, whereas in SaaS it revolves around the **user id** resolved from a signed cookie / Keycloak identity (`server/auth/saas_user_auth.py`, `keycloak_manager.py`, `token_manager.py`). `SaasUserAuth` implements the OSS `UserAuth` interface: it can be built from a bearer API key, a signed cookie or a signed token, refreshes expired tokens, and fetches provider tokens, settings and secrets from enterprise stores rather than from request state. Anything in OSS that assumes `request.state.github_token` must not be reused blindly in SaaS. GitHub access in SaaS uses `SaaSGitHubService` and short-lived app tokens with refresh, versus a plain PAT in OSS.

## Conversation managers

- **`ClusteredConversationManager`** (extends the OSS `StandaloneConversationManager`) coordinates many server instances through **Redis**: a pub/sub channel `session_msg` forwards `event`, `close_session` and LLM-completion messages between servers, and keys such as `ohcnv:{user_id}:{conversation_id}` (conversation active) and `ohcnct:{user_id}:{conversation_id}:{connection_id}` track conversations and connections, refreshed every few seconds with short expiry so crashed servers' entries age out. It bumps `max_concurrent_conversations` by one because it marks a conversation started in Redis *before* counting running ones, preventing races between servers.
- **`SaasNestedConversationManager`** runs each conversation in a **separate runtime** that hosts its own OpenHands server: `maybe_start_agent_loop` checks Redis and the runtime API for status, starts the runtime in the background if stopped, then posts the conversation (settings, provider tokens, custom secrets, experiment config) to the nested server and returns an `AgentLoopInfo` with the nested URL and `session_api_key`. Events are read back through the nested event store (`NestedEventStore`, see [Event stream](../architecture/event-stream.md)). This is why the frontend can connect its socket to a per-conversation URL ([Frontend](../clients/frontend.md)). Both managers enforce a conversation-count limit.

## Storage and migrations

`enterprise/storage/` holds SQLAlchemy models and stores backed by a SQL database (`storage/database.py` `session_maker`): user and conversation metadata, settings and secrets, API keys, auth/offline tokens, billing sessions and Stripe customers, GitHub app installations, GitLab webhooks, Slack/Jira/Linear users and conversations, feedback, proactive conversations, repo maps, maintenance tasks, experiment assignments and so on. Schema evolution is managed with **Alembic**: `enterprise/migrations/versions/001_...` through 05x numbered migrations (feedback table, SaaS settings, billing, Slack, MCP config, user secrets, conversation callbacks, ...), configured by `alembic.ini` and `migrations/env.py`. The SaaS stores implement the same OSS interfaces (`SettingsStore`, `SecretsStore`, `ConversationStore`) so the rest of the [server](../server/server-and-sessions.md) is unchanged.

## Integrations

`enterprise/integrations/` implements a common `Manager` ABC (`receive_message`, `send_message`, `is_job_requested`, `start_job`) with concrete managers and views for GitHub, GitLab, Bitbucket, Slack, Jira, Jira DC and Linear, plus `solvability` (predicting whether an issue is solvable) and Stripe helpers. A webhook or chat message becomes a `Message`; if a job is requested, the manager starts a conversation with the agent. **Conversation callback processors** (`server/conversation_callback_processor/`) persist a `ConversationCallback` row per conversation (status `ACTIVE`/`COMPLETED`/`ERROR`, a processor type and JSON config) and, when the conversation produces events, post summaries back to GitHub, GitLab, Slack, Jira or Linear; `ClusteredConversationManager` calls `invoke_conversation_callbacks(sid, event)` for events it sees.

## Maintenance and operations

- `server/maintenance_task_processor/` + `run_maintenance_tasks.py`: a small framework for short background upgrades (for example the user-version upgrade). Tasks live in the `MaintenanceTask` table with statuses `INACTIVE`/`PENDING`/`WORKING`/`COMPLETED`/`ERROR`; the runner first marks tasks stuck in `WORKING` for over an hour as `ERROR`, then runs pending tasks with retries (3 attempts, 60 s delay). It is triggered on every deploy without blocking it.
- `enterprise/sync/` has scripts for webhook installation, Common Room sync and cleanup jobs.
- `.github/workflows/enterprise-preview.yml` builds preview images for the enterprise server (see [Build and containers](../operations/build-and-containers.md)).

Related: [Server and sessions](../server/server-and-sessions.md), [Git providers](../integrations/git-providers.md), [Storage](../server/storage-and-persistence.md).
