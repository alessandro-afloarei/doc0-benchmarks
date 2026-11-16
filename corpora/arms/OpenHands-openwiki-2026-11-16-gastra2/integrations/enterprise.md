---
type: integration
title: Enterprise extension boundaries
description: How SaaS composes the OSS server with authentication, database stores, clustered conversations, callbacks, and maintenance processors.
tags: [enterprise, saas, authentication, storage, integrations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:51.947Z
sources:
  - id: openwiki-source-957b5faddd905c3cfecf57d8
    resource: repo://enterprise/saas_server.py
  - id: openwiki-source-3eb5ee6b4c870f49659f879f
    resource: repo://enterprise/server/auth/saas_user_auth.py
  - id: openwiki-source-51b7523b4ee59d9cb4756234
    resource: repo://enterprise/server/clustered_conversation_manager.py
  - id: openwiki-source-45b562095b040bff8b7b5aef
    resource: repo://enterprise/server/config.py
  - id: openwiki-source-c2fcc63ac018121eaacf5dca
    resource: repo://enterprise/server/utils/conversation_callback_utils.py
  - id: openwiki-source-cc544ac7c3909a66c3926f61
    resource: repo://enterprise/storage/database.py
  - id: openwiki-source-b248296dc718a6b645448449
    resource: repo://enterprise/storage/maintenance_task.py
  - id: openwiki-source-7e3b4bedad14af18fc5d861e
    resource: repo://openhands/server/shared.py
generated: { by: "codex", at: "2026-11-16T17:43:51.947Z" }
---

# Enterprise extension boundaries

`enterprise/` extends the same agent and server abstractions used by OSS. Its integration points are service replacement, additional routes and middleware, distributed conversation management, and persistent user/integration records. For the directory's licensing terms, consult `enterprise/LICENSE`; it has a separate license from the root project.

## Application composition and import boundary

The SaaS entrypoint is `enterprise/saas_server.py`. It imports the FastAPI app from `openhands.server.app`, adds authentication, billing, API-key, integration, event-webhook, readiness, and metrics routes, applies its middleware, then wraps the app with Socket.IO. It does not simply import the completed OSS `listen:app`, so compare the two entrypoints when investigating middleware differences.

`OPENHANDS_CONFIG_CLS` selects a server-config implementation through `get_impl`. `SaaSServerConfig` changes application mode to SaaS and replaces settings, secrets, conversation store, monitoring, user authentication, and the default conversation manager. Shared OSS initialization resolves these class paths at import time. Set deployment configuration before importing the shared server module.

Enterprise imports use top-level packages such as `server` and `storage`. The enterprise image copies this directory into `/app` and launches `uvicorn saas_server:app`. Local test and process setup must make the same package roots importable. Older instructions and the enterprise Makefile refer to a different `app` layout; verify against the current entrypoint and Dockerfile before using them as launch commands.

## Identity and storage

`SaasUserAuth` carries a user ID, refresh token, optional access token, and user-scoped stores. Access-token lookup refreshes missing or expired tokens through `TokenManager`; Keycloak errors have a bounded retry path. User settings and secrets are obtained through SaaS store implementations. The current source already uses Keycloak-related token management, so the enterprise README's future-tense migration discussion is not a reliable description of current authentication.

Database setup provides synchronous SQLAlchemy sessions and asynchronous sessions for PostgreSQL, with either ordinary connection parameters or a Google Cloud SQL connector. The async engine uses `NullPool` to avoid cross-event-loop pooling problems. Database-backed user and conversation metadata coexist with the configured file store for event/snapshot artifacts. Database migrations under `enterprise/migrations/` and file-store compatibility are separate change concerns.

## Clustered conversations

`ClusteredConversationManager` extends the standalone manager with Redis-backed discovery and cross-server messages. Startup creates Redis subscription and state-refresh tasks; shutdown cancels them. It retains local agent loops while forwarding operations when a conversation lives elsewhere. Redis connectivity and expiring ownership information therefore affect routing even when the individual agent runtime is healthy.

The shared Socket.IO setup can also use an `AsyncRedisManager` when `REDIS_HOST` is set. Socket delivery across processes and conversation ownership are related but distinct mechanisms: check both when updates reach one server instance and not another.

## Integration callbacks and maintenance

The event-webhook processing path persists incoming event content and invokes active conversation callbacks for state-change observations. Callback records store a processor type and configuration. GitHub, GitLab, Slack, Jira, Jira Data Center, and Linear processors translate conversation progress into integration-specific effects. An exception marks the callback `ERROR` and the transaction commits that result; a finished agent does not imply that an external notification succeeded.

Maintenance tasks use a separate persisted lifecycle: `INACTIVE`, `PENDING`, `WORKING`, `COMPLETED`, or `ERROR`. Each record stores the processor class path, serialized configuration, timing fields, and result information. `run_maintenance_tasks.py` is the worker entrypoint; processor implementations include user-settings upgrades. Keep processor configuration compatible with stored records when renaming classes or fields.

## Change and validation boundaries

For an auth or store change, test the SaaS implementation and the OSS interface it replaces. For a provider integration, trace webhook authentication, conversation creation, callback persistence, and final external publication. For clustered behavior, test local and remote routing, disconnects, and cleanup.

Representative tests include `enterprise/tests/unit/test_saas_user_auth.py`, `test_saas_settings_store.py`, `test_clustered_conversation_manager.py`, `test_conversation_callback_processor.py`, and `test_run_maintenance_tasks.py`. See [server lifecycle](../architecture/server-conversations.md), [provider integration](tools-repositories.md), and [configuration](../operations/configuration.md).
