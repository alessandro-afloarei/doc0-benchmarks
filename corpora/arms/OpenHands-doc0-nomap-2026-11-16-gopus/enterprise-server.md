---
title: "Enterprise Server"
---
## Overview

The `enterprise/` directory holds the server behind OpenHands Cloud. It is not a separate product: it imports the open-source FastAPI app and extends it, adding authentication, multi-user storage in a database, a conversation manager that spans several server processes, billing, and integrations that start conversations from GitHub, GitLab, Jira, Linear and Slack.

Sources: [enterprise/README.md:1-12](repo://enterprise/README.md#L1-L12), [enterprise/saas_server.py:40-58](repo://enterprise/saas_server.py#L40-L58)

> [!WARNING]
> Unlike the rest of the repository, which is MIT-licensed, `enterprise/` is under the Polyform Free Trial License, which limits use to 30 days per calendar year without a commercial license. Its README also marks it as a work in progress.

Sources: [enterprise/README.md:1-6](repo://enterprise/README.md#L1-L6), [README.md:161-163](repo://README.md#L161-L163)

## How enterprise extends the core

The README describes two ways the enterprise code is entangled with the open-source code. It stacks on top: enterprise middleware runs on top of the core middleware, and enterprise routers are added to the core app. And it overrides: where the core picks an implementation by class name, enterprise supplies its own, so only one is active at a time.

Sources: [enterprise/README.md:13-25](repo://enterprise/README.md#L13-L25)

The override mechanism is the one described in [[OpenHands Overview]]: `ServerConfig` names each pluggable part by class path, and `OPENHANDS_CONFIG_CLS` replaces the config class itself. `SaaSServerConfig` subclasses it and points every part at an enterprise class.

Sources: [enterprise/server/config.py:51-78](repo://enterprise/server/config.py#L51-L78), [openhands/server/config/server_config.py:52-60](repo://openhands/server/config/server_config.py#L52-L60)

| Part | Core default | Enterprise |
| --- | --- | --- |
| User auth | `DefaultUserAuth` | `SaasUserAuth` |
| Settings store | `FileSettingsStore` | `SaasSettingsStore` |
| Secrets store | `FileSecretsStore` | `SaasSecretsStore` |
| Conversation store | `FileConversationStore` | `SaasConversationStore` |
| Conversation manager | `StandaloneConversationManager` | `ClusteredConversationManager` |
| Monitoring listener | `MonitoringListener` | `SaaSMonitoringListener` |

Sources: [enterprise/server/config.py:59-71](repo://enterprise/server/config.py#L59-L71), [openhands/server/config/server_config.py:16-32](repo://openhands/server/config/server_config.py#L16-L32)

## The SaaS app

`saas_server.py` imports the core app (`openhands.server.app`) and its Socket.IO server, patches the MCP server, and mounts a metrics app at `/internal/metrics`. It adds routers for readiness, authentication and OAuth callbacks, users, billing, API keys, email, feedback, event webhooks and a GitHub proxy. The GitHub and GitLab integration routers are added only when `GITHUB_APP_CLIENT_ID` or `GITLAB_APP_CLIENT_ID` is set, Jira, Jira Data Center and Linear only when enabled, and Slack always.

Sources: [enterprise/saas_server.py:40-98](repo://enterprise/saas_server.py#L40-L98)

It then adds CORS for `PERMITTED_CORS_ORIGINS`, the core cache-control middleware and a middleware that refreshes the auth cookie, sets up rate limiting, serves the frontend build, maps missing and expired credentials to 401 responses, and wraps everything in `socketio.ASGIApp` like the core `listen.py` does.

Sources: [enterprise/saas_server.py:100-130](repo://enterprise/saas_server.py#L100-L130), [openhands/server/listen.py:20-27](repo://openhands/server/listen.py#L20-L27)

## Authentication

The README contrasts the two models. In the open-source server the user pastes a personal access token, which is stored in settings and its presence means "logged in". In the SaaS the user signs in with OAuth, and short-lived provider tokens with refresh tokens are kept on the backend.

Sources: [enterprise/README.md:27-47](repo://enterprise/README.md#L27-L47)

`SaasUserAuth.get_instance` tries an API key first: a `Bearer` token in the `Authorization` header is validated against the API key store and exchanged for the user's stored offline token. Otherwise it reads the `keycloak_auth` cookie, a JWT signed with the server's secret that holds Keycloak access and refresh tokens. With neither it raises `NoCredentialsError`. Each authenticated user's requests are rate limited once per request.

Sources: [enterprise/server/auth/saas_user_auth.py:205-280](repo://enterprise/server/auth/saas_user_auth.py#L205-L280)

The access token is refreshed through Keycloak when it has expired, retrying on Keycloak errors. Provider tokens for GitHub, GitLab and others are fetched from Keycloak as identity-provider tokens for the user and refreshed as needed, which is what the core `ProviderHandler` gets when it asks for the latest token, as [[Git Provider Integrations]] describes. Settings and secrets stores are created per user id.

Sources: [enterprise/server/auth/saas_user_auth.py:36-90](repo://enterprise/server/auth/saas_user_auth.py#L36-L90), [enterprise/server/auth/saas_user_auth.py:120-204](repo://enterprise/server/auth/saas_user_auth.py#L120-L204)

The README flags one fragile point: the open-source server is built around the git token the user sets, while the enterprise server is built around the user id from the cookie, and code on both sides depends on that difference.

Sources: [enterprise/README.md:49-56](repo://enterprise/README.md#L49-L56)

## Clustered conversations

Several SaaS server processes run at once, so a conversation's agent loop may live in a different process from the browser's socket. `ClusteredConversationManager` extends the standalone manager from [[Conversations and Sessions]] with Redis. Its docstring lists what it adds: cross-server message passing through Redis pub/sub, tracking conversations and connections across the cluster, recovery from server failures, conversation limits enforced cluster-wide, and cleanup of stale entries.

Sources: [enterprise/server/clustered_conversation_manager.py:60-76](repo://enterprise/server/clustered_conversation_manager.py#L60-L76)

Each process marks its running conversations under `ohcnv:<user_id>:<conversation_id>` and its socket connections under `ohcnct:<user_id>:<conversation_id>:<connection_id>`, refreshing the keys every 5 seconds; a key not refreshed for 15 seconds counts as gone, so entries from a server that stopped refreshing expire. The Redis client is the one Socket.IO already uses when `REDIS_HOST` is set.

Sources: [enterprise/server/clustered_conversation_manager.py:43-49](repo://enterprise/server/clustered_conversation_manager.py#L43-L49), [enterprise/server/clustered_conversation_manager.py:78-105](repo://enterprise/server/clustered_conversation_manager.py#L78-L105), [enterprise/server/clustered_conversation_manager.py:212-235](repo://enterprise/server/clustered_conversation_manager.py#L212-L235), [openhands/server/shared.py:37-52](repo://openhands/server/shared.py#L37-L52)

When a process is asked to send an event to a conversation or close one that it does not host locally, it publishes the request on the `session_msg` channel. Every process listens there and acts on messages for its own sessions: `event` forwards an event to the local session, `close_session` closes it, `session_closing` handles another server shutting down, and `llm_completion` runs a side completion for a conversation.

Sources: [enterprise/server/clustered_conversation_manager.py:107-200](repo://enterprise/server/clustered_conversation_manager.py#L107-L200), [enterprise/server/clustered_conversation_manager.py:366-388](repo://enterprise/server/clustered_conversation_manager.py#L366-L388)

## Integrations

Each integration (GitHub, GitLab, Jira, Jira DC, Linear, Slack) has a manager implementing the `Manager` interface: `receive_message` from the platform, `is_job_requested` to decide whether the message asks for work, `start_job` to launch an OpenHands conversation, and `send_message` to post back.

Sources: [enterprise/integrations/manager.py:1-30](repo://enterprise/integrations/manager.py#L1-L30)

`GithubManager` shows the pattern. A job is requested by a labelled issue or a mention, from a user with write access to the repository, and not by OpenHands' own suggestion comments. It acknowledges the request with an "eyes" reaction, then starts a conversation for the issue or PR and registers a callback processor so the result is reported back. It plays the role the [[Issue Resolver]]'s GitHub Action plays for self-hosted repositories.

Sources: [enterprise/integrations/github/github_manager.py:38-156](repo://enterprise/integrations/github/github_manager.py#L38-L156), [enterprise/integrations/github/github_manager.py:157-260](repo://enterprise/integrations/github/github_manager.py#L157-L260)

Reporting back is done by conversation callbacks. A `ConversationCallback` row in the database records a conversation id, a status (`ACTIVE`, `COMPLETED` or `ERROR`), a processor type and its serialized configuration; processors for GitHub, GitLab, Jira, Jira DC, Linear and Slack react to the conversation's events and post summaries to the platform.

Sources: [enterprise/server/conversation_callback_processor/README.md:1-30](repo://enterprise/server/conversation_callback_processor/README.md#L1-L30)

## Storage and migrations

Where the open-source server keeps settings, secrets and metadata in files, the enterprise stores keep them in a SQL database through SQLAlchemy: user settings, secrets, conversation metadata, auth and offline tokens, API keys, billing and subscription records, integration workspaces and users, and experiment assignments. The schema is managed with Alembic, configured in `alembic.ini` with migrations under `enterprise/migrations/versions`.

Sources: [enterprise/storage/database.py:1-20](repo://enterprise/storage/database.py#L1-L20), [enterprise/storage/saas_settings_store.py:1-40](repo://enterprise/storage/saas_settings_store.py#L1-L40), [enterprise/alembic.ini:1-10](repo://enterprise/alembic.ini#L1-L10)

They implement the store interfaces described in [[Storage]], which the core routes and sessions call.

Sources: [openhands/storage/settings/settings_store.py:9-36](repo://openhands/storage/settings/settings_store.py#L9-L36), [openhands/storage/secrets/secrets_store.py:9-36](repo://openhands/storage/secrets/secrets_store.py#L9-L36)
