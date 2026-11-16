---
type: architecture
title: Enterprise SaaS Layer
description: The enterprise/ package that extends the open-source OpenHands server for the hosted SaaS deployment, covering its server entry point, configuration overrides, SaaS authentication, the clustered conversation manager, billing, third-party integrations, callbacks, storage and migrations, and maintenance tasks.
tags: [enterprise, saas, server, authentication, clustered-conversations, billing, integrations, maintenance]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-ef19300e0224b1c749e7f626
    resource: repo://enterprise/run_maintenance_tasks.py
  - id: openwiki-source-957b5faddd905c3cfecf57d8
    resource: repo://enterprise/saas_server.py
  - id: openwiki-source-f19072456f517a7e9a800aca
    resource: repo://enterprise/server/auth/constants.py
  - id: openwiki-source-3eb5ee6b4c870f49659f879f
    resource: repo://enterprise/server/auth/saas_user_auth.py
  - id: openwiki-source-51b7523b4ee59d9cb4756234
    resource: repo://enterprise/server/clustered_conversation_manager.py
  - id: openwiki-source-45b562095b040bff8b7b5aef
    resource: repo://enterprise/server/config.py
  - id: openwiki-source-df95b599c578e73ed819456a
    resource: repo://enterprise/server/constants.py
  - id: openwiki-source-50d13a3f8c24f3a49234fd56
    resource: repo://openhands/server/config/server_config.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Enterprise SaaS Layer

The `enterprise/` directory holds the code that runs the hosted OpenHands Cloud. It is built on top of
the open-source server rather than beside it: `enterprise/saas_server.py` imports the same FastAPI
application and Socket.IO server from `openhands/server/`, then adds routes, middleware, and
configuration that only the hosted service needs.

**Licensing.** `enterprise/README.md` states that this directory is licensed under the Polyform Free
Trial License, which is not open source and limits use without a commercial license. The rest of the
repository is MIT-licensed. Check `enterprise/LICENSE` before reusing any code from this directory.

## How enterprise extends OSS

The enterprise README describes two kinds of extension, and both appear in the code:

- **Stacking.** Enterprise middleware and routers are added on top of the OSS ones. In SaaS mode both
  sets of middleware run. `saas_server.py` imports `app` from `openhands.server.app` as `base_app`
  (line 40) and adds routers and middleware to it.
- **Replacing.** Only one implementation of a given interface is active at a time, chosen by
  configuration. `SaaSServerConfig` (`enterprise/server/config.py:51`) subclasses `ServerConfig`. The
  OSS `load_server_config` reads `OPENHANDS_CONFIG_CLS` and uses that class when it is set
  (`openhands/server/config/server_config.py:52-60`).

The SaaS configuration selects the enterprise implementations of each pluggable interface
(`enterprise/server/config.py:60-71`):

| Interface | SaaS implementation |
| --- | --- |
| Secrets store | `storage.saas_secrets_store.SaasSecretsStore` |
| Conversation store | `storage.saas_conversation_store.SaasConversationStore` |
| Conversation manager | `server.clustered_conversation_manager.ClusteredConversationManager` (overridable with `CONVERSATION_MANAGER_CLASS`) |
| Monitoring | `server.saas_monitoring_listener.SaaSMonitoringListener` |
| User authentication | `server.auth.saas_user_auth.SaasUserAuth` |

The extension points are described in [Server, Routes, and Conversation Management](../architecture/server-and-conversations.md).

## Server entry point and routes

`enterprise/saas_server.py` loads `.env`, imports the OSS app and Socket.IO server, and then:

- mounts a metrics application at `/internal/metrics` (`saas_server.py:58`);
- includes readiness, GitHub and OAuth authentication, SaaS user, billing, API keys, email, feedback,
  Slack, and email routers (`saas_server.py:60-95`);
- includes the GitHub integration router only when `GITHUB_APP_CLIENT_ID` is set
  (`saas_server.py:60-95`);
- includes Jira, Jira Data Center, and Linear routers only when `ENABLE_JIRA`, `ENABLE_JIRA_DC`, or
  `ENABLE_LINEAR` is `true` (`enterprise/server/auth/constants.py:21-23`);
- mounts the SPA build and wraps the result in Socket.IO (`saas_server.py:110`, `saas_server.py:130`).

Routes live in `enterprise/server/routes/`: `auth.py` and `github_proxy.py` for sign-in and GitHub
calls, `user.py` for SaaS user data, `billing.py` for credits and Stripe, `event_webhook.py` for
inbound event webhooks, `api_keys.py` for programmatic keys, `readiness.py` for health checks,
`feedback.py`, `email.py`, `debugging.py`, and `mcp_patch.py`, an MCP-related route.

## Authentication

`SaasUserAuth` (`enterprise/server/auth/saas_user_auth.py:43`) implements the `UserAuth` interface. It
checks token expiry (`_is_token_expired`, line 79), refreshes tokens (`refresh`, line 69), and resolves
provider tokens (`get_provider_tokens`, line 141). The enterprise README describes the flow: OAuth through
the GitHub app, with a signed cookie that carries the GitHub user ID for later requests. Supporting modules include `token_manager.py`,
`keycloak_manager.py`, `github_utils.py`, `gitlab_sync.py`, and `auth_utils.py`. Errors for missing or
expired credentials are defined in `auth_error.py` and handled by exception handlers in `saas_server.py`
(`saas_server.py:116-128`).

Settings and secrets are stored per user through `SaasSettingsStore` and `SaasSecretsStore`
(`enterprise/storage/saas_settings_store.py`, `enterprise/storage/saas_secrets_store.py`).

## The clustered conversation manager

`ClusteredConversationManager` (`enterprise/server/clustered_conversation_manager.py:60`) extends the
OSS `StandaloneConversationManager`. Its docstring describes distributed conversation management. It
starts each conversation as a nested conversation (`_create_nested_conversation`) rather than running the
agent loop in the server process.

Starting a conversation (`maybe_start_agent_loop`, line 169, then `_start_agent_loop`, line 216) does
these steps:

1. `_start_conversation` (line 252) prepares the conversation:
   - `_setup_experiment_config` applies experiment assignments (line 277);
   - `_setup_nested_settings` copies the user's settings into the nested runtime (line 304);
   - `_setup_provider_tokens` and `_setup_custom_secrets` pass credentials (lines 317, 341);
   - `_get_mcp_config` builds the MCP configuration for the user (line 360).
2. `_create_nested_conversation` (line 373) starts the conversation's runtime.
3. `_wait_for_conversation_ready` (line 416) waits for the nested conversation to become ready.

Messages and LLM completion requests are relayed to the nested conversation through
`send_event_to_conversation` (line 446) and `request_llm_completion` (line 436). Status is read from the
nested runtime (`_get_runtime_status_from_nested_runtime`, line 501). `get_instance` (line 624)
creates the singleton used by `shared.py`.

`SaasNestedConversationManager` (`enterprise/server/saas_nested_conversation_manager.py:86`) is an
alternative implementation of the same interface, with its own event retrieval strategies
(`EventRetrieval`, line 77). `legacy_conversation_manager.py` is also present in the tree.

## Integrations

Third-party integrations live in `enterprise/integrations/`: `github`, `gitlab`, `bitbucket`, `jira`,
`jira_dc`, `linear`, and `slack`, each with a manager, types, and a view for rendering messages. The
shared base class `Manager` (`enterprise/integrations/manager.py:6`) defines `receive_message`,
`send_message`, `is_job_requested`, `start_job`, and `create_outgoing_message`. Each integration
receives a message from the external system, decides whether it requests a job, starts a conversation,
and posts the result back. `solvability/` holds the models and prompts used to estimate whether an
issue is suitable for automatic resolution. `stripe_service.py` handles customer records and payments.

Integration credentials come from environment variables read in `enterprise/server/constants.py`, such
as `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` (lines 58-59), and the Stripe keys (lines 54-55).

## Conversation callbacks

A `ConversationCallback` row (`enterprise/storage/conversation_callback.py`) asks for an action when a
conversation reaches a given state. Callbacks are executed by processors in
`enterprise/server/conversation_callback_processor/`: `slack_callback_processor.py` (class at line 28),
`github_callback_processor.py`, `gitlab_callback_processor.py`, `jira_callback_processor.py`,
`jira_dc_callback_processor.py`, and `linear_callback_processor.py`. A processor posts a summary to the
originating platform. The callback row records its status, `ACTIVE`, `COMPLETED`, or `ERROR`.

## Storage and migrations

`enterprise/storage/` holds the SQLAlchemy models and stores: API keys, auth tokens, billing sessions,
conversation callbacks, experiment assignments, feedback, GitHub and GitLab installations, Jira and
Linear integrations, Slack teams and conversations, maintenance tasks, and proactive conversations.
`storage/database.py` provides `session_maker`. The schema is managed by Alembic, with the environment
in `enterprise/migrations/env.py` and many revision files under `enterprise/migrations/versions/`.
`alembic.ini` at the enterprise root configures the connection.

## Maintenance tasks

`enterprise/run_maintenance_tasks.py` runs queued maintenance work. `run_tasks` (line 33) loops:
it takes the next pending `MaintenanceTask` row, marks it `WORKING`, runs the processor returned by
`task.get_processor()`, and records `COMPLETED` or `ERROR` with the error message. Between tasks it
waits for any configured delay, which lets the job respect rate limits. `set_stale_task_error` (line 23)
marks tasks left in progress by a crashed worker as failed. The processor in
`maintenance_task_processor/` is `UserVersionUpgradeProcessor`, a user-version upgrade job.

## Operational scripts

`enterprise/sync/` contains one-off and scheduled data jobs: Common Room sync and user interaction
enrichment, removal of old proactive conversations, reinstalling GitLab webhooks, and resending
Keycloak messages. These are run manually or from scheduled jobs and are not part of the server
process.

## Configuration

Enterprise settings are read from environment variables in `enterprise/server/constants.py`.
Notable ones:

- `REQUIRE_PAYMENT` gates usage behind billing (line 56);
- `DEFAULT_INITIAL_BUDGET` sets the starting credit for a new user (line 53);
- `STRIPE_API_KEY` and `STRIPE_WEBHOOK_SECRET` configure payments (lines 54-55);
- `LITE_LLM_API_URL`, `LITE_LLM_API_KEY`, and `LITE_LLM_TEAM_ID` configure the LiteLLM proxy (lines 35-39);
- `ENABLE_JIRA`, `ENABLE_JIRA_DC`, and `ENABLE_LINEAR` enable integrations (`auth/constants.py:21-23`).

## Operational notes

- Callback processors and maintenance tasks use the server's database connection. A defect in one
  processor can therefore affect rows used by other parts of the service, so keep processors narrow.
- Because the enterprise code is licensed separately from the rest of the repository, changes to it
  should be reviewed against that license.

## Tests

`enterprise/tests/unit/` covers the managers, auth, integrations, and storage, and `enterprise/tests/`
contains the remaining test modules. Run them with the enterprise Makefile
(`enterprise/Makefile`).

## Related pages

- [Server, Routes, and Conversation Management](../architecture/server-and-conversations.md)
- [Git Provider Integrations and Issue Resolver](../integrations/git-providers-and-resolver.md)
- [Testing and CI](../operations/testing-and-ci.md)
