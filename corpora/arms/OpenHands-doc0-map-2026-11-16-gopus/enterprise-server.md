---
title: "Enterprise Server"
---
## Overview

`enterprise/` holds the server behind OpenHands Cloud, the hosted multi-user service. It is not a separate application: it imports the open-source FastAPI app from `openhands.server.app` ([[Server Application]]), adds routes and middleware, and swaps in its own implementations of the extension points the open-source server exposes (authentication, stores, conversation manager, monitoring). It is licensed differently from the rest of the repository, under the Polyform Free Trial License, and its README calls it a work in progress.

Sources: [enterprise/README.md:1-20](repo://enterprise/README.md#L1-L20), [enterprise/saas_server.py:40-130](repo://enterprise/saas_server.py#L40-L130)

> [!WARNING]
> The enterprise code is not open source: usage is limited to 30 days per calendar year without a commercial license.

Sources: [enterprise/README.md:2-3](repo://enterprise/README.md#L2-L3)

## Two ways of extending the core

The README describes how the enterprise code is entangled with the open-source code. Some pieces stack on top: enterprise middleware is added to the same app, so both sets run. Others replace an open-source implementation through dynamic imports, so only one is active.

Sources: [enterprise/README.md:13-20](repo://enterprise/README.md#L13-L20)

The replacement happens through `ServerConfig`. Setting `OPENHANDS_CONFIG_CLS` to the enterprise `SaaSServerConfig` changes every class the shared server objects are built from ([[Server Application]]):

Sources: [openhands/server/config/server_config.py:52-60](repo://openhands/server/config/server_config.py#L52-L60), [openhands/server/shared.py:54-77](repo://openhands/server/shared.py#L54-L77)

| Extension point | Open source | Enterprise |
| --- | --- | --- |
| App mode | `oss` | `saas` |
| Settings store | `FileSettingsStore` | `SaasSettingsStore` |
| Secrets store | `FileSecretsStore` | `SaasSecretsStore` |
| Conversation store | `FileConversationStore` | `SaasConversationStore` |
| Conversation manager | `StandaloneConversationManager` | `ClusteredConversationManager` (or `CONVERSATION_MANAGER_CLASS`) |
| Monitoring listener | `MonitoringListener` | `SaaSMonitoringListener` |
| User auth | `DefaultUserAuth` | `SaasUserAuth` |

Sources: [enterprise/server/config.py:51-78](repo://enterprise/server/config.py#L51-L78), [openhands/server/config/server_config.py:8-32](repo://openhands/server/config/server_config.py#L8-L32)

`SaaSServerConfig.verify_config` requires the config class path and a PostHog key, and the GitHub App client id when a GitHub App is configured. At construction it fetches the GitHub App's slug from `https://api.github.com/app` with a JWT signed by the app's private key.

Sources: [enterprise/server/config.py:82-137](repo://enterprise/server/config.py#L82-L137)

## The SaaS app

`saas_server.py` patches the OpenHands MCP server, then adds to the base app: `/saas`, Prometheus metrics at `/internal/metrics`, readiness checks, authentication and OAuth callbacks, user, billing and API key routes, a GitHub proxy, email and feedback routes, the event webhook for nested runtimes, and integration webhooks for GitHub and GitLab (when their app client ids are set), Slack, and Jira, Jira Data Center and Linear (when enabled).

Sources: [enterprise/saas_server.py:47-98](repo://enterprise/saas_server.py#L47-L98)

It adds CORS for the permitted origins with credentials, cache control, a middleware that sets the auth cookie, the built frontend at `/`, and rate limiting, and maps `NoCredentialsError` and `ExpiredError` to 401 responses. The result is wrapped in the same Socket.IO server as the open-source app.

Sources: [enterprise/saas_server.py:100-130](repo://enterprise/saas_server.py#L100-L130)

## Authentication

In the open-source server the user pastes personal access tokens into settings. In the cloud, users sign in with OAuth and the server issues a signed cookie; the README warns that the whole app is then keyed by user id rather than by token, and that mixing the two causes breakages.

Sources: [enterprise/README.md:26-36](repo://enterprise/README.md#L26-L36), [enterprise/README.md:49-56](repo://enterprise/README.md#L49-L56)

`SaasUserAuth.get_instance` authenticates a request from the `keycloak_auth` signed cookie or from a bearer API key; for MCP clients that drop the `Authorization` header on redirects, it falls back to `X-Session-API-Key`. Provider tokens come from the token manager, and the SaaS GitHub service refreshes them when they expire.

Sources: [enterprise/server/auth/saas_user_auth.py:206-270](repo://enterprise/server/auth/saas_user_auth.py#L206-L270), [enterprise/README.md:38-47](repo://enterprise/README.md#L38-L47)

## Running conversations across servers

### Clustered servers

`ClusteredConversationManager` extends the standalone manager ([[Conversations and Sessions]]) for several server instances sharing one Redis. Each server publishes the conversations and connections it hosts as Redis keys (`ohcnv:<user>:<conversation>` and `ohcnct:<user>:<conversation>:<connection>`), refreshed every five seconds and expiring after 15, and listens on the `session_msg` channel.

Sources: [enterprise/server/clustered_conversation_manager.py:44-133](repo://enterprise/server/clustered_conversation_manager.py#L44-L133)

When a user event arrives at a server that does not host the conversation, the event is published to the channel and the hosting server applies it. The same channel carries close requests, notices that a session is closing, and LLM completion requests and responses. Running-loop and connection counts are computed across the cluster, so the per-user conversation limit holds cluster-wide; the limit is raised by one internally because a conversation is marked as started in Redis before the count is taken, to prevent two servers starting one at the same time.

Sources: [enterprise/server/clustered_conversation_manager.py:135-211](repo://enterprise/server/clustered_conversation_manager.py#L135-L211), [enterprise/server/clustered_conversation_manager.py:239-320](repo://enterprise/server/clustered_conversation_manager.py#L239-L320), [enterprise/server/clustered_conversation_manager.py:83-88](repo://enterprise/server/clustered_conversation_manager.py#L83-L88)

### Nested runtimes

`SaasNestedConversationManager` runs each conversation's agent loop inside a remote sandbox instead, like the open-source Docker nested manager but on the remote runtime API ([[Runtime Implementations]]). `maybe_start_agent_loop` checks Redis and the runtime API for the conversation's state, marks it as starting, and starts it in the background, returning the nested server's URL and session key so the browser connects to the sandbox directly.

Sources: [enterprise/server/saas_nested_conversation_manager.py:86-97](repo://enterprise/server/saas_nested_conversation_manager.py#L86-L97), [enterprise/server/saas_nested_conversation_manager.py:169-250](repo://enterprise/server/saas_nested_conversation_manager.py#L169-L250)

The sandbox runs an OpenHands server with the standalone manager and the local runtime, on fixed ports, with its own file store and a `/workspace/project` workspace. Events get back to the main app in one of three modes: the nested server's file store pushes writes to the main app's `/event-webhook` endpoints (one write or a batch, processed in the background), the main app polls, or nothing is retrieved.

Sources: [enterprise/server/saas_nested_conversation_manager.py:77-83](repo://enterprise/server/saas_nested_conversation_manager.py#L77-L83), [enterprise/server/saas_nested_conversation_manager.py:700-792](repo://enterprise/server/saas_nested_conversation_manager.py#L700-L792), [enterprise/server/routes/event_webhook.py:28](repo://enterprise/server/routes/event_webhook.py#L28), [enterprise/server/routes/event_webhook.py:147-215](repo://enterprise/server/routes/event_webhook.py#L147-L215)

The push mode is what the batched web hook file store was built for ([[Storage]]).

Sources: [openhands/storage/batched_web_hook.py:16-33](repo://openhands/storage/batched_web_hook.py#L16-L33)

## Integrations

### Integration managers

Integrations start conversations from outside the web app: an issue labelled or a comment mentioning OpenHands on GitHub or GitLab, a Slack message, a Jira or Linear ticket. Each integration has a `Manager` with four steps: `receive_message` from the webhook, `is_job_requested` to decide whether to act, `start_job` to start a conversation, and `send_message` to post back.

Sources: [enterprise/integrations/manager.py:1-29](repo://enterprise/integrations/manager.py#L1-L29)

`GithubManager`, for example, acts on labelled issues, issue comments, PR comments and inline PR comments, only from users with write access to the repository, and skips its own suggestion comments. It obtains a GitHub App installation token, reacts with 👀 to acknowledge the request, and starts the job; replies go back as an issue comment or a review-comment reply. Eligible events can also trigger proactive conversation starters.

Sources: [enterprise/integrations/github/github_manager.py:121-216](repo://enterprise/integrations/github/github_manager.py#L121-L216)

### Callbacks to the source

When the agent finishes, the result has to reach the place the request came from. A `ConversationCallback` row stores a processor type and its serialised configuration for a conversation; when the agent's state changes, the processor is rebuilt and called, and for example posts a summary to Slack or GitLab. Processors exist for GitHub, GitLab, Jira, Jira Data Center, Linear and Slack.

Sources: [enterprise/server/conversation_callback_processor/README.md:1-40](repo://enterprise/server/conversation_callback_processor/README.md#L1-L40)

## Background maintenance

Maintenance tasks are short background jobs stored as rows with a status and a processor type, run on every deploy without blocking it, for work such as upgrading stored user settings.

Sources: [enterprise/server/maintenance_task_processor/README.md:1-30](repo://enterprise/server/maintenance_task_processor/README.md#L1-L30)
