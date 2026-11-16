---
type: integration
title: Enterprise extension boundaries
description: How the enterprise server composes the OSS application, replaces authentication and storage, distributes conversations, and processes callbacks and maintenance work.
tags: [enterprise, authentication, database, integrations]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-6a60c82e752c01ddfddf5b6a
    resource: repo://enterprise/Dockerfile
  - id: openwiki-source-ef19300e0224b1c749e7f626
    resource: repo://enterprise/run_maintenance_tasks.py
  - id: openwiki-source-957b5faddd905c3cfecf57d8
    resource: repo://enterprise/saas_server.py
  - id: openwiki-source-51b7523b4ee59d9cb4756234
    resource: repo://enterprise/server/clustered_conversation_manager.py
  - id: openwiki-source-45b562095b040bff8b7b5aef
    resource: repo://enterprise/server/config.py
  - id: openwiki-source-c2fcc63ac018121eaacf5dca
    resource: repo://enterprise/server/utils/conversation_callback_utils.py
  - id: openwiki-source-cc544ac7c3909a66c3926f61
    resource: repo://enterprise/storage/database.py
  - id: openwiki-source-77ffa1b558399f91f8a19aa2
    resource: repo://enterprise/storage/saas_conversation_validator.py
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# Enterprise extension boundaries

The `enterprise/` tree extends the core application through both composition and replaceable implementations. It has its own dependency manifest, database migrations, tests, Dockerfile, and [license](../../enterprise/LICENSE). Use the current implementation when tracing authentication: parts of `enterprise/README.md` describe older GitHub-centric behavior.

## Composition and configuration

`enterprise/saas_server.py` imports the base FastAPI app and shared Socket.IO server, adds enterprise routes and middleware, mounts the frontend, then wraps the result in a Socket.IO ASGI app. Routes cover auth, API keys, user settings, billing, readiness, event webhooks, and integrations. GitHub/GitLab routes depend on configured app IDs; Jira/Jira DC/Linear use feature flags. This entrypoint imports the base app directly, so do not assume every middleware in the OSS `listen.py` wrapper is also installed.

`SaaSServerConfig` selects SaaS settings, secrets, and conversation stores, SaaS user auth and monitoring, and a clustered conversation manager by default. The core `OPENHANDS_CONFIG_CLS` mechanism loads this config class. Application mode and feature flags also feed frontend behavior.

The enterprise Dockerfile builds on an OpenHands image, installs enterprise dependencies, copies `enterprise/` into `/app`, and runs `uvicorn saas_server:app`. Imports such as `server.*` and `storage.*` assume that layout. The enterprise Makefile contains older relative-path assumptions, so verify its paths before using it as a standalone checkout recipe.

## Identity and conversation ownership

Current SaaS auth uses token-management and Keycloak integration, rather than relying solely on a GitHub PAT in settings. Provider tokens are resolved separately from the application user identity.

For socket conversation access, `SaasConversationValidator` first attempts a bearer API key. On success it validates conversation access for the resolved user. Otherwise it falls back to the signed `keycloak_auth` cookie and token-manager path, then checks access. Missing credentials are rejected. The core default validator is much more permissive, making deployment selection of `OPENHANDS_CONVERSATION_VALIDATOR_CLS` consequential.

Keep four identities distinct when extending this code: application user ID, provider account/token, conversation ID, and runtime/session API key. HTTP auth and Socket.IO conversation validation must agree about ownership. See [sessions and APIs](../architecture/sessions-api.md).

## Distributed state and database storage

`ClusteredConversationManager` extends the standalone manager and starts Redis subscription/state-update tasks on entry. It tracks remote conversation/connection information and routes work between server instances. This depends on Redis coordination in addition to shared socket transport.

Enterprise database setup constructs PostgreSQL engines, either directly from `DB_*` settings or through the Google Cloud SQL connector. Pool size and overflow are configurable. Alembic's environment uses the database engine and model metadata for online migrations; versioned changes live under `enterprise/migrations/versions/`.

Database metadata is not the same thing as event-file storage. Conversation events and checkpoints still participate in the configured FileStore contract. Debugging a conversation may therefore require inspecting both metadata/database state and persisted event artifacts.

## Event callbacks

The event-webhook path feeds `process_event`, which writes incoming event content to the configured user/conversation file-store path. State-change observations trigger active conversation callbacks and update working-time accounting when the agent is no longer running.

Callbacks persist processor type/configuration and status. Invocation reconstructs each processor and calls it; exceptions mark the callback `ERROR` and are committed. Platform processors connect conversation outcomes to Slack, GitHub, GitLab, Jira, and Linear. These processors can have external side effects, so callback tests should mock their provider APIs. Reading or documenting this code does not require running those integrations.

## Maintenance task lifecycle

The maintenance runner first marks tasks that have remained `WORKING` for over one hour as `ERROR`. It selects pending tasks in creation order, commits `WORKING`, invokes the stored processor, and commits either `COMPLETED` with returned info or `ERROR` with exception details. A configured task delay is applied after processing.

A processor returning an error-shaped dictionary does not itself make the runner mark the task `ERROR`; the runner's failure branch is exception-based. Do not assume arbitrary task retries, scheduling, or exactly-once external delivery from these state transitions.

## Checks and extension points

Relevant tests include `enterprise/tests/unit/test_saas_user_auth.py`, callback processor tests, `test_run_maintenance_tasks.py`, and `server/test_conversation_callback_utils.py`. New processors need serialization and failure-path coverage; auth/storage changes need ownership tests as well as happy-path API tests.

Continue to [MCP and provider integrations](tools-providers.md) for credential/tool boundaries, and [configuration](../operations/configuration.md) for the core deployment layer.
