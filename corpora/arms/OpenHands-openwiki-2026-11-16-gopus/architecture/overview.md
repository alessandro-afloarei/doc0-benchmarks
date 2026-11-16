---
type: architecture
title: System Architecture Overview
description: End-to-end architecture of OpenHands — how the event stream connects the agent controller, agents, LLM layer, sandbox runtime, memory, and the server/CLI front ends — and the control flow of a conversation from first message to finish.
tags: [architecture, overview, event-driven, control-flow]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-2129d0084f64a3f5714baf90
    resource: repo://openhands/controller/agent_controller.py
  - id: openwiki-source-c24e3823e9e99279e9a9f374
    resource: repo://openhands/core/loop.py
  - id: openwiki-source-d3f14b919d4ae24afe8df275
    resource: repo://openhands/core/main.py
  - id: openwiki-source-61b5d6e6c4155cc8921df93e
    resource: repo://openhands/core/setup.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
  - id: openwiki-source-610d0b16c84de208359adc6c
    resource: repo://openhands/server/session/session.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# System Architecture Overview

OpenHands is an AI software-development agent platform. A user (via web UI, CLI, GitHub resolver, or an evaluation harness) gives a task; an LLM-driven **agent** iteratively issues **actions** (shell commands, file edits, browsing, MCP tool calls, messages) that are executed inside a sandboxed **runtime**, whose **observations** feed the next LLM call.

The Python backend lives in `openhands/`; the React UI in `frontend/`; the proprietary SaaS extensions in `enterprise/`; benchmarks in `evaluation/`.

## Components

```
            ┌──────────────┐   Socket.IO / REST    ┌──────────────────────────┐
  Browser ─▶│  frontend/   │◀────────────────────▶│ openhands/server          │
            └──────────────┘                       │  ConversationManager      │
  CLI ──────────────────────────────────────────┐  │   └ Session/AgentSession  │
  Resolver / evaluation ──── core/main.py ────┐ │  └────────────┬─────────────┘
                                              ▼ ▼               ▼
                         ┌──────────────── EventStream (per conversation) ────────────────┐
                         │ subscribers: AGENT_CONTROLLER · RUNTIME · MEMORY · SERVER/MAIN  │
                         └───────┬──────────────────┬──────────────────┬──────────────────┘
                                 ▼                  ▼                  ▼
                        AgentController       Runtime client        Memory
                          └ Agent (CodeAct)     └ HTTP ─▶ action_execution_server
                              └ LLM (litellm)        (inside Docker/remote/K8s/local sandbox)
                              └ Condenser            └ bash, IPython, editor, browser, MCP
                                                                          │
                         FileStore (local / S3 / GCS / memory) ◀──────────┘ events, state, metadata
```

| Component | Responsibility | Page |
| --- | --- | --- |
| `EventStream` | Ordered, persisted, secret-masked pub/sub of all events | [Events and the Event Stream](event-stream.md) |
| `AgentController` | Decides when to step, enforces limits, manages state/delegation/confirmation | [Agent Controller and State](agent-controller.md) |
| `Agent` | Policy: state → next action (CodeAct by default) | [Agents](../agents/agenthub.md) |
| `LLM` / `LLMRegistry` | Model calls, retries, function-call emulation, metrics | [LLM Layer](llm-layer.md) |
| Condensers / `ConversationMemory` | What history the LLM sees and how it is formatted | [Conversation Memory and Condensers](memory-and-condensers.md) |
| `Memory` | Injects workspace context and microagent knowledge | [Microagents](../concepts/microagents.md) |
| `Runtime` | Executes actions in a sandbox and returns observations | [Runtime Architecture](../runtime/runtime-architecture.md) |
| Server | REST + Socket.IO API, conversation lifecycle, settings/secrets | [Web Server](../server/web-server.md) |

All coordination happens through events: components never call each other to perform a step. The controller publishes an action; the runtime (subscribed as `RUNTIME`) executes it and publishes an observation whose `cause` is the action id; the controller (subscribed as `AGENT_CONTROLLER`) sees the observation and steps again. Memory (`MEMORY`) answers recall actions. Front ends subscribe as `SERVER` (web) or `MAIN` (CLI / headless) to render events and inject user messages.

## Assembly: headless path

`openhands/core/main.py:run_controller` (used by `python -m openhands.core.main`, the resolver, and evaluation) wires a conversation from helpers in `openhands/core/setup.py`:

1. `create_registry_and_conversation_stats` → per-conversation `LLMRegistry` and `ConversationStats`.
2. `create_agent` → agent class from `config.default_agent`.
3. `create_runtime` → `EventStream(sid, file_store)` and the runtime class from `config.runtime` with the agent's `sandbox_plugins`; then `runtime.connect()` and optional repository clone (`initialize_repository_for_runtime`).
4. `create_memory` → `Memory` subscribed to the stream, loaded with runtime info and repo/global microagents.
5. If MCP is enabled, the default OpenHands MCP stdio server is added and `add_mcp_tools_to_agent` registers MCP tools ([MCP](../integrations/mcp.md)).
6. `create_controller` → restores `State` from the file store if present, else fresh state; optional replay events.
7. Publishes the initial `MessageAction` (or a "get back on track" message when resuming after an error), subscribes a `MAIN` callback that supplies user replies (stdin, `/exit`, or `fake_user_response_fn` such as `auto_continue_response` for unattended runs), and calls `run_agent_until_done` until `FINISHED`, `REJECTED`, `ERROR`, `PAUSED`, or `STOPPED`.
8. Saves state, closes the controller, and optionally writes the trajectory JSON (`save_trajectory_path`).

## Assembly: server path

In the web app, `ConversationManager.maybe_start_agent_loop` creates a `Session` whose `AgentSession.start()` performs the same assembly asynchronously: create and connect the runtime (cloning the selected repository/branch), register provider tokens and custom secrets as event-stream secrets, create `Memory`, add MCP tools **before** the controller so they appear in the system message, create (or replay into) the controller, then publish the initial message plus `ChangeAgentStateAction(RUNNING)`, or `AWAITING_USER_INPUT` if there is no initial message. See [Web Server, Sessions, and Conversation Management](../server/web-server.md).

## One step, end to end

1. A user `MessageAction` is added to the stream.
2. The controller emits a `RecallAction`; `Memory` answers with a `RecallObservation` (repo instructions, runtime hosts, triggered microagents).
3. The controller calls `agent.step(state)`: the condenser produces a view, `ConversationMemory` builds messages, the LLM returns tool calls, which become actions.
4. The controller checks iteration/budget limits, stuck detection, and confirmation/security, then publishes the action and marks it pending.
5. The runtime sends the action over HTTP to the in-sandbox `action_execution_server`, which runs it and returns an observation; the runtime publishes it.
6. The controller clears the pending action and steps again — until the agent emits `AgentFinishAction`, asks the user something (`MessageAction(wait_for_response=True)` → `AWAITING_USER_INPUT`), or errors.

Every event is persisted to the `FileStore`, and state is pickled on every agent-state change, so conversations survive restarts and can be resumed or replayed.

## Deployment shapes

- **Local web app** (`make run`, Docker image `containers/app`): FastAPI server + bundled frontend, Docker runtime containers per conversation.
- **CLI** (`openhands` entrypoint): terminal UI, typically with the CLI or Docker runtime ([CLI](../interfaces/cli.md)).
- **Headless / CI**: `openhands.core.main`, GitHub resolver ([Issue Resolver](../integrations/issue-resolver.md)), and evaluation harnesses ([Evaluation](../evaluation/benchmarks.md)).
- **SaaS** (`enterprise/`): extends the OSS server with auth, databases, clustered/nested conversation managers, and integrations ([Enterprise Server](../enterprise/saas-server.md)).

## Related pages

- [Quickstart](../quickstart.md)
- [Configuration System](../configuration/config-system.md)
- [Runtime Implementations](../runtime/runtime-implementations.md)
