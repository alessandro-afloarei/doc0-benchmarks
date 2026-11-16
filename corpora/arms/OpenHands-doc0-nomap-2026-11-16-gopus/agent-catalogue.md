---
title: "Agent Catalogue"
---
## Overview

Besides the default `CodeActAgent`, `openhands.agenthub` ships five agents. Each registers itself under its class name when the package is imported, so any of them can be chosen with `-c <Name>` or `default_agent`, or reached by delegation from another agent. They share the `Agent` interface and step loop described in [[Agents and CodeAct]]; they differ in the tools they give the model, how they build the prompt, and what they are meant for.

Sources: [openhands/agenthub/__init__.py:1-24](repo://openhands/agenthub/__init__.py#L1-L24), [openhands/agenthub/browsing_agent/__init__.py:1-4](repo://openhands/agenthub/browsing_agent/__init__.py#L1-L4), [openhands/agenthub/readonly_agent/__init__.py:1-4](repo://openhands/agenthub/readonly_agent/__init__.py#L1-L4)

| Agent | Built on | Uses native tool calls | Choose it for |
| --- | --- | --- | --- |
| `ReadOnlyAgent` | `CodeActAgent` | yes | Exploring a codebase without changing it |
| `LocAgent` | `CodeActAgent` | yes | Locating the code relevant to an issue |
| `BrowsingAgent` | `Agent` | no, parses text | Web tasks through the accessibility tree; CodeAct's browsing delegate |
| `VisualBrowsingAgent` | `Agent` | no, parses text | Web tasks that need screenshots; evaluated on VisualWebArena |
| `DummyAgent` | `Agent` | no LLM call | End-to-end tests |

Sources: [openhands/agenthub/readonly_agent/readonly_agent.py:23-37](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L23-L37), [openhands/agenthub/loc_agent/loc_agent.py:14-40](repo://openhands/agenthub/loc_agent/loc_agent.py#L14-L40), [openhands/agenthub/browsing_agent/browsing_agent.py:94-123](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L94-L123), [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:121-150](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L121-L150), [openhands/agenthub/dummy_agent/agent.py:38-43](repo://openhands/agenthub/dummy_agent/agent.py#L38-L43)

## ReadOnlyAgent

`ReadOnlyAgent` subclasses `CodeActAgent` and keeps its step loop, memory and condenser, but replaces the tool list and prompts. Its docstring describes it as an agent for safely exploring a codebase, searching for patterns and researching without changes, and says to switch to `CodeActAgent` when you are ready to change things.

Sources: [openhands/agenthub/readonly_agent/readonly_agent.py:1-63](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L1-L63)

Its tools are `think`, `finish`, `grep`, `glob` and `view`. `view` becomes a `FileReadAction`; `grep` and `glob` are translated into shell commands and sent as `CmdRunAction`, so the search still runs in the sandbox shell but the model can only choose read-only commands. `set_mcp_tools` is overridden to log a warning and ignore MCP tools.

Sources: [openhands/agenthub/readonly_agent/function_calling.py:241-248](repo://openhands/agenthub/readonly_agent/function_calling.py#L241-L248), [openhands/agenthub/readonly_agent/function_calling.py:147-195](repo://openhands/agenthub/readonly_agent/function_calling.py#L147-L195), [openhands/agenthub/readonly_agent/readonly_agent.py:65-83](repo://openhands/agenthub/readonly_agent/readonly_agent.py#L65-L83)

## LocAgent

`LocAgent` implements the LocAgent paper's approach to code localization: the codebase is parsed into a directed graph of code entities and their dependencies, and the model searches it with multi-hop reasoning. It subclasses `CodeActAgent` and replaces the tools with `finish` plus three search tools: `search_code_snippets`, `get_entity_contents` and `explore_tree_structure`.

Sources: [openhands/agenthub/loc_agent/README.md:1-14](repo://openhands/agenthub/loc_agent/README.md#L1-L14), [openhands/agenthub/loc_agent/function_calling.py:120-125](repo://openhands/agenthub/loc_agent/function_calling.py#L120-L125)

The search tools are not executed by new runtime code. A call to any of them becomes an `IPythonRunCellAction` whose code is `print(<tool>(**arguments))`, which runs the function of the same name provided by the agent skills plugin in the sandbox's Jupyter kernel. Unparseable tool arguments raise a `RuntimeError` here rather than CodeAct's validation error.

Sources: [openhands/agenthub/loc_agent/function_calling.py:52-76](repo://openhands/agenthub/loc_agent/function_calling.py#L52-L76)

## BrowsingAgent

`BrowsingAgent` is the BrowserGym demo agent: it works one page state at a time from the accessibility tree and answers in BrowserGym's high-level action language rather than tool calls. CodeAct delegates to it when the model calls `delegate_to_browsing_agent`, and it needs no sandbox plugins.

Sources: [openhands/agenthub/browsing_agent/README.md:1-16](repo://openhands/agenthub/browsing_agent/README.md#L1-L16), [openhands/agenthub/browsing_agent/browsing_agent.py:94-123](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L94-L123), [openhands/agenthub/codeact_agent/function_calling.py:135-142](repo://openhands/agenthub/codeact_agent/function_calling.py#L135-L142)

Its action space is BrowserGym's `chat` and `bid` subsets, plus `nav` unless `USE_NAV=false`, with several actions allowed per turn. Each step it rebuilds the prompt from scratch: a system message with the goal and the action space description, and a user message with the current URL, the flattened accessibility tree (visible and clickable elements), the list of previous browser actions, and an error prefix when the last action failed. The model's reply is cut at the closing code fence by stop words and parsed into an action.

Sources: [openhands/agenthub/browsing_agent/browsing_agent.py:26-91](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L26-L91), [openhands/agenthub/browsing_agent/browsing_agent.py:181-223](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L181-L223)

The agent ends its task in three ways. An agent `MessageAction` already in its view becomes an `AgentFinishAction` with that content as output, which is what its delegator receives. A browser action that ran `send_msg_to_user` is turned into a `MessageAction` with that text. After more than five browser errors it gives up with `Too many errors encountered. Task failed.` When `USE_NAV=false` and `USE_CONCISE_ANSWER=true` it runs in evaluation mode for WebArena and MiniWoB, starting with a `noop()` to read the page the benchmark already loaded.

Sources: [openhands/agenthub/browsing_agent/browsing_agent.py:133-188](repo://openhands/agenthub/browsing_agent/browsing_agent.py#L133-L188)

## VisualBrowsingAgent

`VisualBrowsingAgent` implements AgentLab's generic agent. Its observations add a set-of-marks screenshot (the page with numbered element labels) to the accessibility tree and the history of thoughts and actions, and any images in the user's goal are passed along as image content. Its action space is wider (`chat`, `bid`, `nav`, `tab` and `infeas`) but one action per turn.

Sources: [openhands/agenthub/visualbrowsing_agent/README.md:1-7](repo://openhands/agenthub/visualbrowsing_agent/README.md#L1-L7), [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:130-150](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L130-L150), [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:271-310](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L271-L310)

Its README notes that it was evaluated on VisualWebArena and that CodeAct does not call it: CodeAct browses with its own `browser` tool or delegates to `BrowsingAgent`. Like `BrowsingAgent`, it gives up after more than five browser errors.

Sources: [openhands/agenthub/visualbrowsing_agent/README.md:5-7](repo://openhands/agenthub/visualbrowsing_agent/README.md#L5-L7), [openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py:236-245](repo://openhands/agenthub/visualbrowsing_agent/visualbrowsing_agent.py#L236-L245)

## DummyAgent

`DummyAgent` exists for end-to-end tests and makes no LLM calls. It holds a fixed list of steps (a greeting message, an `echo`, writing and reading a file, running a script, a reject and a finish), each paired with the observations it expects. At each step it returns the action for the current iteration count, and compares the previous step's expected observations with the latest events in its view after stripping fields that change between runs (ids, timestamps, process ids, host names, full paths). A mismatch only prints a warning; once the list runs out it returns `AgentFinishAction`.

Sources: [openhands/agenthub/dummy_agent/agent.py:38-99](repo://openhands/agenthub/dummy_agent/agent.py#L38-L99), [openhands/agenthub/dummy_agent/agent.py:100-176](repo://openhands/agenthub/dummy_agent/agent.py#L100-L176)

## Delegation between agents

Any agent can hand a subtask to another with an `AgentDelegateAction`. The [[Agent Controller]] runs the delegate in a child controller that shares the parent's iteration counter, which the agent hub README illustrates with CodeAct asking `BrowsingAgent` for a repository's star count: the global iteration keeps counting through the delegate's steps while each subtask keeps its own local count.

Sources: [openhands/agenthub/README.md:95-142](repo://openhands/agenthub/README.md#L95-L142), [openhands/controller/agent_controller.py:693-752](repo://openhands/controller/agent_controller.py#L693-L752)
