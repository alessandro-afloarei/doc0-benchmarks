---
title: "Microagents"
---
## Overview

A microagent is a Markdown file of instructions that OpenHands adds to the agent's context. There are three kinds: repository microagents, which describe a project and are always added when the workspace is set up; knowledge microagents, which are added only when a trigger word appears in a message; and task microagents, which start when a user types a slash command and may ask for inputs first. Files use YAML frontmatter for their metadata and the body for their content. This page covers the file formats and loading; the code that adds them to a conversation is in [[Memory and Recall]].

Sources: [openhands/microagent/types.py:11-17](repo://openhands/microagent/types.py#L11-L17), [openhands/microagent/microagent.py:17-31](repo://openhands/microagent/microagent.py#L17-L31)

## Kinds and metadata

`MicroagentType` has three values: `repo` (the default, always active), `knowledge` (triggered by keywords) and `task` (triggered by a slash command with inputs). Every microagent carries a `MicroagentMetadata` with a name, a version, the agent it targets (`CodeActAgent` by default), optional `triggers`, optional task `inputs`, and optional `mcp_tools`, which let a microagent add MCP servers to the agent.

Sources: [openhands/microagent/types.py:11-17](repo://openhands/microagent/types.py#L11-L17), [openhands/microagent/types.py:19-38](repo://openhands/microagent/types.py#L19-L38)

Each type is a class. `RepoMicroagent` rejects any type other than `repo`. `KnowledgeMicroagent` accepts `knowledge` and `task`, and its `match_trigger` returns the first trigger that appears, case-insensitively, in the message. `TaskMicroagent` is a knowledge microagent whose type is `task`; it appends a prompt that asks for any variable the content uses but the user has not supplied.

Sources: [openhands/microagent/microagent.py:206-224](repo://openhands/microagent/microagent.py#L206-L224), [openhands/microagent/microagent.py:174-200](repo://openhands/microagent/microagent.py#L174-L200), [openhands/microagent/microagent.py:226-275](repo://openhands/microagent/microagent.py#L226-L275)

## File formats

A repository microagent is a Markdown file with no required frontmatter. The repository's `.openhands/microagents` folder holds the files, and the `repo.md` file there is an example: it is plain instructions on how to build and run the project. Knowledge microagents in the `microagents` folder of OpenHands itself, such as `github.md`, set `type: knowledge` and a `triggers` list in their frontmatter.

Sources: [.openhands/microagents/repo.md:1-12](repo://.openhands/microagents/repo.md#L1-L12), [microagents/github.md:1-8](repo://microagents/github.md#L1-L8)

Some files are recognised by name rather than by their frontmatter. A `.cursorrules` file, and `AGENTS.md` or `AGENT.md` in any case, is loaded as a repository microagent named `cursorrules` or `agents`, and the legacy `.openhands_instructions` file is loaded under the name `repo_legacy`.

Sources: [openhands/microagent/microagent.py:32-50](repo://openhands/microagent/microagent.py#L32-L50), [openhands/microagent/microagent.py:73-80](repo://openhands/microagent/microagent.py#L73-L80), [openhands/microagent/microagent.py:277-300](repo://openhands/microagent/microagent.py#L277-L300)

Other files take their name from their path relative to the microagents folder, without the extension. A file that fails validation is logged and skipped, so one bad file does not stop the others from loading.

Sources: [openhands/microagent/microagent.py:81-110](repo://openhands/microagent/microagent.py#L81-L110), [openhands/microagent/microagent.py:300-330](repo://openhands/microagent/microagent.py#L300-L330)

## Where they are loaded from

`load_microagents_from_dir` reads one folder. It looks for the root-level `.cursorrules` and agents file of the repository that owns the folder, then every `.md` file under the folder except `README.md`, and sorts the results into repository and knowledge dictionaries.

Sources: [openhands/microagent/microagent.py:277-330](repo://openhands/microagent/microagent.py#L277-L330)

The memory component calls that loader for two places: OpenHands' own `microagents` folder, and the user's `~/.openhands/microagents`, which it creates if missing. The repository's microagents come from the runtime, through `get_microagents_from_selected_repo`. `create_memory` calls it when the command-line path builds the memory, and the server's session calls it the same way when it builds the memory for a conversation. The runtime reads the folders from the cloned workspace, and the organisation or user repository used for shared microagents.

Sources: [openhands/memory/memory.py:270-300](repo://openhands/memory/memory.py#L270-L300), [openhands/core/setup.py:184-200](repo://openhands/core/setup.py#L184-L200), [openhands/server/session/agent_session.py:465-480](repo://openhands/server/session/agent_session.py#L465-L480), [openhands/runtime/base.py:823-889](repo://openhands/runtime/base.py#L823-L889)

## How they reach the agent

Repository microagents are concatenated into the workspace context observation. Knowledge microagents are added when a recall finds a matching trigger, and each match is included with the trigger that matched. Task microagents are started from a message beginning with `/` and the agent's name, and the user's answers fill in their inputs. The memory page describes these paths in detail.

Sources: [openhands/memory/memory.py:139-160](repo://openhands/memory/memory.py#L139-L160), [openhands/memory/memory.py:225-252](repo://openhands/memory/memory.py#L225-L252)
