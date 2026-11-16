---
title: "Conversation Lifecycle"
---
## Overview

A conversation is created by one HTTP request and kept alive by the agent loop it starts. The route creates the metadata, the service layer reads the user's settings and checks them, the conversation manager decides whether a new agent loop may start, and `AgentSession` builds the runtime, memory and controller for it. Stopping a conversation closes that session, and deleting one removes its files. This page follows those steps in order. The socket channel that carries the events while the loop runs is on [[Socket Sessions]], and the objects the session builds are described on [[Agent Controller]] and [[Runtime Core]].

Sources: [openhands/server/routes/manage_conversations.py:189-290](repo://openhands/server/routes/manage_conversations.py#L189-L290), [openhands/server/services/conversation_service.py:164-204](repo://openhands/server/services/conversation_service.py#L164-L204)

## Creating a conversation

`POST /api/conversations` takes the initial message, the repository and branch to work on, and the trigger that started it. A suggested task can stand in for the initial message. The route calls `create_new_conversation`, which first calls `initialize_conversation` to store the metadata, and then `start_conversation` to start the loop.

Sources: [openhands/server/routes/manage_conversations.py:189-240](repo://openhands/server/routes/manage_conversations.py#L189-L240), [openhands/server/services/conversation_service.py:164-200](repo://openhands/server/services/conversation_service.py#L164-L200)

`initialize_conversation` creates a new `ConversationMetadata` and saves it only when the conversation does not already exist. An existing ID returns its saved metadata, so a repeated request does not overwrite the record.

Sources: [openhands/server/services/conversation_service.py:34-77](repo://openhands/server/services/conversation_service.py#L34-L77)

`start_conversation` loads the user's settings and refuses to start without them, raising `MissingSettingsError`. Unless the model is a Bedrock model, it also refuses an empty LLM API key with `LLMAuthenticationError`. The settings and the metadata's repository and branch are combined into a `ConversationInitData`, which is passed through the experiment manager so that an A/B variant can change it.

Sources: [openhands/server/services/conversation_service.py:78-130](repo://openhands/server/services/conversation_service.py#L78-L130), [openhands/server/services/conversation_service.py:131-160](repo://openhands/server/services/conversation_service.py#L131-L160)

The first user message, if there is one, becomes a `MessageAction` with any image URLs. `start_conversation` then calls `maybe_start_agent_loop` on the conversation manager with that message and returns the loop's status.

Sources: [openhands/server/services/conversation_service.py:145-170](repo://openhands/server/services/conversation_service.py#L145-L170)

## Admission

`maybe_start_agent_loop` returns the existing session when one is already running for the conversation ID. Otherwise it starts one. Before it starts, the standalone manager counts the user's running loops. When the count has reached `max_concurrent_conversations`, it finds the oldest conversations, sends the oldest a status error saying there are too many conversations, and closes it, so the new one can start.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:280-295](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L280-L295), [openhands/server/conversation_manager/standalone_conversation_manager.py:296-340](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L296-L340)

The new session is registered in the manager's table before its agent starts. The agent is started as a background task, so the HTTP request returns without waiting for the runtime to come up. Creating the session also creates the LLM registry and the conversation statistics that all of its agents will share.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:340-368](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L340-L368)

## Building the session

`AgentSession.start` builds the parts of one conversation in order: the runtime, then the memory, then the controller. It refuses to start twice. If the session has already been closed it logs a warning and does nothing.

Sources: [openhands/server/session/agent_session.py:90-135](repo://openhands/server/session/agent_session.py#L90-L135), [openhands/server/session/agent_session.py:135-190](repo://openhands/server/session/agent_session.py#L135-L190)

The runtime class is looked up from the runtime name, and built with the session's event stream and the plugins of the agent. Its connect step is awaited before the rest of the session, so a runtime that fails to start stops the session before the agent is created.

Sources: [openhands/server/session/agent_session.py:296-345](repo://openhands/server/session/agent_session.py#L296-L345)

The memory is created next, and it takes the repository and runtime information from the runtime, as described on [[Memory and Recall]]. The controller is created last, with the iteration and budget limits from configuration, and restores the agent state from the conversation's directory when a saved state exists.

Sources: [openhands/server/session/agent_session.py:386-447](repo://openhands/server/session/agent_session.py#L386-L447), [openhands/server/session/agent_session.py:448-482](repo://openhands/server/session/agent_session.py#L448-L482), [openhands/server/session/agent_session.py:492-511](repo://openhands/server/session/agent_session.py#L492-L511)

## Stopping and cleaning up

`POST /stop` reads the conversation's status first. A conversation that is neither starting nor running gets a success response that says it was not running. Otherwise the route calls `close_session`, which closes the session and its runtime.

Sources: [openhands/server/routes/manage_conversations.py:534-580](repo://openhands/server/routes/manage_conversations.py#L534-L580)

When the last client of a session leaves, the session is kept in the detached table. A background task disconnects the detached conversations on each pass. When `sandbox.close_delay` is set, the task then closes the agent loops that are past that delay and have no connected client. With the delay at zero, the task stops after the disconnect step, so no loop is closed for being idle.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:179-229](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L179-L229), [openhands/server/conversation_manager/standalone_conversation_manager.py:410-456](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L410-L456)

`DELETE /api/conversations/{id}` returns `False` when no metadata exists. Otherwise it closes the agent loop if one is running, deletes the runtime's files for the conversation, and deletes the metadata from the store. The file layout is on [[File Stores and Settings]].

Sources: [openhands/server/routes/manage_conversations.py:352-370](repo://openhands/server/routes/manage_conversations.py#L352-L370)
