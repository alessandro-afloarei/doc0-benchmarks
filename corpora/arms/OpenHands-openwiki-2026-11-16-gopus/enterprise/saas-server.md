---
type: subsystem
title: Enterprise (SaaS) Server
description: How the source-available enterprise/ package powering OpenHands Cloud extends the open-source server — its saas_server entrypoint, ServerConfig class overrides, Keycloak/API-key authentication, PostgreSQL storage with Alembic migrations, Redis-clustered and nested-runtime conversation managers, and integrations with GitHub, GitLab, Slack, Jira, and Linear.
tags: [enterprise, saas, authentication, database, integrations, conversation-manager]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-3481b2a9964d981f6af50dab
    resource: repo://enterprise/migrations/env.py
  - id: openwiki-source-269fc6634b00dfcdd59e0be2
    resource: repo://enterprise/README.md
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
  - id: openwiki-source-cc544ac7c3909a66c3926f61
    resource: repo://enterprise/storage/database.py
  - id: openwiki-source-50d13a3f8c24f3a49234fd56
    resource: repo://openhands/server/config/server_config.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Enterprise (SaaS) Server

`enterprise/` contains the server used by OpenHands Cloud. It is **not** MIT-licensed: it is under the Polyform Free Trial License (`enterprise/LICENSE`), limited to 30 days of use per calendar year without a commercial license. It builds on the OSS package (`openhands-ai = { path = "../", develop = true }` in `enterprise/pyproject.toml`) and imports its own modules as top-level packages (`server.*`, `storage.*`, `integrations.*`), so it runs with `enterprise/` as the working directory/`/app`.

## How enterprise plugs into OSS

The README describes two mechanisms, both visible in code:

1. **Stacking** — `enterprise/saas_server.py` imports the OSS FastAPI `app` (`openhands.server.app`) and Socket.IO server (`openhands.server.listen_socket.sio`) and adds routers, middleware, and exception handlers on top. Both OSS and SaaS middleware run together.
2. **Overriding** — `openhands/server/config/server_config.py:load_server_config()` instantiates the class named by `OPENHANDS_CONFIG_CLS` via `get_impl`. `SaaSServerConfig` (`enterprise/server/config.py`) sets `app_mode = SAAS` and swaps every pluggable class:

| Seam | OSS default | SaaS override |
| --- | --- | --- |
| `settings_store_class` | `FileSettingsStore` | `storage.saas_settings_store.SaasSettingsStore` |
| `secret_store_class` | `FileSecretsStore` | `storage.saas_secrets_store.SaasSecretsStore` |
| `conversation_store_class` | `FileConversationStore` | `storage.saas_conversation_store.SaasConversationStore` |
| `conversation_manager_class` | `StandaloneConversationManager` | `server.clustered_conversation_manager.ClusteredConversationManager` (overridable via `CONVERSATION_MANAGER_CLASS`) |
| `monitoring_listener_class` | `MonitoringListener` | `server.saas_monitoring_listener.SaaSMonitoringListener` |
| `user_auth_class` | `DefaultUserAuth` | `server.auth.saas_user_auth.SaasUserAuth` |

These seams are described from the OSS side in [Storage, Settings, Secrets, and Auth](../server/storage-and-settings.md).

## Entrypoint: `saas_server.py`

Run as `uvicorn saas_server:app` (`enterprise/Dockerfile`, which layers on the OSS `ghcr.io/all-hands-ai/openhands` image; `enterprise/Makefile` targets `run`/`start-backend`). It:

- Calls `patch_mcp_server()` and adds `GET /saas`.
- Mounts Prometheus metrics at `/internal/metrics` and includes routers for readiness, auth/OAuth, SaaS user, billing (Stripe), API keys, GitHub proxy, debugging, Slack, email, feedback, and the **event webhook** used by nested runtimes.
- Conditionally includes GitHub/GitLab integration webhooks (when `GITHUB_APP_CLIENT_ID` / `GITLAB_APP_CLIENT_ID` are set) and Jira, Jira DC, Linear routers (`ENABLE_JIRA*`, `ENABLE_LINEAR`).
- Adds CORS (`PERMITTED_CORS_ORIGINS`), cache-control, and `SetAuthCookieMiddleware`; serves the SPA from `FRONTEND_DIRECTORY`; sets up rate limiting; maps `NoCredentialsError`/`ExpiredError` to HTTP 401.
- Exposes `app = socketio.ASGIApp(sio, other_asgi_app=base_app)`.

## Authentication

Where OSS users paste personal access tokens into Settings, SaaS users sign in via OAuth backed by **Keycloak** (`server/auth/keycloak_manager.py`, `token_manager.py`). `SaasUserAuth.get_instance(request)`:

1. Tries a **Bearer API key** (`Authorization: Bearer …`, or `X-Session-API-Key` as a fallback for MCP clients that drop the auth header); validates it with `ApiKeyStore` and loads the user's offline refresh token.
2. Otherwise reads the signed `keycloak_auth` **cookie**.
3. Raises `NoCredentialsError` if neither is present, and applies per-user rate limiting once per request.

Provider tokens (GitHub, GitLab, Bitbucket) are fetched/refreshed through the token manager rather than read from settings — the README warns that SaaS code paths are keyed on the user id, not on a token in request state, so the two modes must not be mixed.

## Persistence

- **PostgreSQL via SQLAlchemy** (`storage/database.py`): connects through Cloud SQL Connector when `GCP_DB_INSTANCE` is set, else `DB_HOST`/`DB_PORT`; sync and async session makers; pool size from `DB_POOL_SIZE`.
- **Models and stores** in `storage/`: user settings and secrets, conversation metadata, API keys, offline tokens, billing sessions and Stripe customers, GitHub app installations, GitLab webhooks, Slack/Jira/Linear workspaces, users and conversations, repositories, OpenHands PRs, conversation callbacks, maintenance tasks, experiment assignments, and feedback.
- **Alembic migrations** in `enterprise/migrations/versions/` (numbered `001_…` onward; `alembic.ini`).
- **Redis** (`storage/redis.py`) for clustering and rate limits.

## Conversation managers

- `ClusteredConversationManager` extends the OSS `StandaloneConversationManager` for multiple server replicas: conversations and connections are tracked in Redis keys (`ohcnv:{user_id}:{conversation_id}`, `ohcnct:{user_id}:{conversation_id}:{connection_id}`), cross-server messages travel over Redis pub/sub, and background tasks refresh state, disconnect from stopped conversations, and clean up stale entries while enforcing cluster-wide conversation limits.
- `SaasNestedConversationManager` runs the **agent loop inside the remote runtime container**: it starts a runtime via the remote runtime API, then `POST`s `/api/conversations` to the OpenHands server running *inside* that container with the initial message, repository/branch, provider, MCP config (merged with user settings), and conversation instructions; it injects provider tokens, custom secrets, and experiment config, and reads events back via `NestedEventStore` or webhooks.
- `LegacyConversationManager` (`legacy_conversation_manager.py`) is a temporary migration shim for existing conversations that are not nested.

## Integrations

`enterprise/integrations/` implements a `Manager` interface (`receive_message`, `is_job_requested`, `start_job`, `send_message`) per platform:

- **GitHub** (`github/`): GitHub App webhook handling; checks write access, reacts to comments, mints installation tokens, starts resolver-style conversations for issues/PRs, and includes a solvability classifier (`integrations/solvability/`).
- **GitLab**, **Slack**, **Jira**, **Jira Data Center**, **Linear** (plus a SaaS Bitbucket service): map incoming events/mentions to conversations and post results back.
- **Conversation callback processors** (`server/conversation_callback_processor/`): persisted `ConversationCallback` rows instantiate processors (Slack, GitHub, GitLab, Jira, Linear) that run on `AgentStateChangedObservation`s to post summaries back to the originating platform.

## Operations

- `run_maintenance_tasks.py` processes queued `MaintenanceTask`s (e.g. `user_version_upgrade_processor`), marking stale in-progress tasks as errored and retrying.
- `enterprise/sync/` holds batch jobs (GitLab webhook installation, Common Room sync, proactive conversation cleanup, Keycloak email resend).
- `enterprise/experiments/` manages experiment variants assigned per user/conversation.
- The `enterprise-preview.yml` workflow builds a preview deployment when a PR is labeled `deploy`.

## Tests

`enterprise/tests/unit/` covers auth, stores, integrations, callback processors, and conversation managers; run from `enterprise/` with its own Poetry environment.

## Related pages

- [Web Server, Sessions, and Conversation Management](../server/web-server.md)
- [Storage, Settings, Secrets, and Auth](../server/storage-and-settings.md)
- [Git Provider Integrations](../integrations/git-providers.md)
- [Issue Resolver](../integrations/issue-resolver.md)
