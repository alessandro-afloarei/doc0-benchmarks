---
title: "Enterprise Server"
---
## Overview

The `enterprise/` folder holds the server behind OpenHands Cloud. It is not a separate application: it imports the OSS FastAPI app and Socket.IO server, adds its own routes and middleware, and replaces the OSS implementations of authentication, stores and conversation management through the class-path overrides of `ServerConfig`. The code is source-available under the Polyform Free Trial license rather than MIT.

Sources: [enterprise/README.md:1-20](repo://enterprise/README.md#L1-L20), [enterprise/saas_server.py:40-130](repo://enterprise/saas_server.py#L40-L130)

The override mechanism itself is described on [[Server Application and REST API]]; the webhook-driven integrations with GitHub, GitLab, Slack, Jira and Linear are on [[Enterprise Integrations]].

Sources: [openhands/server/config/server_config.py:52-60](repo://openhands/server/config/server_config.py#L52-L60)

## Assembling the app

### saas_server.py

`saas_server.py` patches OpenHands' MCP server, then adds to the OSS `base_app`: a `/saas` marker endpoint, Prometheus metrics at `/internal/metrics`, readiness checks, Keycloak authentication and OAuth callback routes, user routes, billing, API keys, a GitHub API proxy, debugging routes, email, feedback, the event webhook for nested runtimes, and the integration routers (GitHub and GitLab only when their app client ids are set; Jira, Jira Data Center and Linear behind feature flags; Slack always).

Sources: [enterprise/saas_server.py:47-98](repo://enterprise/saas_server.py#L47-L98)

It then adds CORS for `PERMITTED_CORS_ORIGINS`, cache control and the auth-cookie middleware, mounts the frontend from `FRONTEND_DIRECTORY`, installs a rate-limit handler, maps missing and expired credentials to 401 responses, and wraps everything in the shared Socket.IO server, exactly as the OSS `listen.py` does.

Sources: [enterprise/saas_server.py:100-130](repo://enterprise/saas_server.py#L100-L130), [openhands/server/listen.py:20-27](repo://openhands/server/listen.py#L20-L27)

### SaaSServerConfig

Setting `OPENHANDS_CONFIG_CLS` to the enterprise config class makes the shared server objects use these implementations:

Sources: [openhands/server/shared.py:55-77](repo://openhands/server/shared.py#L55-L77)

| Setting | Enterprise value |
| --- | --- |
| `app_mode` | `AppMode.SAAS` |
| `user_auth_class` | `server.auth.saas_user_auth.SaasUserAuth` |
| `settings_store_class`, `secret_store_class`, `conversation_store_class` | `SaasSettingsStore`, `SaasSecretsStore`, `SaasConversationStore` (database-backed) |
| `conversation_manager_class` | `ClusteredConversationManager` by default, or `CONVERSATION_MANAGER_CLASS` |
| `monitoring_listener_class` | `SaaSMonitoringListener` |
| feature flags | billing, hidden LLM settings, Jira, Jira DC, Linear, maintenance window |

Sources: [enterprise/server/config.py:51-80](repo://enterprise/server/config.py#L51-L80)

In SaaS mode the OSS git routes are not mounted, and the OpenHands MCP tools add a link back to the conversation in pull request bodies.

Sources: [openhands/server/app.py:83-84](repo://openhands/server/app.py#L83-L84), [openhands/server/routes/mcp.py:34-49](repo://openhands/server/routes/mcp.py#L34-L49)

## Authentication

### SaasUserAuth

`SaasUserAuth.get_instance` authenticates a request in one of two ways. A bearer API key in the `Authorization` header is checked against the API key store and yields the key's user. Otherwise the `keycloak_auth` cookie holds a token the server signed itself, so the user id and expiry can be read from it without calling Keycloak; an expired access token is refreshed.

Sources: [enterprise/server/auth/saas_user_auth.py:43-96](repo://enterprise/server/auth/saas_user_auth.py#L43-L96), [enterprise/server/auth/saas_user_auth.py:206-300](repo://enterprise/server/auth/saas_user_auth.py#L206-L300)

Provider tokens are not stored as user secrets as in OSS. For each identity provider the user linked through Keycloak, `get_provider_tokens` asks the token manager for a current provider token through Keycloak's identity-provider token exchange, keeping any custom host from the user's secrets; a token that cannot be refreshed is deleted. This is why the enterprise git services can always present a valid OAuth token.

Sources: [enterprise/server/auth/saas_user_auth.py:141-194](repo://enterprise/server/auth/saas_user_auth.py#L141-L194), [enterprise/README.md:21-48](repo://enterprise/README.md#L21-L48)

### Cookies

`SetAuthCookieMiddleware` rewrites the auth cookie when the user's tokens were refreshed during the request (and starts a background GitLab repository sync on re-authentication), and deletes the cookie when authentication failed. The auth routes handle the Keycloak login callback, offline tokens, terms-of-service acceptance, logout and token refresh.

Sources: [enterprise/server/middleware.py:26-100](repo://enterprise/server/middleware.py#L26-L100), [enterprise/server/routes/auth.py:99-110](repo://enterprise/server/routes/auth.py#L99-L110), [enterprise/server/routes/auth.py:255-260](repo://enterprise/server/routes/auth.py#L255-L260), [enterprise/server/routes/auth.py:299-330](repo://enterprise/server/routes/auth.py#L299-L330), [enterprise/server/routes/auth.py:384-420](repo://enterprise/server/routes/auth.py#L384-L420)

## Running conversations at scale

### ClusteredConversationManager

`ClusteredConversationManager` extends the standalone manager for several server instances sharing Redis. Each instance periodically records the conversations it runs in Redis with an expiry, and instances exchange messages through Redis pub/sub, so an event or an LLM request for a conversation can be served by whichever instance holds its agent loop, and concurrency limits count conversations across the cluster.

Sources: [enterprise/server/clustered_conversation_manager.py:43-110](repo://enterprise/server/clustered_conversation_manager.py#L43-L110), [openhands/server/shared.py:37-44](repo://openhands/server/shared.py#L37-L44)

### SaasNestedConversationManager

`SaasNestedConversationManager` runs each agent loop inside its own remote runtime container, like the Docker nested manager on [[Conversation Managers]] but through the remote runtime API. To start a conversation it creates the runtime, then calls the nested server's REST API with the session key to set settings, provider tokens, custom secrets and the experiment configuration, creates the conversation, and waits until it is ready.

Sources: [enterprise/server/saas_nested_conversation_manager.py:86-130](repo://enterprise/server/saas_nested_conversation_manager.py#L86-L130), [enterprise/server/saas_nested_conversation_manager.py:252-276](repo://enterprise/server/saas_nested_conversation_manager.py#L252-L276), [enterprise/server/saas_nested_conversation_manager.py:700-720](repo://enterprise/server/saas_nested_conversation_manager.py#L700-L720)

Events come back from nested runtimes by webhook push to the event webhook route, by polling the nested servers, or not at all, chosen by `EventRetrieval`.

Sources: [enterprise/server/saas_nested_conversation_manager.py:77-83](repo://enterprise/server/saas_nested_conversation_manager.py#L77-L83), [enterprise/server/saas_nested_conversation_manager.py:861-884](repo://enterprise/server/saas_nested_conversation_manager.py#L861-L884)

## Persistence

### The database

Enterprise state lives in PostgreSQL through SQLAlchemy: `storage/database.py` builds a pooled engine either from `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS` and `DB_NAME`, or through the Cloud SQL connector when `GCP_DB_INSTANCE` is set, with sync and async variants. The models in `storage/` cover users' settings, auth and offline tokens, API keys, billing sessions, conversation work and callbacks, integration workspaces and users for Jira, Jira DC and Linear, GitLab webhooks, GitHub app installations, OpenHands-created PRs, experiment assignments, feedback and maintenance tasks.

Sources: [enterprise/storage/database.py:11-80](repo://enterprise/storage/database.py#L11-L80), [enterprise/storage/saas_settings_store.py:38-147](repo://enterprise/storage/saas_settings_store.py#L38-L147)

Schema changes are Alembic migrations in `enterprise/migrations`, and `run_maintenance_tasks.py` runs queued maintenance tasks such as user version upgrades, first marking tasks stuck in progress for over an hour as failed.

Sources: [enterprise/alembic.ini:1-20](repo://enterprise/alembic.ini#L1-L20), [enterprise/run_maintenance_tasks.py:15-70](repo://enterprise/run_maintenance_tasks.py#L15-L70)

## Billing, API keys and experiments

| Area | Routes and behaviour |
| --- | --- |
| Billing | credits balance, subscription access, Stripe customer setup, checkout and subscription sessions, success and cancel callbacks, Stripe webhook |
| API keys | create, list and delete keys for the bearer authentication above; read and refresh the user's LLM key for bring-your-own-key use |
| Experiments | `SaaSExperimentManager` assigns conversations to experiment variants (default model, system prompt, model comparison, condenser size) through the `ExperimentManager` hook that the OSS server calls when starting a conversation |

Sources: [enterprise/server/routes/billing.py:73-140](repo://enterprise/server/routes/billing.py#L73-L140), [enterprise/server/routes/billing.py:187-260](repo://enterprise/server/routes/billing.py#L187-L260), [enterprise/server/routes/billing.py:329-360](repo://enterprise/server/routes/billing.py#L329-L360), [enterprise/server/routes/api_keys.py:177-240](repo://enterprise/server/routes/api_keys.py#L177-L240), [enterprise/server/routes/api_keys.py:275-310](repo://enterprise/server/routes/api_keys.py#L275-L310), [enterprise/experiments/experiment_manager.py:16-60](repo://enterprise/experiments/experiment_manager.py#L16-L60), [openhands/experiments/experiment_manager.py:31-64](repo://openhands/experiments/experiment_manager.py#L31-L64)
