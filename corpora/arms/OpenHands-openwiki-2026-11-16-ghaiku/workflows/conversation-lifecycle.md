---
type: workflow
title: Conversation Lifecycle End to End
description: Trace of a conversation from the first user message through creation, agent-loop start, the controller and runtime step cycle, event delivery to the browser, user confirmations, stop and error paths, and cleanup, with the functions and files that implement each stage.
tags: [workflow, conversation, lifecycle, agent-loop, event-stream, runtime, server]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:08:31.416Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-a21eb8e59e5cc8b245ede396
    resource: repo://openhands/server/conversation_manager/standalone_conversation_manager.py
  - id: openwiki-source-8ba2c1538eda07356c0947f1
    resource: repo://openhands/server/routes/manage_conversations.py
  - id: openwiki-source-ac3a4cd2021762247f5a9861
    resource: repo://openhands/server/services/conversation_service.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
generated: { by: "claude-code", at: "2026-11-16T11:08:31.416Z" }
---

# Conversation Lifecycle End to End

This page follows one conversation through the system. It names the functions at each step so that a
reader can jump into the code. The individual components are described in their own pages:
[Server, Routes, and Conversation Management](../architecture/server-and-conversations.md),
[Agent Controller and Step Loop](../architecture/agent-controller.md),
[Runtime Abstraction and Execution Backends](../architecture/runtime.md), and
[Event Model and Event Stream](../architecture/event-stream.md).

The trace covers the open-source server path. The enterprise server replaces the conversation manager
with a clustered one (see [Enterprise SaaS Layer](../enterprise/saas-server.md)), but the stages that
follow are the same.

## 1. Creating the conversation

A browser sends its first message with `POST /api/conversations`, handled by `new_conversation` in
`openhands/server/routes/manage_conversations.py` (around line 189). The handler calls
`create_new_conversation` (`openhands/server/services/conversation_service.py:164`), which:

1. calls `initialize_conversation` (`conversation_service.py:34`). If no ID was supplied it generates one
   (`uuid4().hex`), and it records the conversation's metadata in the conversation store;
2. calls `start_conversation` (`conversation_service.py:78`).

`start_conversation` wraps the first message in a `MessageAction` when text or images are present
(`conversation_service.py:69-75`). It then calls `maybe_start_agent_loop` on the conversation manager
(`conversation_service.py:76-80`). The response returns the conversation ID and its status.

A conversation can also be started later with `POST /api/conversations/{id}/start`
(`manage_conversations.py:473`), which calls the same `maybe_start_agent_loop` method
(`manage_conversations.py:508`).

## 2. Starting the agent loop

`StandaloneConversationManager.maybe_start_agent_loop`
(`openhands/server/conversation_manager/standalone_conversation_manager.py:280`) reuses a running session
for the same ID. Otherwise `_start_agent_loop` (line 296):

- counts the user's running conversations and, at the limit, notifies and closes the oldest ones
  (see [Server, Routes, and Conversation Management](../architecture/server-and-conversations.md));
- creates the LLM registry and conversation statistics from settings
  (`create_registry_and_conversation_stats`);
- creates a `Session` and calls `session.initialize_agent` (line 354).

`WebSession.initialize_agent` (`openhands/server/session/session.py:132`) runs in this order:

1. adds an `AgentStateChangedObservation` with state `LOADING` to the event stream
   (`session.py:138-141`), so the client shows progress;
2. resolves the agent class from settings or the default agent, and resolves confirmation mode and the
   security analyzer, with per-user settings overriding the configuration (`session.py:144-150`);
3. calls `agent_session.start(...)` (`session.py:265`) with the runtime name, configuration, agent,
   iteration and budget limits, LLM settings per agent, provider tokens, custom secrets, the selected
   repository and branch, and the initial message.

## 3. Building the runtime, controller, and memory

`AgentSession.start` (`openhands/server/session/agent_session.py:90`) refuses to start twice and then
creates its parts:

- `_create_runtime` (line 296) creates and connects the runtime for the configured backend, and runs the
  repository setup described in the runtime page;
- `_create_controller` (line 386) creates the `AgentController` with the agent, the event stream, the
  security analyzer taken from the runtime, and the confirmation mode;
- `_create_memory` (line 448) creates the memory object that subscribes to the event stream.

If a saved trajectory is supplied, `_run_replay` (line 247) replays it before the new message.

Then the session records the start in the event stream:

- when there is an initial message, it adds the message as a `USER` event and then a
  `ChangeAgentStateAction(RUNNING)` (`agent_session.py:192-196`);
- otherwise it adds `ChangeAgentStateAction(AWAITING_USER_INPUT)` (`agent_session.py:198-201`).

The controller only steps while its state is `RUNNING` (see the step gate in the controller page). The
two queued events therefore must be processed in order for the first step to run. The code adds the
message before the state change. Confirm this path under test before reordering the calls.

## 4. The step cycle

Once the loop is running, each turn of the conversation follows the same cycle, driven by the event stream:

1. **Event in.** A user message, a runtime observation, or a memory event is added to the stream with a
   numeric ID. The stream writes it to the conversation's file store and queues it for each subscriber
   (see [Event Model and Event Stream](../architecture/event-stream.md)).
2. **Controller decision.** `AgentController.on_event` receives the event and calls `_on_event`. It
   records the event in history, handles actions and observations, and asks `should_step`. A user message
   or a non-state observation triggers a step (`agent_controller.py:392-432`).
3. **Gates.** `_step` checks the state, the pending-action slot, the stuck detector, and the iteration and
   budget limits (`agent_controller.py:821-870`).
4. **Model call.** `agent.step(state)` builds the prompt from the condensed history, calls the LLM, and
   returns an action (see [Agents, Tools, and Microagents](../architecture/agents-and-tools.md)).
5. **Confirmation.** If confirmation mode is on and the action is one of the checked types, the
   controller may hold it in `AWAITING_CONFIRMATION` until the user responds
   (`agent_controller.py:920-958`; see [Security Model and Sandboxing](../operations/security.md)).
6. **Action in.** The action is added to the stream with the agent as source.
7. **Execution.** The runtime's subscriber receives the action. `Runtime._handle_action` runs it through
   `run_action` or, for MCP tools, `call_tool_mcp` (`openhands/runtime/base.py:361-400`).
8. **Observation in.** The result is added to the stream with the action's ID as its cause. The controller
   receives it and steps again.

The cycle ends when the agent emits an `AgentFinishAction` (the controller sets `FINISHED`), an
`AgentRejectAction` (the controller sets `REJECTED`), or a terminal error.

## 5. Delivering events to the browser

The session's `SERVER` subscriber receives every event and forwards it. `WebSession._on_event`
(`session.py:314`) skips `NullAction` and `NullObservation`, and sends the rest with
`event_to_dict`. Sending goes through a publish queue (`session.py:353-382`), so a slow browser does
not block the agent. Each event reaches the client on the Socket.IO channel for its conversation room.

## 6. Messages and actions from the browser

A message typed in the browser is an `oh_action` Socket.IO event (see
[Server, Routes, and Conversation Management](../architecture/server-and-conversations.md)). It reaches
`WebSession.dispatch` (`session.py:353`), which:

1. parses the event with `event_from_dict`;
2. rejects a message with images when the model does not support vision (`session.py:356-368`);
3. adds the event to the stream as a `USER` event (`session.py:369`).

Confirmation and rejection responses arrive as `oh_user_action` events. The socket handler forwards
them to `send_to_event_stream` (`openhands/server/listen_socket.py:143-146`), so they enter the event stream
like other user input for the controller to act on. The older `oh_action` event takes the same path.

## 7. Stop, pause, and delete

- **Stop.** `POST /api/conversations/{id}/stop` (`manage_conversations.py:534`) reads the loop status and
  calls `conversation_manager.close_session`, which closes the agent session.
- **Delete.** The delete route checks `is_agent_loop_running` and closes the session before removing the
  conversation (`manage_conversations.py:352-364`).
- **Idle.** A background task closes sessions that have been idle longer than `sandbox.close_delay`
  (`standalone_conversation_manager.py:179`).

Closing a session stops the controller (`AgentController.close`, `agent_controller.py:270`), closes the
runtime, and releases the registry. The event store keeps the history, so the conversation can be
reopened later and its events replayed.

## 8. Errors and rate limits

Errors at any step go to `AgentController._react_to_exception` (`agent_controller.py:302`), which records
a reason in `state.last_error` and moves the agent to `ERROR`. Some provider errors use specific states:

- an authentication failure, an unavailable service, or an exhausted budget each map to a
  `RuntimeStatus` value, so the UI can show the cause;
- a rate-limit response moves the agent to `RATE_LIMITED`, which the controller reports as
  `AgentState.RATE_LIMITED` (`openhands/core/schema/agent.py:49`, `agent_controller.py:348-356`).

Model-output errors such as malformed tool calls do not stop the loop. The controller records an
`ErrorObservation`, and the model can correct itself on the next step.

Runtime disconnects are reported through the runtime status, and the action is not retried automatically.

## Failure and ordering notes

- **Event order matters.** Events for one conversation are delivered to each subscriber in ID order,
  but the controller's steps run as separate tasks. A state change and a message that arrive together
  can be processed in either order relative to a step that is already scheduled.
- **One loop per conversation.** The manager reuses a running loop for the same ID, so reconnecting a
  browser does not start a second agent.
- **Restart.** The state is saved on every state change (`AgentController.save_state`). A restarted server
  can resume from the saved state and event history.

## Related pages

- [Agent Controller and Step Loop](../architecture/agent-controller.md)
- [Server, Routes, and Conversation Management](../architecture/server-and-conversations.md)
- [Runtime Abstraction and Execution Backends](../architecture/runtime.md)
- [Memory, Context Condensation, and Conversation Memory](memory-and-condensation.md)
