---
type: concept
title: LLMs, memory and microagents
description: Model-service ownership, retries, context condensation, recall events, and how repository or keyword microagents contribute instructions and tools.
tags: [llm, memory, context, microagents]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:14:39.912Z
sources:
  - id: openwiki-source-846d81305e1163067ac4815f
    resource: repo://openhands/llm/llm_registry.py
  - id: openwiki-source-30e374a20e6e9e785cf0d1b1
    resource: repo://openhands/llm/llm.py
  - id: openwiki-source-fb5e2382ea09f5d9eb14b2ad
    resource: repo://openhands/llm/retry_mixin.py
  - id: openwiki-source-fce2a7562fd3d4a7cda99a98
    resource: repo://openhands/memory/condenser/condenser.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-5d8f5c2af56a4fade5c982a8
    resource: repo://openhands/microagent/microagent.py
generated: { by: "codex", at: "2026-11-16T08:14:39.912Z" }
---

# LLMs, memory and microagents

Model access, history reduction, and knowledge recall solve different problems. `LLM` adapts requests to providers; condensers decide which conversation history the agent sees; `Memory` answers recall actions with workspace information and microagent content. These services feed [CodeAct's step](../architecture/agent-control.md) through explicit interfaces and events.

## Model services and accounting

`LLMRegistry` deep-copies application configuration, creates an active agent LLM, and maps service IDs to instances. Its general `get_llm` method reuses a matching service/configuration and rejects a request to use an existing service ID with a different configuration. New services require a configuration. The agent-specific accessor currently reuses an existing service even when the requested config differs; a TODO records that mismatch. Do not assume delegation automatically reconfigures an existing agent service.

Registry subscribers are notified when services are created and when a subscriber attaches to the active model. This is a seam for conversation-level accounting. Auxiliary completions can use separate service IDs, and routing returns the main agent model for `noop_router` or constructs a configured router.

`LLM` copies its configuration, initializes model capabilities, and builds a LiteLLM completion callable with credentials, endpoint, timeout, output-token limits, and sampling/provider options. Capability handling affects vision, prompt caching, tool calling, and reasoning parameters. Provider-specific adjustments live here, so a request-format change should be checked against this layer rather than only the agent prompt.

Completion logging requires a configured output folder. Completion processing also records cost/token/latency information; the controller synchronizes spending into its task budget. Model costs and context use therefore cross the agent/condenser service boundary.

## Retries and context exhaustion

The retry mixin retries only configured exception types with bounded exponential waiting, an attempt limit, and shutdown-aware stopping. It notifies a retry listener before sleeping. For a no-response error at zero/default temperature it changes the next attempt to temperature 1.0.

This retry mechanism is separate from controller recovery. A malformed action can become an error observation for another agent step. Context-window exhaustion can request condensation when history truncation is enabled. Repeating a transport request and changing the model's history are different recovery operations.

## Condensation is a history view

A condenser receives `state.view` and returns either a smaller `View` or a `Condensation` carrying an action. CodeAct returns the condensation action before requesting another completion; later history views incorporate that event. Condensation is therefore represented in the event history, rather than deleting the persisted conversation log.

Strategies register by configuration type. The condenser interface records diagnostic metadata under `State.extra_data['condenser_meta']`; rolling strategies decide whether the current view needs condensation. Tests cover no-op, observation masking, browser output, recent-event, summarizing, and other strategies, including preservation of initial/summary events.

When investigating missing model context, compare the stored event history with the condenser view and generated prompt. A complete UI transcript does not imply every event is sent in each completion.

## Recall and microagent loading

Memory subscribes to the event stream. Workspace-context recall is handled for user-originated recall actions; knowledge recall accepts user or agent sources. Responses set their `cause` to the recall action ID. Even an empty recall yields a null observation to release the waiting execution flow. Unexpected recall errors emit an `ERROR_MEMORY` runtime status.

Workspace recall combines repository metadata, repo instructions, runtime hosts/working directory, additional instructions, conversation instructions, and any matched knowledge. Knowledge recall searches the query for configured microagent triggers.

Global microagents are loaded first, user microagents from `~/.openhands/microagents/` next, and workspace microagents can subsequently replace same-named entries in the repo/knowledge maps. Repo microagents contribute always-active workspace instructions; knowledge microagents are trigger-based. Repo microagents can also supply MCP configuration during startup.

## Microagent file semantics

`BaseMicroagent.load` parses Markdown/frontmatter and derives names from relative paths when a microagent directory is supplied. Type inference uses inputs first (task), then triggers (knowledge), otherwise repository knowledge. Task metadata adds a slash-name trigger.

The loader recognizes `.cursorrules`, case-insensitive `agents.md`/`agent.md`, and legacy `.openhands_instructions` as repository-instruction formats. Microagent MCP metadata currently requires stdio server configuration; SSE configuration alone is rejected. These are application input formats, not independent running agents.

To extend this area, coordinate metadata validation, runtime discovery, memory loading, prompt rendering, and MCP tool setup. See [MCP/provider integrations](../integrations/tools-providers.md).

## Focused checks

Use `tests/unit/test_llm_registry.py`, `tests/unit/llm/`, `tests/unit/memory/test_memory.py`, `tests/unit/memory/condenser/`, and `tests/unit/microagent/`. Verify model feature conversion and context ordering with focused fixtures before relying on a live-provider evaluation. [Configuration](../operations/configuration.md) explains how named LLM/agent settings reach these components.
