---
title: "Conversation Lifecycle"
---
## Overview

A conversation is created in two steps over HTTP. `POST /conversations` records the conversation and its metadata. `POST /conversations/{id}/start` loads the user's settings and starts an agent loop for it. The loop is an `AgentSession` with its own event stream, runtime, memory and controller. The client connects over Socket.IO to follow it, which is covered in [[Client Sessions and Socket.IO]].

Sources: [openhands/server/routes/manage_conversations.py:189-200](repo://openhands/server/routes/manage_conversations.py#L189-L200), [openhands/server/routes/manage_conversations.py:473-508](repo://openhands/server/routes/manage_conversations.py#L473-L508)

## Creating the conversation

The `new_conversation` route reads the repository, branch, initial message and suggested task from the request. A suggested task replaces the initial message with the task's prompt. A request that carries a bearer key must include an initial message, or the route returns a 400 error.

Sources: [openhands/server/routes/manage_conversations.py:201-235](repo://openhands/server/routes/manage_conversations.py#L201-L235)

When a repository is named, the route checks it with `ProviderHandler.verify_repo_provider` before it creates anything. The conversation id is taken from the request or is a new UUID hex string. `create_new_conversation` then records the metadata with `initialize_conversation` and calls `start_conversation`, so creation and start happen in one request.

Sources: [openhands/server/routes/manage_conversations.py:243-262](repo://openhands/server/routes/manage_conversations.py#L243-L262), [openhands/server/services/conversation_service.py:164-203](repo://openhands/server/services/conversation_service.py#L164-L203)

The `/start` route is the second entry point. It checks that the conversation metadata exists and returns 404 if it does not. It then builds the init data from the user's providers and calls `maybe_start_agent_loop`, which returns the existing loop when one is running.

Sources: [openhands/server/routes/manage_conversations.py:479-510](repo://openhands/server/routes/manage_conversations.py#L479-L510)

## Resolving the settings

`start_conversation` loads the user's settings from the settings store. If the settings are missing it raises `MissingSettingsError`. If the model is not a Bedrock model and the API key is absent or blank, it raises `LLMAuthenticationError`, and the route returns that error to the client.

Sources: [openhands/server/services/conversation_service.py:99-124](repo://openhands/server/services/conversation_service.py#L99-L124)

Next it adds the git tokens, selected repository and branch, custom secrets and instructions to the settings, and builds a `ConversationInitData`. The first user message becomes a `MessageAction`, and `maybe_start_agent_loop` receives it with the init data.

Sources: [openhands/server/services/conversation_service.py:126-158](repo://openhands/server/services/conversation_service.py#L126-L158)

## Starting the agent loop

`StandaloneConversationManager.maybe_start_agent_loop` returns the session already registered for the id, if there is one. Otherwise it calls `_start_agent_loop`, which counts the user's running loops. When the count reaches `max_concurrent_conversations`, it sends an error status to the oldest conversations and closes them first.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:280-294](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L280-L294), [openhands/server/conversation_manager/standalone_conversation_manager.py:307-333](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L307-L333)

The manager then creates the LLM registry and conversation stats for the session. It registers the `Session` in `_local_agent_loops_by_sid` and runs `initialize_agent` in a new task, so the HTTP request does not wait for the runtime to start. It also subscribes a callback that updates the conversation metadata when events arrive.

Sources: [openhands/server/conversation_manager/standalone_conversation_manager.py:335-367](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L335-L367)

## Building the session

`WebSession.initialize_agent` first adds an `AgentStateChangedObservation` in the `LOADING` state. It then chooses the agent class from the settings and calls `AgentSession.start`.

Sources: [openhands/server/session/session.py:132-141](repo://openhands/server/session/session.py#L132-L141), [openhands/server/session/session.py:265-277](repo://openhands/server/session/session.py#L265-L277)

`AgentSession.start` refuses to start twice. It creates the runtime, then the memory, then the controller. MCP tools are added to the agent when the runtime is connected and the agent enables MCP.

Sources: [openhands/server/session/agent_session.py:90-120](repo://openhands/server/session/agent_session.py#L90-L120), [openhands/server/session/agent_session.py:296-300](repo://openhands/server/session/agent_session.py#L296-L300), [openhands/server/session/agent_session.py:386-390](repo://openhands/server/session/agent_session.py#L386-L390), [openhands/server/session/agent_session.py:448-452](repo://openhands/server/session/agent_session.py#L448-L452)

Once the controller exists, the start code writes the first user message. If there is one, it is added as a `USER` event followed by a `ChangeAgentStateAction` to `RUNNING`, so the loop begins at once. Otherwise the loop is set to `AWAITING_USER_INPUT`.

Sources: [openhands/server/session/agent_session.py:186-202](repo://openhands/server/session/agent_session.py#L186-L202)

## Sending later messages

After the loop starts, a message from the client goes through `WebSession.dispatch`. For an image message the session first checks that the model accepts images, and it sends an error to the client if not. Other messages are added to the event stream as `USER` events, and the controller picks them up from there.

Sources: [openhands/server/session/session.py:353-369](repo://openhands/server/session/session.py#L353-L369)

## Stopping

`POST /conversations/{id}/stop` calls `close_session`. The manager removes the session from its registry and closes it. `AgentSession.close` marks itself closed, closes the event stream and the controller, and submits the runtime close to the executor.

Sources: [openhands/server/routes/manage_conversations.py:535-545](repo://openhands/server/routes/manage_conversations.py#L535-L545), [openhands/server/conversation_manager/standalone_conversation_manager.py:410-413](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L410-L413), [openhands/server/conversation_manager/standalone_conversation_manager.py:447-453](repo://openhands/server/conversation_manager/standalone_conversation_manager.py#L447-L453), [openhands/server/session/agent_session.py:224-246](repo://openhands/server/session/agent_session.py#L224-L246)

The steps inside the loop after this point are covered in [[Agent Controller]].

Sources: [openhands/controller/agent_controller.py:100-115](repo://openhands/controller/agent_controller.py#L100-L115)
