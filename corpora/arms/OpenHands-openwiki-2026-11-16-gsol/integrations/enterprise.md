---
type: integration
title: Enterprise composition and extension points
description: How the separately packaged enterprise server composes OSS services with SaaS authentication, persistent stores, distributed ownership, and integration callbacks.
tags: [enterprise, server, authentication, redis, extensions]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:50:03.393Z
sources:
  - id: openwiki-source-957b5faddd905c3cfecf57d8
    resource: repo://enterprise/saas_server.py
  - id: openwiki-source-3eb5ee6b4c870f49659f879f
    resource: repo://enterprise/server/auth/saas_user_auth.py
  - id: openwiki-source-51b7523b4ee59d9cb4756234
    resource: repo://enterprise/server/clustered_conversation_manager.py
  - id: openwiki-source-45b562095b040bff8b7b5aef
    resource: repo://enterprise/server/config.py
  - id: openwiki-source-a539887f84cce34b50fca035
    resource: repo://enterprise/storage/saas_secrets_store.py
  - id: openwiki-source-7e3b4bedad14af18fc5d861e
    resource: repo://openhands/server/shared.py
generated: { by: "codex", at: "2026-11-16T06:50:03.393Z" }
---

# Enterprise composition and extension points

`enterprise/` is a separate Python project that depends on `openhands-ai` through the parent directory. It packages top-level modules such as `server`, `storage`, `integrations`, `experiments`, and `sync`. These imports require the enterprise environment/import path; they are not ordinary `openhands.*` modules. Its license is recorded separately in `enterprise/LICENSE` and its package manifest.

## Application composition

The executable application is `enterprise/saas_server.py`, not a separate `enterprise/server/app.py`. It imports the OSS FastAPI application and Socket.IO server, patches the MCP server, adds SaaS routes, and returns another Socket.IO ASGI wrapper.

Additional routes cover authentication/OAuth, user/account, billing, API keys, feedback, email, readiness, metrics, integration webhooks, and nested-runtime events. GitHub/GitLab routes depend on configured application IDs, while Jira, Jira Data Center, and Linear depend on feature switches. The application adds configured CORS, cache control, auth-cookie middleware, static frontend serving, and rate-limit exception handling.

This is composition plus replacement: shared OSS routes remain active, while configured implementations replace service owners. Middleware and shared imports can affect both surfaces. Read [conversation server](../architecture/conversation-server.md) before changing common dependencies.

## Configuration seams

`load_server_config` resolves `OPENHANDS_CONFIG_CLS` as a ServerConfig implementation before `server/shared.py` builds services. The enterprise `server.config.SaaSServerConfig` changes app mode to SaaS and selects:

| Interface | Enterprise selection |
| --- | --- |
| User authentication | `server.auth.saas_user_auth.SaasUserAuth` |
| User settings | `storage.saas_settings_store.SaasSettingsStore` |
| User secrets | `storage.saas_secrets_store.SaasSecretsStore` |
| Conversation metadata | `storage.saas_conversation_store.SaasConversationStore` |
| Conversation manager | ClusteredConversationManager by default, overridable through `CONVERSATION_MANAGER_CLASS` |
| Monitoring | SaaSMonitoringListener |

Configuration verification requires an explicit config path and PostHog key. Config construction may also request GitHub App metadata when credentials are configured. Set the environment before importing server shared state. The repository also contains nested and legacy conversation manager implementations; deployment configuration determines which is used.

## Identity and durable services

The current SaaS auth implementation uses Keycloak-oriented access/refresh tokens and a stable user ID, with cookie and bearer authentication paths. It refreshes expired access tokens, loads per-user settings/secrets, and retrieves identity-provider tokens. Older enterprise README descriptions of a GitHub-user-ID cookie do not fully describe this implementation.

Database setup creates PostgreSQL SQLAlchemy engines and session factories, using direct DB configuration or the Cloud SQL connector. User secrets are loaded by Keycloak user ID and encrypted/decrypted by the secrets store; provider-token handling is separate from those custom secrets. Database schema changes belong in the Alembic migration lifecycle under `enterprise/migrations/`, alongside corresponding store/model changes.

## Cluster ownership and failures

ClusteredConversationManager extends the standalone manager, retaining local sessions while coordinating nodes through Redis. Starting a loop claims an expiring conversation key with `SET NX`; only the claimant starts the local loop. Local conversation and connection keys are refreshed by a background task. The current constants refresh every five seconds with a fifteen-second entry timeout.

Events for a conversation owned elsewhere are published to `session_msg`; the owning node dispatches them locally. The same channel carries close requests and auxiliary completion messages. Redis ownership/connection records are coordination state, while persisted event/checkpoint stores and runtime workspaces provide different recovery resources. Expiry detects missing owners but does not make external tool execution transactional.

Conversation callbacks subscribe to the event stream and hand work back to the manager's main event loop. Callback processors route results to integrations such as GitHub, GitLab, Slack, Jira, and Linear. Maintenance tasks and the Keycloak-to-Resend sync service have separate entrypoints and operational schedules.

## Contributor checks

Run enterprise work in its own Poetry environment. Focused suites include `enterprise/tests/unit/test_clustered_conversation_manager.py`, `test_saas_user_auth.py`, `test_auth_middleware.py`, and settings, secrets, conversation-store, callback, and token-manager tests. Validate shared server changes against OSS tests too.

For model/runtime settings see [configuration](../operations/configuration.md); for credentials and tool exposure see [MCP and Git providers](tools-providers.md). Treat deployment-specific values as configuration rather than inferred defaults from a single local entrypoint.
