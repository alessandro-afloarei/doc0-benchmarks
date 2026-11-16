---
title: "Memory and Microagent Recall"
---
## Overview

`Memory` adds information to the conversation that the agent cannot see in the code: the repository and branch, the runtime's hosts and working directory, the repository's own instructions, and any microagent whose trigger words appear in a message. It is an event-stream subscriber. It does not take part in the agent loop directly. It answers `RecallAction` events with `RecallObservation` events, and the controller waits for that answer before it continues.

Sources: [openhands/memory/memory.py:41-51](repo://openhands/memory/memory.py#L41-L51), [openhands/memory/memory.py:53-68](repo://openhands/memory/memory.py#L53-L68), [openhands/memory/memory.py:90-112](repo://openhands/memory/memory.py#L90-L112)

## Setup

`AgentSession._create_memory` builds the `Memory` with the session's event stream and id. When a runtime exists, it passes the runtime info and conversation instructions, loads the repository's microagents from the runtime, and sets the repository information when a repository and a directory are known.

Sources: [openhands/server/session/agent_session.py:448-482](repo://openhands/server/session/agent_session.py#L448-L482)

The constructor subscribes `on_event` to the stream under the memory subscriber, loads the global microagents from the `microagents` folder next to the package, and then loads the user's microagents from `~/.openhands/microagents`. Those microagents are sorted by kind, with knowledge microagents keyed by name and repository microagents kept separately.

Sources: [openhands/memory/memory.py:33-38](repo://openhands/memory/memory.py#L33-L38), [openhands/memory/memory.py:64-84](repo://openhands/memory/memory.py#L64-L84), [openhands/memory/memory.py:270-294](repo://openhands/memory/memory.py#L270-L294)

The workspace's own microagents are added after clone. `load_user_workspace_microagents` puts knowledge microagents into the knowledge set and repository microagents into the repository set, so a repository's files can override the global ones of the same name.

Sources: [openhands/memory/memory.py:254-268](repo://openhands/memory/memory.py#L254-L268)

## Recall requests

The controller creates the recall. When a user message arrives, `_handle_message_action` makes a `RecallAction` with the message text as its query. The first user message of the conversation gets the `WORKSPACE_CONTEXT` type. Every later one gets `KNOWLEDGE`. The recall becomes the pending action, so the controller does not step again until the answer arrives.

Sources: [openhands/controller/agent_controller.py:549-583](repo://openhands/controller/agent_controller.py#L549-L583)

When the answer comes back, the controller's observation handler clears the pending action, because the observation's cause is the recall's id.

Sources: [openhands/controller/agent_controller.py:536-541](repo://openhands/controller/agent_controller.py#L536-L541), [openhands/memory/memory.py:108-111](repo://openhands/memory/memory.py#L108-L111)

`Memory._on_event` answers a workspace-context recall from a user, and a knowledge recall from a user or agent message. The answer is a `RecallObservation` with its cause set to the recall's id, sent with the `ENVIRONMENT` source. When nothing matches, the answer is an empty `NullObservation`, which still releases the controller. An exception is reported as a `MEMORY` error status.

Sources: [openhands/memory/memory.py:90-137](repo://openhands/memory/memory.py#L90-L137)

## Workspace context

`_on_workspace_context_recall` builds the observation from the repository's instructions and the stored repository, runtime and conversation information. It concatenates the content of every repository microagent, with blank lines between them. The observation is returned only when at least one of those pieces is present.

Sources: [openhands/memory/memory.py:139-160](repo://openhands/memory/memory.py#L139-L160), [openhands/memory/memory.py:161-206](repo://openhands/memory/memory.py#L161-L206)

The observation carries the repository name, directory and branch, the runtime's hosts and additional agent instructions, the secret descriptions, the working directory, the date and the conversation instructions. Any of these that is unset becomes an empty value. The knowledge that matched the first message is included too.

Sources: [openhands/memory/memory.py:166-206](repo://openhands/memory/memory.py#L166-L206)

## Keyword recall

Knowledge recall searches the query for each knowledge microagent's triggers. A trigger matches when it appears in the lower-cased message, and the first matching trigger is recorded. Each matched microagent contributes its name, its trigger and its content.

Sources: [openhands/memory/memory.py:207-253](repo://openhands/memory/memory.py#L207-L253), [openhands/microagent/microagent.py:189-200](repo://openhands/microagent/microagent.py#L189-L200)

The microagent kinds are defined in `openhands/microagent`. A knowledge microagent is recalled by keyword as above. A repository microagent is not matched by keyword, and its content goes into the workspace context on the first message. Task microagents are a kind of knowledge microagent.

Sources: [openhands/microagent/microagent.py:174-190](repo://openhands/microagent/microagent.py#L174-L190), [openhands/microagent/microagent.py:206-226](repo://openhands/microagent/microagent.py#L206-L226)

## MCP tools from microagents

`get_microagent_mcp_tools` collects the MCP server definitions declared by the loaded microagents. The MCP helper adds them to the agent's tools when the runtime is connected.

Sources: [openhands/memory/memory.py:302-318](repo://openhands/memory/memory.py#L302-L318), [openhands/mcp/utils.py:284-288](repo://openhands/mcp/utils.py#L284-L288)

The prompt side of the recalled content is built by the conversation memory described in [[CodeAct Agent]], and the history that the recall is added to is shortened by the condensers in [[Condenser Catalogue]]. The controller side of the recall handshake is in [[Agent Controller]].

Sources: [openhands/agenthub/codeact_agent/codeact_agent.py:246-293](repo://openhands/agenthub/codeact_agent/codeact_agent.py#L246-L293)
