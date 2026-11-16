---
type: integration
title: Enterprise extension boundaries
description: How the enterprise package extends the shared application through server composition, configurable implementations, user-scoped persistence and clustered conversations.
tags: [enterprise, authentication, storage, deployment]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:55:05.802Z
sources:
  - id: openwiki-source-957b5faddd905c3cfecf57d8
    resource: repo://enterprise/saas_server.py
  - id: openwiki-source-51b7523b4ee59d9cb4756234
    resource: repo://enterprise/server/clustered_conversation_manager.py
  - id: openwiki-source-45b562095b040bff8b7b5aef
    resource: repo://enterprise/server/config.py
  - id: openwiki-source-77ffa1b558399f91f8a19aa2
    resource: repo://enterprise/storage/saas_conversation_validator.py
generated: { by: "codex", at: "2026-11-16T16:55:05.802Z" }
---

# Enterprise extension boundaries

## Package and application composition

`enterprise/` is a separately packaged server depending on the root `openhands-ai` package through a local editable dependency. Its manifest declares a POLYFORM license; consult [enterprise/LICENSE](../../enterprise/LICENSE) for its terms. Its imports use top-level names such as `server` and `storage`, so the enterprise environment and import path are part of correct startup.

The actual entrypoint is [saas_server.py](../../enterprise/saas_server.py). It imports the shared FastAPI application and Socket.IO server, patches MCP behavior, adds enterprise routes and middleware, mounts frontend assets and exports another Socket.IO ASGI wrapper. Added capabilities include authentication/OAuth, API keys, billing, metrics, integration webhooks and event webhooks for nested runtimes. GitHub/GitLab and Jira/Linear routes are conditionally enabled by configuration. This is composition over the shared core application, rather than an independent agent engine.

## Implementation replacement

Core server configuration resolves `OPENHANDS_CONFIG_CLS` through the implementation loader. `SaaSServerConfig` changes application mode and selects enterprise settings, secrets, conversation, auth and monitoring implementations. Its default conversation manager is clustered, with an environment override available. `get_config` publishes feature flags and configured identity providers to the browser; server-side route/auth behavior remains authoritative.

Because shared server initialization instantiates these choices during import, select configuration before importing the application. A change to the standalone manager or default file store may not exercise the enterprise implementation that replaces it. Conversely, shared controller, event and runtime changes can affect both applications.

## Identity and durable state

Current `SaasUserAuth` is based on a user ID and token-manager/Keycloak flows. It refreshes access credentials when needed, loads user settings/secrets and resolves provider tokens. The older enterprise README contains historical GitHub-token descriptions; use the current auth code for implementation changes.

The enterprise conversation validator accepts supported bearer API-key authentication or the `keycloak_auth` cookie path, then validates conversation metadata against the authenticated user. API-key validation also requires a stored offline token. Socket authorization therefore depends on identity and conversation ownership, not just possession of a conversation ID.

SQLAlchemy supplies synchronous and asynchronous PostgreSQL engines with optional Cloud SQL connectors. User settings query by Keycloak user ID, migrate versioned records when necessary and decrypt/encrypt sensitive fields at the settings-store boundary. Migrations live under `enterprise/migrations/`. Core event-file storage and enterprise relational metadata have different owners; a database migration alone does not migrate workspace files or arbitrary event records.

## Cluster and integration behavior

`ClusteredConversationManager` extends the standalone manager with Redis pub/sub and expiring state for cross-server conversation and connection tracking. Its lifecycle starts Redis subscription and state-update tasks and cancels them on exit. Redis communication coordinates work across server instances; it does not turn the standalone manager's in-process maps into shared memory. Debug distributed failures across Redis messages, database metadata, event storage and the server owning the actual agent loop.

Integration managers translate provider-specific messages into OpenHands jobs and responses. Their webhook routers, token handling and persisted integration records belong to enterprise, while the core provider abstraction and resolver remain reusable below that layer.

## Change and validation map

Inspect [server/config.py](../../enterprise/server/config.py), [saas_user_auth.py](../../enterprise/server/auth/saas_user_auth.py), [conversation validator](../../enterprise/storage/saas_conversation_validator.py), [database.py](../../enterprise/storage/database.py) and [clustered manager](../../enterprise/server/clustered_conversation_manager.py). Relevant tests include `enterprise/tests/unit/test_saas_user_auth.py` and `test_clustered_conversation_manager.py`; run them in the enterprise dependency environment with required external services mocked or configured.

Related: [conversations](../architecture/conversations.md), [tools and Git](tools-and-git.md), [deployment](../operations/configuration-and-deployment.md), [quickstart](../quickstart.md).
