---
title: "Enterprise SaaS Server"
---
## Overview

The enterprise build serves the same API as the open-source server, with extra routers for accounts, integrations and billing, and with conversation managers that run agents outside the web process. `enterprise/saas_server.py` assembles the application. The two enterprise managers extend the core conversation managers: one starts each conversation on a nested server, and the other shares state through Redis between several server instances.

Sources: [enterprise/saas_server.py:47-58](repo://enterprise/saas_server.py#L47-L58) [enterprise/server/saas_nested_conversation_manager.py:86-97](repo://enterprise/server/saas_nested_conversation_manager.py#L86-L97) [enterprise/server/clustered_conversation_manager.py:60-82](repo://enterprise/server/clustered_conversation_manager.py#L60-L82)

## Application assembly

`saas_server.py` reads the frontend directory from the environment and mounts the single-page app at the root. It mounts the metrics application under `/internal/metrics`. It then includes the enterprise routers: readiness, API, OAuth, SaaS user, API keys, Slack, email, feedback, and the integration routers for GitLab, Jira, Jira Data Center and Linear. Some of these are included only when the feature is enabled. The app adds the same cache-control middleware as the open-source server, and it maps credential and expiry errors to their own handlers.

Sources: [enterprise/saas_server.py:47-58](repo://enterprise/saas_server.py#L47-L58) [enterprise/saas_server.py:60-96](repo://enterprise/saas_server.py#L60-L96) [enterprise/saas_server.py:100-110](repo://enterprise/saas_server.py#L100-L110) [enterprise/saas_server.py:117-129](repo://enterprise/saas_server.py#L117-L129) [enterprise/saas_server.py:130-130](repo://enterprise/saas_server.py#L130-L130)

The Socket.IO app wraps this application, as in the open-source server, so the same socket events are served.

Sources: [enterprise/saas_server.py:130-130](repo://enterprise/saas_server.py#L130-L130)

## The nested conversation manager

`SaasNestedConversationManager` runs each agent loop on a nested server. `_start_agent_loop` first checks the conversation limit for the user, then creates a runtime and connects it. `_create_nested_conversation` posts the conversation to `{api_url}/api/conversations` on the nested server, with the conversation id, the first user message and the image list. `_wait_for_conversation_ready` is the call that follows.

Sources: [enterprise/server/saas_nested_conversation_manager.py:216-231](repo://enterprise/server/saas_nested_conversation_manager.py#L216-L231) [enterprise/server/saas_nested_conversation_manager.py:373-412](repo://enterprise/server/saas_nested_conversation_manager.py#L373-L412) [enterprise/server/saas_nested_conversation_manager.py:416-431](repo://enterprise/server/saas_nested_conversation_manager.py#L416-L431)

`send_to_event_stream` and `send_event_to_conversation` carry client messages into a conversation, and `close_session` closes one. The manager also has helpers that set up provider tokens, custom secrets and MCP configuration for each conversation.

Sources: [enterprise/server/saas_nested_conversation_manager.py:432-445](repo://enterprise/server/saas_nested_conversation_manager.py#L432-L445) [enterprise/server/saas_nested_conversation_manager.py:463-483](repo://enterprise/server/saas_nested_conversation_manager.py#L463-L483) [enterprise/server/saas_nested_conversation_manager.py:304-372](repo://enterprise/server/saas_nested_conversation_manager.py#L304-L372)

## The clustered conversation manager

`ClusteredConversationManager` extends the standalone manager for several server instances. It keeps Redis as the channel between them. `_redis_subscribe` runs a pub/sub loop that receives messages from the other instances, and `_process_message` handles each one. Running agent loops can be listed locally or from the other instances, and the event store is looked up by user and conversation id.

Sources: [enterprise/server/clustered_conversation_manager.py:60-82](repo://enterprise/server/clustered_conversation_manager.py#L60-L82) [enterprise/server/clustered_conversation_manager.py:107-134](repo://enterprise/server/clustered_conversation_manager.py#L107-L134) [enterprise/server/clustered_conversation_manager.py:135-212](repo://enterprise/server/clustered_conversation_manager.py#L135-L212) [enterprise/server/clustered_conversation_manager.py:224-258](repo://enterprise/server/clustered_conversation_manager.py#L224-L258)

## Event callbacks

`process_event` takes the user id, conversation id, event subpath and event content, and invokes the callbacks registered for the event.

Sources: [enterprise/server/utils/conversation_callback_utils.py:34-50](repo://enterprise/server/utils/conversation_callback_utils.py#L34-L50)
