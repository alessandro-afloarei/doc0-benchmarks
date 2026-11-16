---
type: concept
title: Microagents and Knowledge Recall
description: What microagents are, how their type is inferred from Markdown frontmatter, where they are loaded from (global, user, repository, organization, legacy files) and how they reach the agent through RecallAction/RecallObservation.
tags: [microagents, knowledge, repo-instructions, recall, prompts]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:38:52.407Z
sources:
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-5d8f5c2af56a4fade5c982a8
    resource: repo://openhands/microagent/microagent.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
  - id: openwiki-source-a3e1d91fcd3a9a6f3c96821f
    resource: repo://openhands/server/session/agent_session.py
generated: { by: "claude-code", at: "2026-11-16T09:38:52.407Z" }
---

# Microagents and Knowledge Recall

Microagents are Markdown files with YAML frontmatter that inject extra instructions into an agent's context. They are *not* separate LLM agents; they are prompt fragments plus optional MCP configuration. Parsing lives in `openhands/microagent/`; loading from the sandbox is in the [Runtime](../runtime/runtime-and-sandbox.md); delivery to the agent is the job of `Memory` (see [Memory and condensation](memory-and-condensation.md)).

## Types and type inference

`MicroagentType` has three values: `knowledge`, `repo` and `task`. `MicroagentMetadata` carries `name`, `type`, `version`, `agent` (default `CodeActAgent`), `triggers`, `inputs` and an optional `mcp_tools` config.

`BaseMicroagent.load(path, microagent_dir, file_content)` does **not** simply trust the `type` field. It infers the class:

1. If `inputs` are declared → `TaskMicroagent`; a `/<name>` trigger is added automatically.
2. Else if `triggers` exist → `KnowledgeMicroagent` (keyword-triggered).
3. Else → `RepoMicroagent` (always active).

Behavior per class:

- `KnowledgeMicroagent.match_trigger(message)` lowercases the message and returns the first trigger that is a case-insensitive *substring*.
- `RepoMicroagent` holds repository-specific guidelines and is always included in workspace context.
- `TaskMicroagent` extends knowledge agents with `${variable}` placeholders; it appends an instruction to ask the user for any missing variables.
- Validation: invalid metadata raises `MicroagentValidationError` (with a hint listing valid types). If `mcp_tools` is given it must contain stdio servers; SSE servers only trigger a warning.

Special instruction files are recognized without frontmatter and become `RepoMicroagent`s: `.cursorrules` → `cursorrules`, `AGENTS.md`/`agent.md` (case-insensitive) → `agents`, and the legacy `.openhands_instructions` → `repo_legacy`. The repository's own `AGENTS.md` is therefore picked up automatically by OpenHands when working in this repo.

`load_microagents_from_dir(dir)` returns `(repo_agents, knowledge_agents)`; it recursively reads `*.md` (skipping `README.md`) and also checks two directories above (`microagent_dir.parent.parent`) for `.cursorrules` and one `AGENTS.md` variant.

## Where microagents come from

| Source | Location | Loaded by |
|---|---|---|
| Global/public | `microagents/` in the OpenHands install (`GLOBAL_MICROAGENTS_DIR`) | `Memory._load_global_microagents` at construction |
| User | `~/.openhands/microagents/` (created if missing) | `Memory._load_user_microagents` |
| Repository | `<repo>/.openhands/microagents/` inside the sandbox | `Runtime.get_microagents_from_selected_repo` |
| Organization/user-level repo | `<org>/.openhands` repo (for GitLab `openhands-config`), its `microagents/` folder | `Runtime.get_microagents_from_org_or_user` |
| Legacy | `.openhands_instructions` in workspace or repo root | `get_microagents_from_selected_repo` |

Repository loading happens inside the runtime: files are listed through the runtime, the directory is copied out as a zip (`copy_from`), extracted to a temp folder, parsed and the temp folder removed. This is why microagents from a freshly cloned repo are available: the session first clones/initializes the repo, then calls `Memory.load_user_workspace_microagents(...)` (see `AgentSession._create_memory`, `core/setup.py` for headless runs, and the CLI). Later sources overwrite earlier ones with the same name in `Memory`'s `knowledge_microagents`/`repo_microagents` dicts.

The public `microagents/` directory in this repository ships things like `github.md` (documents `GITHUB_TOKEN` usage, triggers `github`, `git`), `docker.md`, `kubernetes.md`, `code-review.md` and task-style helpers such as `add_agent.md`.

## Recall flow

1. A user `MessageAction` reaches `AgentController._handle_message_action`, which creates a `RecallAction(query=message, recall_type=...)`: `WORKSPACE_CONTEXT` for the first user message, `KNOWLEDGE` thereafter, sets it as pending and adds it to the [event stream](../architecture/event-stream.md).
2. `Memory` (a stream subscriber) handles it. Workspace recall returns repo instructions (all repo microagents concatenated), repository/runtime info and any triggered knowledge microagents in a single `RecallObservation`. Knowledge recall returns only triggered microagents. Agent-sourced messages can also trigger knowledge recall.
3. The `RecallObservation` carries `cause = recall_action.id`, which un-blocks the controller so the agent can step with the new context. If nothing matched, a `NullObservation` with the same cause is used.
4. `ConversationMemory` renders the observation into the prompt (using `microagent_info.j2` for CodeAct) and filters knowledge entries that already appeared earlier in the conversation.

Repo microagents with `mcp_tools` are surfaced through `Memory.get_microagent_mcp_tools`, which feeds [MCP integration](../integrations/mcp.md).

Related: [CodeActAgent](codeact-agent.md), [Git providers](../integrations/git-providers.md) (org-level repos are located through provider verification).
