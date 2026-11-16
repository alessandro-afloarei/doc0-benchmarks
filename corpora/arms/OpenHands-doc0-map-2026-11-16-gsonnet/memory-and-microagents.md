---
title: "Conversation Memory and Microagents"
---
## Overview

Two components prepare what the model sees. `Memory` listens for `RecallAction` events and answers with a `RecallObservation` carrying workspace context and any matching microagent knowledge. `ConversationMemory` takes the (condensed) event history, including those observations, and converts it into the list of `Message` objects that [[CodeAct Agent and Agent Catalogue]] sends to the [[LLM Layer]]. Microagents are markdown files that feed the first of these. Shrinking the history before conversion is the job of [[Condensers]].

Sources: [openhands/memory/memory.py:41-44](repo://openhands/memory/memory.py#L41-L44), [openhands/memory/conversation_memory.py:55-61](repo://openhands/memory/conversation_memory.py#L55-L61)

## Microagents

A microagent is a markdown file with optional YAML frontmatter, loaded by `BaseMicroagent.load`. The frontmatter becomes `MicroagentMetadata`: `name`, `type`, `version`, `agent` (default `CodeActAgent`), `triggers`, `inputs` and `mcp_tools`. The class is inferred from the metadata, not only from `type`.

Sources: [openhands/microagent/microagent.py:136-171](repo://openhands/microagent/microagent.py#L136-L171)

| Metadata | Class | Behaviour |
| --- | --- | --- |
| `inputs` present | `TaskMicroagent` | A `/<name>` trigger is added; if its content has `${variable}` placeholders or inputs it appends a request to ask the user for missing values |
| `triggers` present | `KnowledgeMicroagent` | Included only when a trigger keyword appears in the message |
| neither | `RepoMicroagent` | Always active |

Sources: [openhands/microagent/types.py:11-37](repo://openhands/microagent/types.py#L11-L37), [openhands/microagent/microagent.py:129-171](repo://openhands/microagent/microagent.py#L129-L171), [openhands/microagent/microagent.py:226-269](repo://openhands/microagent/microagent.py#L226-L269)

Some files are recognised without frontmatter: `.openhands_instructions` becomes a repo microagent named `repo_legacy`, and `.cursorrules`, `agents.md` and `agent.md` become repo microagents named `cursorrules` and `agents`. The microagent name is its path relative to the loaded directory, without the suffix. A configuration with `mcp_tools` but no stdio servers raises `MicroagentValidationError`; SSE servers only produce a warning.

Sources: [openhands/microagent/microagent.py:26-49](repo://openhands/microagent/microagent.py#L26-L49), [openhands/microagent/microagent.py:62-127](repo://openhands/microagent/microagent.py#L62-L127)

`KnowledgeMicroagent.match_trigger` lowercases the message and returns the first trigger that appears in it as a substring. `load_microagents_from_dir` scans a directory recursively for `*.md` files other than `README.md`, plus `.cursorrules` and the first of `AGENTS.md`, `agents.md`, `AGENT.md`, `agent.md` found two levels above the directory, and returns repo and knowledge agents in two dictionaries.

Sources: [openhands/microagent/microagent.py:174-204](repo://openhands/microagent/microagent.py#L174-L204), [openhands/microagent/microagent.py:277-330](repo://openhands/microagent/microagent.py#L277-L330)

## Where microagents come from

`Memory.__init__` subscribes to the event stream as `MEMORY` and loads two sources immediately: the global `microagents/` directory at the repository root (`GLOBAL_MICROAGENTS_DIR`) and the user's `~/.openhands/microagents/`, which it creates if missing. A third source is added by `create_memory`: it asks the runtime for `get_microagents_from_selected_repo` and passes the result to `load_user_workspace_microagents`, which files each into the knowledge or repo dictionary by class. A later source with the same name replaces an earlier one.

Sources: [openhands/memory/memory.py:33-38](repo://openhands/memory/memory.py#L33-L38), [openhands/memory/memory.py:53-84](repo://openhands/memory/memory.py#L53-L84), [openhands/memory/memory.py:254-300](repo://openhands/memory/memory.py#L254-L300), [openhands/core/setup.py:157-199](repo://openhands/core/setup.py#L157-L199)

`get_microagents_from_selected_repo` reads microagents from `.openhands/microagents` in the cloned repository, tries the legacy `.openhands_instructions` file, and, for a selected repository, also loads microagents from the owner's org-level repository (`.openhands`, or `openhands-config` on GitLab).

Sources: [openhands/runtime/base.py:823-883](repo://openhands/runtime/base.py#L823-L883)

The repository `microagents/README.md` describes the same split: keyword-triggered expertise versus always-loaded files, with repository-private instructions in `.openhands/microagents/repo.md`.

Sources: [microagents/README.md:1-45](repo://microagents/README.md#L1-L45)

## Answering a recall

The [[Agent Controller Loop]] adds a `RecallAction` for each user message and waits for an observation with that action as its `cause`. `Memory._on_event` handles two kinds.

Sources: [openhands/memory/memory.py:90-132](repo://openhands/memory/memory.py#L90-L132)

- `WORKSPACE_CONTEXT` from the user (the first message): `_on_workspace_context_recall` concatenates the content of every repo microagent, searches knowledge microagents against the message, and builds a `RecallObservation` with repository name, directory and branch, repo instructions, runtime hosts, extra agent instructions, the date, secret descriptions, conversation instructions, working directory and the matched knowledge. If there is nothing to add it returns `None`.
- `KNOWLEDGE` from a user or the agent: `_on_microagent_recall` returns an observation with just the matched knowledge, or `None`.

Sources: [openhands/memory/memory.py:139-223](repo://openhands/memory/memory.py#L139-L223)

Either way, the result (or a `NullObservation` when `None`) gets `_cause` set to the recall's id and is added as an environment event. That `cause` is what releases the controller. Exceptions are reported as a memory runtime error through the status callback.

Sources: [openhands/memory/memory.py:86-137](repo://openhands/memory/memory.py#L86-L137), [openhands/memory/memory.py:139-252](repo://openhands/memory/memory.py#L139-L252)

`Memory` also exposes `get_microagent_mcp_tools`, which returns the `mcp_tools` of all repo microagents (always active) for [[MCP Tools and Security Analyzers]], and the setters `set_repository_info`, `set_runtime_info` and `set_conversation_instructions` that the recall observation reads.

Sources: [openhands/memory/memory.py:302-365](repo://openhands/memory/memory.py#L302-L365)

## Turning events into messages

`ConversationMemory.process_events` is given the condensed events, the initial user message, `max_message_chars` and whether vision is on. It runs these steps.

Sources: [openhands/memory/conversation_memory.py:74-92](repo://openhands/memory/conversation_memory.py#L74-L92)

1. `_ensure_system_message` inserts a `SystemMessageAction` at the front if none exists (legacy streams), and `_ensure_initial_user_message` makes sure the second event is the user's first message.
2. Each event is converted by `_process_action` or `_process_observation`.
3. In function-calling mode, tool-based actions are not emitted right away. The assistant message from the stored model response is parked in `pending_tool_call_action_messages`, and emitted together with its tool results only once every tool call id has a matching result message.
4. `_filter_unmatched_tool_calls` drops tool results with no matching call and calls with no result, keeping the calls that do match.
5. `_apply_user_message_formatting` prefixes consecutive user messages with a blank line.

Sources: [openhands/memory/conversation_memory.py:93-181](repo://openhands/memory/conversation_memory.py#L93-L181), [openhands/memory/conversation_memory.py:747-850](repo://openhands/memory/conversation_memory.py#L747-L850)

Message actions become `user` or `assistant` messages, with image content attached when present. A `CmdRunAction` from the user becomes a user message saying the user ran the command. A `SystemMessageAction` becomes the `system` message. An `AgentFinishAction` with tool metadata takes its text from the model response.

Sources: [openhands/memory/conversation_memory.py:226-342](repo://openhands/memory/conversation_memory.py#L226-L342)

A `RecallObservation` is rendered through the `PromptManager`. For `WORKSPACE_CONTEXT` it applies `build_workspace_context` (the `additional_info.j2` template) and `build_microagent_info` (`microagent_info.j2`), skipping microagents named in `disabled_microagents`. For `KNOWLEDGE` it first removes microagents already shown in an earlier recall observation, so one is never injected twice, and then filters disabled ones.

Sources: [openhands/memory/conversation_memory.py:560-660](repo://openhands/memory/conversation_memory.py#L560-L660), [openhands/memory/conversation_memory.py:698-745](repo://openhands/memory/conversation_memory.py#L698-L745), [openhands/utils/prompt.py:107-134](repo://openhands/utils/prompt.py#L107-L134)

`apply_prompt_caching` marks the last content item of the system message, and of the last user or tool message, as `cache_prompt`; `CodeActAgent` calls it only when `llm.is_caching_prompt_active()`.

Sources: [openhands/memory/conversation_memory.py:683-696](repo://openhands/memory/conversation_memory.py#L683-L696), [openhands/agenthub/codeact_agent/codeact_agent.py:290-291](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L290-L291)

## The prompt manager

`PromptManager` loads Jinja2 templates from a prompt directory: the system prompt (default `system_prompt.j2`), `user_prompt.j2`, `additional_info.j2` and `microagent_info.j2`. A missing file raises `FileNotFoundError`. `get_system_message(**context)` renders the system template and passes it through `refine_prompt`. Each agent chooses its own directory; `CodeActAgent` uses its `prompts/` folder and the filename from its config.

Sources: [openhands/utils/prompt.py:43-105](repo://openhands/utils/prompt.py#L43-L105), [openhands/agenthub/codeact_agent/codeact_agent.py:98-106](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L98-L106)
