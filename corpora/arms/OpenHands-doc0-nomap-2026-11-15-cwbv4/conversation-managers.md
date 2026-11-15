---
title: "Conversation Managers"
---
## Overview

A conversation manager owns every running agent loop of a server process: it starts loops when a conversation is created or reopened, routes incoming events to the right one, tracks which browser connections watch which conversation, limits how many run at once, and closes idle ones. The server talks to it only through the `ConversationManager` interface, and `ServerConfig.conversation_manager_class` picks the implementation, so the same routes can drive loops in the server process, in separate containers, or across a cluster.

Sources: [openhands/server/conversation_manager/conversation_manager.py:20-100](repo://openhands/server/conversation_manager/conversation_manager.py#L20-L100), [openhands/server/conversation_manager/conversation_manager.py:101-160](repo://openhands/server/conversation_manager/conversation_manager.py#L101-L160), [openhands/server/config/server_config.py:25-28](repo://openhands/server/config/server_config.py#L25-L28)

The per-conversation objects a manager creates, `WebSession` and `AgentSession`, are described on [[Sessions and Socket.IO]].

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:296-367](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L296-L367)

## The interface

| Method | Purpose |
| --- | --- |
| `__aenter__`, `__aexit__` | entered by the app's lifespan; start background work and the runtime class's `setup`/`teardown` |
| `maybe_start_agent_loop(sid, settings, user_id, initial_user_msg, replay_json)` | start the loop if it is not running; return its `AgentLoopInfo` |
| `join_conversation(sid, connection_id, settings, user_id)` | add a socket connection to the conversation and start its loop |
| `send_to_event_stream(connection_id, data)`, `send_event_to_conversation(sid, data)` | deliver a client event |
| `attach_to_conversation`, `detach_from_conversation` | give REST routes a `ServerConversation` and release it |
| `get_running_agent_loops`, `get_connections`, `get_agent_loop_info` | report running loops, connections and their status |
| `disconnect_from_session`, `close_session` | drop a connection, stop a loop |
| `request_llm_completion(sid, service_id, llm_config, messages)` | a side completion with the conversation's LLM registry |
| `get_instance(sio, config, file_store, server_config, monitoring_listener)` | factory used by `shared.py` |

Sources: [openhands/server/conversation_manager/conversation_manager.py:20-100](repo://openhands/server/conversation_manager/conversation_manager.py#L20-L100), [openhands/server/conversation_manager/conversation_manager.py:101-160](repo://openhands/server/conversation_manager/conversation_manager.py#L101-L160), [openhands/server/shared.py:61-68](repo://openhands/server/shared.py#L61-L68)

## Creating a conversation

`POST /api/conversations` calls `create_new_conversation` in `conversation_service.py`, which works in two steps:

Sources: [openhands/server/services/conversation_service.py:164-202](repo://openhands/server/services/conversation_service.py#L164-L202)

1. `initialize_conversation` saves `ConversationMetadata` (trigger, title `Conversation <id prefix>`, user, repository, branch, provider) for a new id, or loads the existing metadata.
2. `start_conversation` loads the user's settings and refuses to start without them (`MissingSettingsError`) or without an LLM API key, except for Bedrock models (`LLMAuthenticationError`). It builds `ConversationInitData` from the settings, tokens, secrets, repository, instructions and MCP config, applies any experiment variant, wraps the first message and images in a `MessageAction`, and calls `conversation_manager.maybe_start_agent_loop`.

Sources: [openhands/server/services/conversation_service.py:34-75](repo://openhands/server/services/conversation_service.py#L34-L75), [openhands/server/services/conversation_service.py:78-161](repo://openhands/server/services/conversation_service.py#L78-L161), [openhands/server/services/conversation_service.py:164-202](repo://openhands/server/services/conversation_service.py#L164-L202)

The resolver, the Slack and Jira integrations and the GUI all create conversations through this service; the `conversation_trigger` field records which.

Sources: [openhands/server/services/conversation_service.py:164-177](repo://openhands/server/services/conversation_service.py#L164-L177)

## StandaloneConversationManager

### Agent loops in the server process

The default manager runs each conversation's `WebSession` in the server process and keeps them in `_local_agent_loops_by_sid`, with socket connections in `_local_connection_id_to_session_id`. `maybe_start_agent_loop` reuses a running session or calls `_start_agent_loop`, which builds the conversation's LLM registry and stats from the user's settings, creates the session, starts `initialize_agent` as a background task and returns immediately, so the HTTP request does not wait for the sandbox.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:53-90](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L53-L90), [openhands/server/conversation_manager/standalone_conversation_manager.py:280-367](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L280-L367)

`join_conversation` puts the connection into the room `room:<sid>` before starting the loop, so the client receives everything the new session sends. Client events are dispatched to the session found through the connection or conversation id; an unknown id raises.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:151-165](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L151-L165), [openhands/server/conversation_manager/standalone_conversation_manager.py:369-395](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L369-L395)

### Concurrency limit

Before starting a loop, the manager counts the user's running loops. At `max_concurrent_conversations` (default 3) or more, it closes the least recently updated conversations, sending each an `AGENT_ERROR$TOO_MANY_CONVERSATIONS` status first, until there is room.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:296-340](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L296-L340), [openhands/core/config/openhands_config.py:112-114](repo://openhands/core/config/openhands_config.py#L112-L114)

### REST attachments

`attach_to_conversation` returns a `ServerConversation` for REST routes, reusing an active one with a reference count, or a recently detached one, and otherwise creating one that shares the running session's event stream and runtime when there is one. Detached conversations are disconnected by the cleanup task.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:91-177](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L91-L177)

### Cleanup

A background task runs every 15 seconds. It disconnects detached REST conversations, then, if `sandbox.close_delay` is set, closes loops that have not sent anything for that long, are not `RUNNING`, and have no socket connection. When the server stops, it closes all sessions.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:48-49](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L48-L49), [openhands/server/conversation_manager/standalone_conversation_manager.py:179-228](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L179-L228)

`_close_session` disconnects every socket in the conversation, removes the session and closes it, which stops the controller and the runtime.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:429-455](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L429-L455)

### Keeping metadata current

Each started loop also subscribes a callback to its event stream that updates the conversation's metadata on every event: `last_updated_at`, accumulated cost and token counts from the event's metrics, the current git branch after git-related commands, and an LLM-generated title while the title is still the default.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:355-366](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L355-L366), [openhands/server/conversation_manager/standalone_conversation_manager.py:473-563](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L473-L563)

## DockerNestedConversationManager

### One server per conversation

`DockerNestedConversationManager` runs each conversation's agent loop in its own container. The container is the conversation's runtime container, started as a `DockerRuntime` with `main_module='openhands.server'`, so it runs a complete OpenHands server inside. Its environment makes that inner server use the `local` runtime (actions run directly in the same container), a standalone manager, no frontend, a per-conversation session API key, no close delay, and a pre-started warm action server.

Sources: [openhands/server/conversation_manager/docker_nested_conversation_manager.py:46-60](repo://openhands/server/conversation_manager/docker_nested_conversation_manager.py#L46-L60), [openhands/server/conversation_manager/docker_nested_conversation_manager.py:534-620](repo://openhands/server/conversation_manager/docker_nested_conversation_manager.py#L534-L620)

### Starting and talking to it

To start a conversation, the outer manager waits for the container, then calls the inner server's own REST API with the session key: it posts the user's settings, git provider tokens and custom secrets, then `POST /api/conversations` with the first message, repository and the same conversation id. Client events go to the inner `/events` route, and stopping posts `/stop` and polls until the inner conversation reports `STOPPED`.

Sources: [openhands/server/conversation_manager/docker_nested_conversation_manager.py:189-280](repo://openhands/server/conversation_manager/docker_nested_conversation_manager.py#L189-L280), [openhands/server/conversation_manager/docker_nested_conversation_manager.py:296-343](repo://openhands/server/conversation_manager/docker_nested_conversation_manager.py#L296-L343)

The session key is derived from the JWT secret and the conversation id with SHA-256, so the outer server can recompute it without storing it. The inner server's URL comes from the `port` variable of the container.

Sources: [openhands/server/conversation_manager/docker_nested_conversation_manager.py:468-488](repo://openhands/server/conversation_manager/docker_nested_conversation_manager.py#L468-L488)

Socket connections, attach and detach are not supported: browsers connect to the nested server directly, and the outer server reads its events through a `NestedEventStore` (see [[Event Stream]]).

Sources: [openhands/server/conversation_manager/docker_nested_conversation_manager.py:70-88](repo://openhands/server/conversation_manager/docker_nested_conversation_manager.py#L70-L88), [openhands/server/conversation_manager/docker_nested_conversation_manager.py:384-430](repo://openhands/server/conversation_manager/docker_nested_conversation_manager.py#L384-L430)

## Monitoring

`MonitoringListener` receives `on_session_event`, `on_agent_session_start` and `on_create_conversation` calls. The OSS implementation does nothing; a deployment supplies its own through `monitoring_listener_class` to collect metrics.

Sources: [openhands/server/monitoring.py:5-41](repo://openhands/server/monitoring.py#L5-L41)
