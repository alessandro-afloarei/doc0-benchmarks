---
title: "Microagents"
---
## Overview

A microagent is a markdown file with a small frontmatter header that gives the agent specialised instructions. `openhands/microagent` defines three kinds, parses the files, and matches the keyword triggers that bring a knowledge microagent into a conversation. The memory component loads the files from three places, and the prompt code decides how the matched text reaches the model.

Sources: [openhands/microagent/types.py:11-17](repo://openhands/microagent/types.py#L11-L17) [openhands/microagent/microagent.py:17-31](repo://openhands/microagent/microagent.py#L17-L31)

## The three kinds

`KNOWLEDGE` microagents are optional. They are injected when a keyword trigger appears in a message, and their docstring lists the kinds of expertise they carry, such as language practices, framework guidelines and tool usage. `REPO_KNOWLEDGE` microagents are always active for the repository they come from. `TASK` microagents are invoked explicitly, and they ask the user for any inputs they need before the agent proceeds.

Sources: [openhands/microagent/types.py:11-17](repo://openhands/microagent/types.py#L11-L17) [openhands/microagent/microagent.py:174-188](repo://openhands/microagent/microagent.py#L174-L188) [openhands/microagent/microagent.py:206-216](repo://openhands/microagent/microagent.py#L206-L216) [openhands/microagent/microagent.py:226-240](repo://openhands/microagent/microagent.py#L226-L240)

A repository microagent is read from `.openhands/microagents/repo.md` inside the repository. A task microagent is triggered by a `/name` message, and its constructor rejects any file whose type is not `TASK`.

Sources: [openhands/microagent/microagent.py:206-212](repo://openhands/microagent/microagent.py#L206-L212) [openhands/microagent/microagent.py:226-236](repo://openhands/microagent/microagent.py#L226-L236)

## Loading a file

`BaseMicroagent.load` reads one markdown file with frontmatter, and derives the agent's name from its path relative to the microagent directory. `load_microagents_from_dir` walks the directory recursively for `.md` files, skips `README.md`, and sorts the results into two dictionaries: repository microagents and knowledge microagents. Task microagents go into the knowledge dictionary. Legacy repository instructions are not loaded by this function.

Sources: [openhands/microagent/microagent.py:52-60](repo://openhands/microagent/microagent.py#L52-L60) [openhands/microagent/microagent.py:277-300](repo://openhands/microagent/microagent.py#L277-L300) [openhands/microagent/microagent.py:317-327](repo://openhands/microagent/microagent.py#L317-L327)

## Trigger matching

`match_trigger` lowercases the message and returns the first trigger that appears in it, in the order the triggers are listed. Matching is a substring test, so a trigger matches inside a longer word.

Sources: [openhands/microagent/microagent.py:189-200](repo://openhands/microagent/microagent.py#L189-L200)

## Where the files come from

`Memory` loads three sets. The global set comes from the `microagents` directory of the OpenHands checkout, and it is loaded first. The user set comes from `~/.openhands/microagents`. A workspace set is added later, when `load_user_workspace_microagents` receives the microagents of a cloned repository.

Sources: [openhands/memory/memory.py:35-38](repo://openhands/memory/memory.py#L35-L38) [openhands/memory/memory.py:79-83](repo://openhands/memory/memory.py#L79-L83) [openhands/memory/memory.py:254-268](repo://openhands/memory/memory.py#L254-L268)

Once loaded, the knowledge microagents are searched on each recall action, and the matched content is returned as a recall observation.

Sources: [openhands/memory/memory.py:207-223](repo://openhands/memory/memory.py#L207-L223) [openhands/memory/memory.py:225-252](repo://openhands/memory/memory.py#L225-L252) [[Conversation Memory and Prompts]] explains how that observation becomes part of the prompt.
