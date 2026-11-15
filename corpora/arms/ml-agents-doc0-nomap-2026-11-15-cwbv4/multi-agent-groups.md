---
title: "Multi-Agent Groups"
---
## Overview

A multi-agent group ties several agents together so they can be rewarded and reset as a team. Cooperative tasks often have rewards that belong to the team rather than to any one agent (the block reached the goal, the dragon was defeated), and agents may leave the episode early while the team carries on. Groups let the environment express that: every member receives the group reward, and the trainer sees which agents share a group so it can learn a centralized value for the team.

Sources: [com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs:81-143](repo://com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs#L81-L143)

On the Unity side a group is just an id stamped on each member's `AgentInfo` plus a group reward. On the Python side the agent processor uses the id to collect teammates' observations, actions and rewards into each trajectory, which the [[POCA Multi-Agent Trainer]] consumes.

Sources: [com.unity.ml-agents/Runtime/Agent.cs:1416-1434](repo://com.unity.ml-agents/Runtime/Agent.cs#L1416-L1434), [ml-agents/mlagents/trainers/agent_processor.py:159-196](repo://ml-agents/mlagents/trainers/agent_processor.py#L159-L196)

## The group API

`IMultiAgentGroup` is the interface: `GetId()`, `RegisterAgent(agent)` and `UnregisterAgent(agent)`. `SimpleMultiAgentGroup` is the implementation the package ships, and its methods are virtual so a subclass can add behavior.

Sources: [com.unity.ml-agents/Runtime/IMultiAgentGroup.cs:6-27](repo://com.unity.ml-agents/Runtime/IMultiAgentGroup.cs#L6-L27), [com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs:10-63](repo://com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs#L10-L63)

| Method | Effect |
| --- | --- |
| `RegisterAgent(agent)` | Sets the agent's group id, adds it to the set and subscribes to its `OnAgentDisabled` |
| `UnregisterAgent(agent)` | Clears the agent's group id, removes it and unsubscribes |
| `GetRegisteredAgents()` | The current members |
| `AddGroupReward(reward)` | Adds `reward` to every member's group reward |
| `SetGroupReward(reward)` | Sets every member's group reward |
| `EndGroupEpisode()` | Calls `EndEpisode()` on every member |
| `GroupEpisodeInterrupted()` | Calls `EpisodeInterrupted()` on every member |
| `Dispose()` | Unregisters all members |

Sources: [com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs:18-63](repo://com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs#L18-L63), [com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs:81-143](repo://com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs#L81-L143)

## Ids and membership

Each `SimpleMultiAgentGroup` takes its id from `MultiAgentGroupIdCounter.GetGroupId()`, which increments a static counter with `Interlocked.Increment`. Ids therefore start at 1, which matters because 0 means "no group" everywhere else.

Sources: [com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs:12-13](repo://com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs#L12-L13), [com.unity.ml-agents/Runtime/MultiAgentGroupIdCounter.cs:5-12](repo://com.unity.ml-agents/Runtime/MultiAgentGroupIdCounter.cs#L5-L12)

`Agent.SetMultiAgentGroup` enforces one group per agent: registering an agent that already belongs to a different group throws `UnityAgentsException` ("Unregister it first"), while re-registering with the same group is allowed. Passing null resets the id to 0. Because the group subscribes to `OnAgentDisabled`, an agent that is disabled or destroyed leaves its group automatically.

Sources: [com.unity.ml-agents/Runtime/Agent.cs:1416-1434](repo://com.unity.ml-agents/Runtime/Agent.cs#L1416-L1434), [com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs:27-46](repo://com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs#L27-L46), [com.unity.ml-agents/Runtime/Agent.cs:574-594](repo://com.unity.ml-agents/Runtime/Agent.cs#L574-L594)

## Group rewards on the agent

Group rewards live next to individual rewards on each agent. `AddGroupReward` and `SetGroupReward` on the agent are internal and are only called by the group. Like the individual reward, the group reward is copied into `AgentInfo.groupReward` when the agent sends a decision or finishes an episode, and reset to zero afterwards. The two are kept separate all the way to the trainer, so an agent can have personal shaping rewards on top of the shared outcome.

Sources: [com.unity.ml-agents/Runtime/Agent.cs:770-780](repo://com.unity.ml-agents/Runtime/Agent.cs#L770-L780), [com.unity.ml-agents/Runtime/Agent.cs:596-644](repo://com.unity.ml-agents/Runtime/Agent.cs#L596-L644), [com.unity.ml-agents/Runtime/Agent.cs:1372-1382](repo://com.unity.ml-agents/Runtime/Agent.cs#L1372-L1382)

## Using a group in an environment

The examples keep the group in an environment controller. `DungeonEscapeEnvController` creates one `SimpleMultiAgentGroup` at start-up and registers every agent in its list. When the door is unlocked it gives the group a reward of 1 and ends the group episode; when `MaxEnvironmentSteps` runs out in `FixedUpdate` it interrupts the group episode instead. An agent that touches the dragon is deactivated with `SetActive(false)`, which removes it from the group, unless it was the last one left or carried the key, in which case the group episode ends.

Sources: [Project/Assets/ML-Agents/Examples/DungeonEscape/Scripts/DungeonEscapeEnvController.cs:72-143](repo://Project/Assets/ML-Agents/Examples/DungeonEscape/Scripts/DungeonEscapeEnvController.cs#L72-L143)

The pattern that matters for training is the split between ending and interrupting. When the task succeeds or fails, call `EndGroupEpisode()` so the final state is treated as terminal. When an episode is cut off by a step limit, call `GroupEpisodeInterrupted()` so the trainer still bootstraps a value from the final state. Agents removed mid-episode are disabled; they leave the group and their trajectory ends while the others keep playing.

Sources: [com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs:120-143](repo://com.unity.ml-agents/Runtime/SimpleMultiAgentGroup.cs#L120-L143), [Project/Assets/ML-Agents/Examples/DungeonEscape/Scripts/DungeonEscapeEnvController.cs:113-143](repo://Project/Assets/ML-Agents/Examples/DungeonEscape/Scripts/DungeonEscapeEnvController.cs#L113-L143)

Competitive team games use one group per team. `SoccerEnvController` gives the scoring team `1 - elapsed / MaxEnvironmentSteps` and the other team -1, then ends both groups' episodes.

Sources: [Project/Assets/ML-Agents/Examples/Soccer/Scripts/SoccerEnvController.cs:44-111](repo://Project/Assets/ML-Agents/Examples/Soccer/Scripts/SoccerEnvController.cs#L44-L111)

## How groups reach Python

`ToAgentInfoProto` copies `groupId` and `groupReward` into the `AgentInfoProto`. If an agent has a group but the connected trainer did not announce the `MultiAgentGroups` capability, it logs a single warning that group rewards will be ignored. The Python `UnityEnvironment` always announces the capability.

Sources: [com.unity.ml-agents/Runtime/Communicator/GrpcExtensions.cs:62-95](repo://com.unity.ml-agents/Runtime/Communicator/GrpcExtensions.cs#L62-L95), [ml-agents-envs/mlagents_envs/environment.py:119-129](repo://ml-agents-envs/mlagents_envs/environment.py#L119-L129)

`rpc_utils` turns the per-agent values into `group_id` and `group_reward` arrays on `DecisionSteps` and `TerminalSteps`, raising on NaN or infinite group rewards. Each `DecisionStep` or `TerminalStep` therefore carries the agent's `group_id` (0 when ungrouped) and `group_reward`. See [[Low-Level Python API (UnityEnvironment)]].

Sources: [ml-agents-envs/mlagents_envs/rpc_utils.py:359-414](repo://ml-agents-envs/mlagents_envs/rpc_utils.py#L359-L414), [ml-agents-envs/mlagents_envs/base_env.py:55-62](repo://ml-agents-envs/mlagents_envs/base_env.py#L55-L62)

## Groups in the trainer

The `AgentProcessor` keeps two maps keyed by a global group id (`group_<worker>-<id>`, so groups from different environment workers never mix): the latest status of each group member (its previous observation, reward, action and whether it is done) and each member's current observation. Steps with `group_id` 0 add nothing.

Sources: [ml-agents/mlagents/trainers/agent_processor.py:159-212](repo://ml-agents/mlagents/trainers/agent_processor.py#L159-L212), [ml-agents/mlagents/trainers/behavior_id_utils.py:53-64](repo://ml-agents/mlagents/trainers/behavior_id_utils.py#L53-L64)

When it builds an `AgentExperience` for an agent, it attaches the statuses of all other members as `group_status` along with the step's `group_reward`; when it cuts a trajectory, it records the other members' current observations as `next_group_obs`. The trajectory then writes teammate observations, actions and rewards and the group reward into the agent buffer. A trainer that ignores these keys, such as PPO, trains each agent independently; POCA uses them for its centralized critic. The full process is on [[Agent Processor and Trajectories]].

Sources: [ml-agents/mlagents/trainers/agent_processor.py:214-300](repo://ml-agents/mlagents/trainers/agent_processor.py#L214-L300), [ml-agents/mlagents/trainers/trajectory.py:160-230](repo://ml-agents/mlagents/trainers/trajectory.py#L160-L230)
