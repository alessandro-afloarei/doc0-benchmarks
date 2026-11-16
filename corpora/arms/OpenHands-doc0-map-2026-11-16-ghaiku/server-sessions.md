---
title: "Sessions and Conversation Manager"
---
## Overview

A conversation on the server is held by three objects with different lifetimes. A `WebSession` belongs to one client socket and forwards events to it. An `AgentSession` belongs to one conversation and lives while the agent runs: it owns the runtime, the controller and the memory. The `ConversationManager` owns every `AgentSession` and decides when one starts, when it is kept for reuse, and when it closes.

Sources: [openhands/server/session/session.py:40-73](repo://openhands/server/session/session.py#L40-L73) [openhands/server/session/agent_session.py:42-63](repo://openhands/server/session/agent_session.py#L42-L63) [openhands/server/conversation_manager/conversation_manager.py:20-51](repo://openhands/server/conversation_manager/conversation_manager.py#L20-L51)

## The web session

`WebSession` is the client's side. Its `on_event` and `_on_event` methods receive events from the conversation and send them to the socket, and `dispatch` routes incoming client messages. The routing of events to and from the socket is described in [[HTTP and WebSocket API]].

Sources: [openhands/server/session/session.py:311-352](repo://openhands/server/session/session.py#L311-L352) [openhands/server/session/session.py:353-370](repo://openhands/server/session/session.py#L353-L370)

## Starting an agent session

`AgentSession.start` builds the conversation in order. It creates the runtime and connects it, sets the repository secrets on the event stream when a repository was selected, creates the memory, and adds MCP tools to the agent when the runtime connected and MCP is enabled. A saved trajectory can be replayed before the user's first message. The controller is created after the runtime and memory.

Sources: [openhands/server/session/agent_session.py:135-183](repo://openhands/server/session/agent_session.py#L135-L183) [openhands/server/session/agent_session.py:296-300](repo://openhands/server/session/agent_session.py#L296-L300) [openhands/server/session/agent_session.py:386-390](repo://openhands/server/session/agent_session.py#L386-L390) [openhands/server/session/agent_session.py:448-452](repo://openhands/server/session/agent_session.py#L448-L452)

A second `start` call on a session that already has a controller or runtime is ignored, and a session that was closed before it started does not start.

Sources: [openhands/server/session/agent_session.py:117-126](repo://openhands/server/session/agent_session.py#L117-L126)

`AgentSession.close` marks the session closed and waits for an unfinished start, up to a time limit, before it closes the event stream. It then saves the controller's state and closes the controller.

Sources: [openhands/server/session/agent_session.py:224-250](repo://openhands/server/session/agent_session.py#L224-L250)

## Attach, detach and reuse

`StandaloneConversationManager` keeps two pools. A conversation in `_active_conversations` has a count of attached clients. `attach_to_conversation` returns the active conversation and increments its count. If the conversation is in the detached pool it is reused from there. Otherwise a new conversation is loaded, but only when the session exists in the file store.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:91-120](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L91-L120)

`detach_from_conversation` decrements the count. When the last client leaves, the conversation moves to the detached pool with the current time, so a later attach can reuse it.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:167-178](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L167-L178)

## Starting an agent loop and the concurrency limit

`_start_agent_loop` checks the user's running loops before it starts a new one. When the number of running conversations reaches `max_concurrent_conversations`, it closes the least recently updated conversations and sends them an `AGENT_ERROR$TOO_MANY_CONVERSATIONS` status event.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:296-318](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L296-L318) [openhands/server/conversation_manager/standalone_conversation_manager.py:319-340](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L319-L340)

## Cleanup

`_cleanup_stale` runs in a loop. It disconnects every detached conversation and drops it from the pool. If `sandbox.close_delay` is zero, the loop stops there, so sandboxes stay open. Otherwise it sorts running loops by their last activity and closes any loop idle longer than the delay, unless the agent is still running.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:179-205](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L179-L205) [openhands/server/conversation_manager/standalone_conversation_manager.py:206-228](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L206-L228)

The enterprise managers differ in what they extend: `ClusteredConversationManager` extends this standalone manager, while `SaasNestedConversationManager` extends the `ConversationManager` base. [[Enterprise SaaS Server]] describes them.

Sources: [enterprise/server/clustered_conversation_manager.py:60-60](repo://enterprise/server/clustered_conversation_manager.py#L60-L60) [enterprise/server/saas_nested_conversation_manager.py:86-86](repo://enterprise/server/saas_nested_conversation_manager.py#L86-L86)
