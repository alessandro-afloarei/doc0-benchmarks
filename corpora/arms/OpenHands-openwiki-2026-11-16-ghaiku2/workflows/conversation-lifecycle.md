---
type: workflow
title: Conversation Lifecycle, End to End
description: One task traced through the running system, from the browser's REST and Socket.IO requests, through session startup and the agent loop, action execution in the sandbox, observations returning to the agent, streaming to the client, persistence, and shutdown, with the code that owns each step.
tags: [workflow, conversation, lifecycle, agent-loop, session-startup, event-flow, persistence, shutdown, server]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:30:54.023Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
generated: { by: "claude-code", at: "2026-11-16T18:30:54.023Z" }
---

# Conversation Lifecycle, End to End

<!-- openwiki: broken internal link [/openwiki/workflows/cli-and-headless.md] link "/openwiki/workflows/cli-and-headless.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
This page follows a single user task through OpenHands in the web server. Every step is a handoff between components described in the architecture pages, so the sequence below is the best way to see how they connect. The headless and CLI paths follow the same loop without the socket layer; see [CLI and Headless Execution](/openwiki/workflows/cli-and-headless.md).

The steps are: create the conversation, start its agent loop, connect the socket and replay, send a message, run the agent loop, return observations to the client, persist, and shut down.

## 1. Create the conversation (REST)

<!-- openwiki: broken internal link [/openwiki/architecture/storage-persistence.md] link "/openwiki/architecture/storage-persistence.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The browser calls `new_conversation` in `openhands/server/routes/manage_conversations.py` (~L190). It writes the conversation's metadata through the conversation store. No agent is running yet. The conversation exists on disk with its directory under `sessions/<sid>/` or `users/<user>/conversations/<sid>/` (see [Storage, Persistence, and Secrets](/openwiki/architecture/storage-persistence.md)).

## 2. Start the agent loop (REST)

<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The browser then calls `start_conversation` (~L474), which calls `conversation_manager.maybe_start_agent_loop` (see [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md)). If a loop for that conversation is already running, the existing session is returned. Otherwise `_start_agent_loop` in `standalone_conversation_manager.py` enforces the per-user cap on running conversations and creates the session.

The session is a `WebSession` that owns an `AgentSession`. `AgentSession.start` (`openhands/server/session/agent_session.py` ~L90) assembles the components in this order:

<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
1. **Runtime** (`_create_runtime`, ~L296): the runtime for the configured `runtime` type is created and connected. For Docker, this starts or attaches to the sandbox and waits for its action execution server. The runtime base class also clones or initializes the repository (`clone_or_init_repo`) during setup (see [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)).
<!-- openwiki: broken internal link [/openwiki/architecture/integrations-and-mcp.md] link "/openwiki/architecture/integrations-and-mcp.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. **Secrets**: provider tokens and custom secrets are set on the event stream with `set_event_stream_secrets`, so they are redacted from stored events from this point on (see [Git Provider Integrations and MCP](/openwiki/architecture/integrations-and-mcp.md) and [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md)).
3. **Memory** (`_create_memory`, ~L448): the memory subscribes to the event stream and is ready to answer recall requests.
4. **MCP tools**: if the runtime is connected and the agent enables MCP, `add_mcp_tools_to_agent` attaches the tools to the agent.
5. **Replay** (if a trajectory is supplied): `_run_replay` (~L247) feeds the saved actions in before live input.
<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
6. **Controller** (`_create_controller`, ~L386): the `AgentController` is created, subscribes to the event stream, and loads any saved state when the conversation is resumed (`_maybe_restore_state`, ~L492). See [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md).

When the components are ready and the session has not been closed, `start` publishes the initial message (if any) with source `USER`, followed by a `ChangeAgentStateAction` to `RUNNING`. With no initial message it publishes `AWAITING_USER_INPUT` instead. The controller reacts to these like any other event.

## 3. Connect the socket and replay (Socket.IO)

The browser opens a Socket.IO connection with the conversation ID, the last event ID it has seen, and its provider list. The `connect` handler in `openhands/server/listen_socket.py` (~L36) validates the user, opens the event log, and replays every stored event after that ID to the client, skipping null and recall events. The state-change observation is sent last. It then joins the conversation through the conversation manager, and the connection starts receiving live events.

## 4. Send a user message (Socket.IO)

A message arrives as an `oh_user_action` event (~L144 of `listen_socket.py`). `send_to_event_stream` passes it to the `WebSession`, whose `dispatch` (`openhands/server/session/session.py` ~L353) converts it with `event_from_dict`, attaches any image URLs, and publishes it to the event stream with source `USER`.

## 5. The agent loop

Publishing an event on the stream starts the loop, because the controller is subscribed to it. `EventStream.add_event` (`openhands/events/stream.py` ~L163) assigns the event an ID, redacts secrets, writes the event to the file store, and queues it for delivery. A background thread hands the event to each subscriber's callback.

For a user message, the controller's `on_event` runs `_on_event` (~L467). The event is recorded in history. `should_step` returns true for a user message, so `_step` runs:

1. The controller checks that the state is `RUNNING`, that no action is pending, and that the agent is not stuck. It then runs the iteration and budget control flags.
<!-- openwiki: broken internal link [/openwiki/architecture/agents-and-prompting.md] link "/openwiki/architecture/agents-and-prompting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/memory-and-context.md] link "/openwiki/architecture/memory-and-context.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/llm-layer.md] link "/openwiki/architecture/llm-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. It calls `agent.step(state)`. For `CodeActAgent` (see [Agents, Prompting, and Delegation](/openwiki/architecture/agents-and-prompting.md)), this condenses the history if needed (see [Memory, Condensation, and Microagents](/openwiki/architecture/memory-and-context.md)), builds the messages, and calls the LLM through `LLM.completion` (see [LLM Layer, Routing, Metrics, and Retries](/openwiki/architecture/llm-layer.md)). The response's tool calls become actions, and the first action is returned.
<!-- openwiki: broken internal link [/openwiki/architecture/security-analysis.md] link "/openwiki/architecture/security-analysis.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. The action is stored as the pending action. In confirmation mode, a high-risk command is marked for confirmation and the agent waits in `AWAITING_USER_CONFIRMATION` (see [Security Analysis and Action Gating](/openwiki/architecture/security-analysis.md)).
4. The action is published with source `AGENT`.

## 6. Execute the action (runtime)

The runtime subscribes to the same stream. Its `_handle_action` (`openhands/runtime/base.py` ~L361) sets a default timeout, exports provider tokens if the action needs them, and runs the action. For a shell command, the Docker runtime sends it to the sandbox's action execution server over HTTP (`ActionExecutionClient.send_action_for_execution`, ~L272 of `action_execution_client.py`). The sandbox serializes execution, so only one action runs at a time. The result comes back as an observation with the action's ID as its `cause`.

If the action was rejected or is still awaiting confirmation, the runtime returns a `UserRejectObservation` or a `NullObservation` instead of running it.

## 7. Return the observation to the agent

The runtime publishes the observation to the stream. The controller's `_handle_observation` matches it to the pending action by `cause` and clears the pending action. `should_step` returns true for an observation, so the controller steps the agent again. This is the core loop: decide, act, observe, decide.

Several agent-level events are not sent through the runtime. A `ChangeAgentStateAction` sets the agent's state, and a `CondensationAction` replaces part of the history with a summary. A `MessageAction` from the agent is a message to the user.

## 8. Stream events to the client

<!-- openwiki: broken internal link [/openwiki/frontend/web-application.md] link "/openwiki/frontend/web-application.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`WebSession._on_event` (`openhands/server/session/session.py` ~L314) forwards events to the browser. Events whose source is the agent or the user are sent with `oh_event`, which carries each action, observation, and message. Some environment events are forwarded as well. The client's `ws-client-provider` passes each `oh_event` to the Redux store, which updates the conversation view (see [Frontend Web Application](/openwiki/frontend/web-application.md)).

When the agent finishes, it emits an `AgentFinishAction`. The controller moves the state to `FINISHED` and publishes an `AgentStateChangedObservation`, which the client receives like any other event. An error, a stop, or a rejection produces the matching state. The loop then waits for the next user message.

## 9. Persistence while running

Every event is written to the file store as it is published, before subscribers see it. The controller's `save_state` (~L1203) persists the agent state through the state tracker, and conversation metadata is kept current by the conversation manager's update callback (`_create_conversation_update_callback`). A reconnecting client replays the stored events from its last event ID.

## 10. Shutdown

<!-- openwiki: broken internal link [/openwiki/architecture/runtime-sandbox.md] link "/openwiki/architecture/runtime-sandbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
A stop request calls `close_session` on the conversation manager, which closes the `AgentSession`. `AgentSession.close` (~L224) marks the session closed, waits for an in-progress start to finish, closes the event stream, saves the controller state and closes the controller, and submits the runtime's `close` to an executor. Docker runtimes keep their containers when `keep_runtime_alive` is set, and otherwise stop them (see [Runtime and Sandbox Execution](/openwiki/architecture/runtime-sandbox.md)).

Two other paths also end a loop. The stale-session cleanup closes conversations that have been idle longer than `sandbox.close_delay`, and starting a new conversation past the per-user cap closes the oldest ones with a status message. Deleting a conversation closes its running session first and then removes the runtime's state for it.

The conversation's stored events, metadata, and state remain on disk after shutdown, so the conversation can be resumed later: the next start restores the saved state and the socket replays the history.

## Invariants across the lifecycle

- A conversation has one running agent loop per process. Repeated start requests reuse it.
- At most one action is pending at a time, and a pending action blocks the next agent step until an observation or a confirmation decision clears it.
- Each event is persisted before it is delivered, and IDs increase monotonically within a conversation.
- Secrets are redacted before storage and delivery, from the moment they are set on the stream.

## Failure behavior

- A failed runtime connection marks the session as not started, and the start fails before the agent runs.
- An LLM error sets the agent to `ERROR`, with a status the client shows. Retryable errors are retried inside `LLM` first.
- A runtime disconnect sets a runtime error status and publishes no observation, so the controller waits for the runtime to recover or the user to stop.
- A failure while a subscriber handles an event is logged and does not stop the other subscribers.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [System Architecture Overview](/openwiki/architecture/overview.md)
<!-- openwiki: broken internal link [/openwiki/architecture/agent-controller.md] link "/openwiki/architecture/agent-controller.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Agent Controller and Step Loop](/openwiki/architecture/agent-controller.md)
<!-- openwiki: broken internal link [/openwiki/architecture/server-sessions.md] link "/openwiki/architecture/server-sessions.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Server, Sockets, and Conversation Sessions](/openwiki/architecture/server-sessions.md)
<!-- openwiki: broken internal link [/openwiki/architecture/event-stream.md] link "/openwiki/architecture/event-stream.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Event Stream, Actions, and Observations](/openwiki/architecture/event-stream.md)
