---
type: "Reference"
title: "Enterprise SaaS Platform"
openwiki_generated: true
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-71561775c6b18264dfbe429f
    resource: repo://enterprise/experiments/experiment_manager.py
  - id: openwiki-source-47b9aee7a62d2d775b0c1cb0
    resource: repo://enterprise/migrations/versions/074_create_subscription_access_table.py
  - id: openwiki-source-269fc6634b00dfcdd59e0be2
    resource: repo://enterprise/README.md
  - id: openwiki-source-ef19300e0224b1c749e7f626
    resource: repo://enterprise/run_maintenance_tasks.py
  - id: openwiki-source-957b5faddd905c3cfecf57d8
    resource: repo://enterprise/saas_server.py
  - id: openwiki-source-45b562095b040bff8b7b5aef
    resource: repo://enterprise/server/config.py
  - id: openwiki-source-9774c5719c08a65f3fabd83a
    resource: repo://enterprise/server/conversation_callback_processor/README.md
  - id: openwiki-source-6a7343c64ae6f28c73c791af
    resource: repo://enterprise/server/maintenance_task_processor/README.md
  - id: openwiki-source-345979f4f343ce16c0dac5f1
    resource: repo://enterprise/server/routes/billing.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---


# Enterprise SaaS Platform

`enterprise/` holds the code for the hosted service. It is not a fork. It sits on top of the open-source backend, and the two run together in one process. `enterprise/README.md` describes two kinds of coupling: enterprise code **stacks** on OSS code (middleware from both repositories runs, which can conflict), and it **overrides** OSS implementations (only one is present at a time, selected by dynamic import, for example `SaasServerConfig` replacing `ServerConfig`).

The enterprise license is the Polyform Free Trial License, not the MIT license of the OSS tree. `enterprise/LICENSE` and the warning in `enterprise/README.md` state the terms.

## Entry point and wiring

`enterprise/saas_server.py` builds the application. It imports the OSS Socket.IO server (`openhands.server.listen_socket.sio`) and wraps the OSS FastAPI app with enterprise routes:

- routers for readiness, the GitHub auth API and OAuth callback, SaaS user settings, GitHub and GitLab integrations, API keys, Slack, Jira, Jira Data Center, Linear (the last three when their feature flags are on), email, and conversation feedback;
- a metrics app mounted at `/internal/metrics`;
- CORS, cache-control, and `SetAuthCookieMiddleware` (`enterprise/server/middleware.py`), which attaches the signed user cookie to responses and checks terms-of-service acceptance;
- the built frontend mounted at `/`, and a `NoCredentialsError` handler.

Enterprise also swaps in its own implementations through the OSS extension points: `SaasServerConfig` (`enterprise/server/config.py`, class at ~L51) overrides the server configuration, `SaasNestedConversationManager` (`enterprise/server/saas_nested_conversation_manager.py`, class at ~L86) replaces the conversation manager, and `SaaSGitHubService` replaces the OSS GitHub service for the logged-in user.

## Authentication and token management

The README's authentication comparison is the key to the design. In OSS, the user supplies a personal access token that is stored in settings and the whole app keys off that token. In the SaaS deployment:

- The user signs in through OAuth. The GitHub App issues a short-lived access token and a refresh token.
- Tokens are held by `GithubTokenManager` in the enterprise backend (a file store), not in user settings.
- After OAuth, the server sets a signed cookie carrying the GitHub user ID. Later requests are authenticated by that cookie, and the app resolves identity from the user ID rather than from a token on the request.
- `SaaSGitHubService` uses the manager's token and refreshes it when needed.

The README calls out this as brittle: OSS code paths read `request.state.github_token`, while enterprise code resolves by user ID and ignores that field. Introducing the user ID into OSS would break OSS behavior, so the two are kept apart.

Keycloak is in place for identity (`enterprise/server/auth/keycloak_manager.py`, with `saas_user_auth.py` and `token_manager.py` alongside). The README notes that future authentication will move to Keycloak and that the GitHub token manager will be replaced. API keys for programmatic access are stored in their own table (`enterprise/storage/api_key.py` and `api_key_store.py`) and managed by `enterprise/server/routes/api_keys.py`. Rate limiting is in `enterprise/server/rate_limit.py`.

## Billing

`enterprise/integrations/stripe_service.py` talks to Stripe, and the routes in `enterprise/server/routes/billing.py` expose the user-facing flows:

- `get_credits` (~L74) returns the user's usage and remaining credits, computed by `calculate_credits` (~L65) from LiteLLM user information.
- `get_subscription_access` (~L85) reports whether the user can use paid features.
- `has_payment_method` (~L110) checks for a saved payment method.
- Setup and checkout sessions are created for a payment method (~L118), a checkout (~L134), and a subscription (~L188, plus a GET variant at ~L244).
- `success_callback` (~L258) and `cancel_callback` (~L330) handle Stripe's redirects.

Billing sessions are stored through the enterprise storage layer (`enterprise/storage/billing_session.py`, with its type in `billing_session_type.py`).

## Integrations

Each integration follows the same shape: a `*_manager.py` that handles events from the platform, a `*_types.py` or `models.py` for payloads, a `*_view.py` for user-facing messages, and a route module in `enterprise/server/routes/integration/`.

- **Slack** (`enterprise/integrations/slack/`) starts conversations from Slack messages and posts results back, with its own conversation and user tables.
- **Jira** and **Jira Data Center** (`enterprise/integrations/jira/`, `jira_dc/`) and **Linear** (`linear/`) turn issues into conversations, with workspace and user link tables.
- **GitHub** (`enterprise/integrations/github/`) handles repository events and includes a solvability analysis (`enterprise/integrations/solvability/`) that scores how solvable an issue looks automatically, using a classifier configured from `solvability/data/default-classifier.json` and a summary prompt in `solvability/prompts/`.
- **GitLab** (`enterprise/integrations/gitlab/`) and **Bitbucket** (`enterprise/integrations/bitbucket/`) follow the same pattern.

`enterprise/integrations/manager.py` and `models.py` hold the shared abstractions. Webhooks land in the route modules under `enterprise/server/routes/integration/`.

## Conversation callbacks

A conversation can have callbacks that run when it reaches an event, such as completion. The framework is in `enterprise/server/conversation_callback_processor/`:

- `ConversationCallback` is a database model with the conversation ID, a status (`ACTIVE`, `COMPLETED`, `ERROR`), and a serialized processor (type plus JSON). `get_processor` rebuilds the processor from it.
- `ConversationCallbackProcessor` is the abstract base. Concrete processors send summaries or notifications: GitHub, GitLab, Jira, Jira Data Center, Linear, and Slack each have one.
- `enterprise/server/utils/conversation_callback_utils.py` holds shared helpers for callbacks.

## Maintenance tasks

Background upgrades run through `enterprise/server/maintenance_task_processor/`. A `MaintenanceTask` record has a status (`INACTIVE`, `PENDING`, `WORKING`, `COMPLETED`, `ERROR`), a processor type, and processor JSON. The runner `enterprise/run_maintenance_tasks.py` is started as part of every deploy and does not block it. The current processor, `user_version_upgrade_processor.py`, upgrades stored user settings to a newer data version. Its README says tasks should finish in under a minute.

## Database and migrations

`enterprise/migrations/` holds 74 Alembic revisions (`versions/001_...` through `074_...`), configured by `alembic.ini` and `env.py`. Revisions add tables for feedback, SaaS settings and conversation metadata, billing sessions, offline tokens, user secrets, GitHub App installations, GitLab webhooks, Slack users and conversations, MCP configuration, API keys, Jira/Jira DC/Linear workspaces and conversations, the experiment assignments, and subscription access. Models are declared in `enterprise/storage/`, and the session factory is in `enterprise/storage/database.py`.

## Experiments

`enterprise/experiments/` assigns users to variants of a conversation configuration. `ExperimentManager` and `SaaSExperimentManager` (`experiment_manager.py`, class at ~L16) pick a variant and apply it to a conversation's config. The four variants in `experiment_versions/` cover the default LiteLLM model, a system-prompt change, a Claude-versus-GPT comparison, and the condenser's maximum step count. Assignments are stored in the experiment-assignment table.

## Invariants and failure behavior

- The GitHub user ID in the signed cookie, not a request token, identifies the user in enterprise paths.
- Each callback and maintenance task is a database row with a status (`ConversationCallback` and `MaintenanceTask`), so its state is recorded in the database.
- The maintenance runner gets its database session from `storage.database.session_maker`.

## Operational notes

- The maintenance runner is triggered on deploy and does not block it, per `enterprise/server/maintenance_task_processor/README.md`.
- The Jira, Jira Data Center, and Linear routers are included conditionally in `saas_server.py`.

## Representative tests

- `enterprise/tests/unit/` covers the integrations, the SaaS secrets store (`test_saas_secrets_store.py`), and the Jira DC manager (`integrations/jira_dc/test_jira_dc_manager.py`).

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md)
<!-- openwiki: broken internal link [/openwiki/architecture/storage-persistence.md] link "/openwiki/architecture/storage-persistence.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Storage, Persistence, and Secrets](/openwiki/architecture/storage-persistence.md)
<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md)
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md)
