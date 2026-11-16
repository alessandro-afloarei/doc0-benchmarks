---
type: concept
title: Microagents
description: What OpenHands microagents are (repo, knowledge, and task types), their Markdown-with-frontmatter format and keyword triggers, every location they are loaded from (bundled, user home, repository, org-level repository, AGENTS.md/.cursorrules), and how they are injected into prompts or contribute MCP tools.
tags: [microagents, prompts, knowledge, repository-instructions, triggers]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:35:38.671Z
sources:
  - id: openwiki-source-046a1c2f5e20e3c35ef192a4
    resource: repo://openhands/mcp/utils.py
  - id: openwiki-source-ae571bbab7bb1b3526362fb5
    resource: repo://openhands/memory/memory.py
  - id: openwiki-source-5d8f5c2af56a4fade5c982a8
    resource: repo://openhands/microagent/microagent.py
  - id: openwiki-source-f38350b0cd074145e71451f8
    resource: repo://openhands/runtime/base.py
generated: { by: "claude-code", at: "2026-11-16T07:35:38.671Z" }
---

# Microagents

A **microagent** is a Markdown file of specialized instructions that OpenHands injects into the agent's context. Despite the name, microagents are not separate agents with their own loop — they are prompt extensions delivered through `RecallObservation`s by the [Memory component](../architecture/memory-and-condensers.md#memory-recall-and-microagents).

Code: `openhands/microagent/` (types and loader), `openhands/memory/memory.py` (selection), `openhands/runtime/base.py` (repository discovery).

## Types

`MicroagentType` (`openhands/microagent/types.py`):

| Type | Class | When it applies |
| --- | --- | --- |
| `repo` (`REPO_KNOWLEDGE`) | `RepoMicroagent` | Always active; content is included in the workspace context of the first user message |
| `knowledge` | `KnowledgeMicroagent` | Activated when any of its `triggers` appears (case-insensitive substring) in a user or agent message |
| `task` | `TaskMicroagent` | A knowledge microagent with declared `inputs`; triggered by `/<name>` and told to ask the user for missing `${variables}` |

The type is **inferred**, not taken from the `type` field: frontmatter with `inputs` → task (and `/<name>` is added as a trigger); with `triggers` → knowledge; otherwise → repo. `BaseMicroagent.load` raises `MicroagentValidationError` for invalid metadata, including an invalid `type` value.

## File format

```markdown
---
name: github
type: knowledge
version: 1.0.0
agent: CodeActAgent
triggers:
- github
- git
---

You have access to an environment variable, `GITHUB_TOKEN`, ...
```

`MicroagentMetadata` fields: `name`, `type`, `version` (coerced to string), `agent`, `triggers`, `inputs` (`name`/`description`), and optional `mcp_tools` (an `MCPConfig`). A microagent's name is derived from its path relative to the microagents directory when loaded from a directory (so `foo/bar.md` → `foo/bar`).

Special files are loaded as repo microagents without frontmatter parsing:

- `.openhands_instructions` (legacy, named `repo_legacy`)
- `.cursorrules` (named `cursorrules`)
- `AGENTS.md` / `agents.md` / `AGENT.md` / `agent.md` at the repository root (named `agents`; first match only)

`README.md` files inside microagent directories are ignored.

## Where microagents come from

Loaded in this order (later entries with the same name override earlier ones in the `repo_microagents` / `knowledge_microagents` dicts):

1. **Bundled public microagents** — `microagents/` at the repository root (`GLOBAL_MICROAGENTS_DIR`), loaded when `Memory` is constructed. Examples: `github`, `gitlab`, `bitbucket`, `docker`, `kubernetes`, `npm`, `ssh`, `security`, `code-review`, `fix_test`, `update_pr_description`, `add_agent`. These ship in the Python package (`pyproject.toml` includes `microagents/**/*`).
2. **User microagents** — `~/.openhands/microagents/` (created if missing; failures are logged, not raised).
3. **Workspace/repository microagents** — `Runtime.get_microagents_from_selected_repo` reads inside the sandbox:
   - **Org/user-level** repository: for `owner/repo`, the runtime shallow-clones `owner/.openhands` (or `owner/openhands-config` on GitLab, which disallows leading dots) using authenticated provider URLs, loads its `microagents/` folder, then deletes the clone. Missing repos or auth errors are silently skipped.
   - The selected repository's `.openhands/microagents/` (or the workspace root's when no repository is selected), plus legacy `.openhands_instructions` and root-level `AGENTS.md`/`.cursorrules`.

   These are passed to `Memory.load_user_workspace_microagents` by `create_memory` (CLI/headless) or `AgentSession._create_memory` (server).

This repository itself ships `.openhands/microagents/repo.md` (repo setup and contribution instructions for agents working on OpenHands), `documentation.md`, and `glossary.md`.

## How they reach the prompt

1. On each user message, the controller emits a `RecallAction` — `WORKSPACE_CONTEXT` for the first user message, `KNOWLEDGE` thereafter ([Agent Controller](../architecture/agent-controller.md)).
2. `Memory` builds a `RecallObservation`: workspace context includes **all** repo microagent contents (concatenated) plus triggered knowledge microagents; knowledge recalls include only triggered ones (`KnowledgeMicroagent.match_trigger`).
3. `ConversationMemory` renders them via the agent's prompt templates (e.g. `microagent_info.j2`, `additional_info.j2`) — only if `AgentConfig.enable_prompt_extensions` is true. A knowledge microagent already surfaced earlier in the conversation is not repeated, and names in `AgentConfig.disabled_microagents` are skipped.

## Microagents that add MCP tools

A repo microagent may declare `mcp_tools` with **stdio** servers (SSE servers produce a warning and are unsupported; an `mcp_tools` block without stdio servers is a validation error). `Memory.get_microagent_mcp_tools()` collects these, and `add_mcp_tools_to_agent` merges them into the runtime's MCP configuration so the tools become available to the agent ([MCP Integration](../integrations/mcp.md)).

## Server and UI support

`GET /api/conversations/{id}/microagents` (`openhands/server/routes/conversation.py`) lists the microagents loaded for a running conversation. `GET /api/microagent-management/conversations` (`manage_conversations.py`) lists conversations for the microagent-management UI, and `GET /api/conversations/{id}/remember-prompt` renders `openhands/microagent/prompts/generate_remember_prompt.j2` from conversation events to ask the agent to persist learnings as a microagent.

## Tests

`tests/unit/microagent/` covers frontmatter parsing, type inference, special files, task variables, and MCP validation; `tests/unit/memory/test_memory.py` covers trigger-based recall; `tests/runtime/test_microagent.py` covers loading from a real sandbox workspace.

## Related pages

- [Conversation Memory and Condensers](../architecture/memory-and-condensers.md)
- [MCP Integration](../integrations/mcp.md)
- [Git Provider Integrations](../integrations/git-providers.md) — authenticated clone URLs for org-level repos
