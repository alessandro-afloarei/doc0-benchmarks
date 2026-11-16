---
title: "Low-Level Python API (UnityEnvironment)"
---
## Overview

`mlagents_envs` is the Python package for driving a Unity environment from your own code, with or without the `mlagents` trainer. Its core is an abstract interface, `BaseEnv`, plus the data types that describe behaviors, observations, actions and step results, and one implementation, `UnityEnvironment`, which launches or connects to Unity and talks to it over gRPC. The gym and PettingZoo wrappers ([[Gym and PettingZoo Wrappers]]) and the trainer's environment workers ([[Trainer Controller and Environment Managers]]) are both built on it.

Sources: [ml-agents-envs/mlagents_envs/base_env.py:1-17](repo://ml-agents-envs/mlagents_envs/base_env.py#L1-L17), [ml-agents-envs/mlagents_envs/environment.py:55-80](repo://ml-agents-envs/mlagents_envs/environment.py#L55-L80)

The API is batched and multi-agent by design. Agents are grouped by behavior name; for each behavior, a step returns the data of every agent that requested a decision, as arrays with one row per agent. The module docstring warns that neither the number nor the order of agents is fixed across steps, and that one step means "until at least one agent sends observations again", not a fixed time increment, because agents may decide at different frequencies.

Sources: [ml-agents-envs/mlagents_envs/base_env.py:1-17](repo://ml-agents-envs/mlagents_envs/base_env.py#L1-L17)

## The BaseEnv interface

| Method | Purpose |
| --- | --- |
| `reset()` | Signal the environment to reset and collect the first observations |
| `step()` | Send the actions set since the last step and advance the simulation |
| `close()` | Shut down the environment and its connection |
| `behavior_specs` | Mapping from behavior name to `BehaviorSpec` for every behavior seen so far |
| `set_actions(behavior_name, action)` | Set actions for all agents of a behavior that requested a decision |
| `set_action_for_agent(behavior_name, agent_id, action)` | Set the action of one agent |
| `get_steps(behavior_name)` | Return `(DecisionSteps, TerminalSteps)` from the last step |

Sources: [ml-agents-envs/mlagents_envs/base_env.py:552-625](repo://ml-agents-envs/mlagents_envs/base_env.py#L552-L625)

A typical loop resets once, then repeatedly reads the steps of each behavior, computes actions for the agents in `DecisionSteps`, sets them and steps.

Sources: [ml-agents-envs/mlagents_envs/environment.py:316-406](repo://ml-agents-envs/mlagents_envs/environment.py#L316-L406)

```python
from mlagents_envs.environment import UnityEnvironment

env = UnityEnvironment(file_name="builds/3DBall", seed=1, side_channels=[])
env.reset()
behavior_name = list(env.behavior_specs)[0]
spec = env.behavior_specs[behavior_name]
for _ in range(100):
    decision_steps, terminal_steps = env.get_steps(behavior_name)
    env.set_actions(behavior_name, spec.action_spec.random_action(len(decision_steps)))
    env.step()
env.close()
```

Sources: [ml-agents-envs/mlagents_envs/environment.py:145-158](repo://ml-agents-envs/mlagents_envs/environment.py#L145-L158), [ml-agents-envs/mlagents_envs/base_env.py:388-410](repo://ml-agents-envs/mlagents_envs/base_env.py#L388-L410)

## Describing behaviors

`BehaviorSpec` is a pair of `observation_specs` (one per sensor, in the agent's sensor order) and an `action_spec`.

Sources: [ml-agents-envs/mlagents_envs/base_env.py:523-536](repo://ml-agents-envs/mlagents_envs/base_env.py#L523-L536)

`ObservationSpec` has a `shape`, a `dimension_property` tuple of `DimensionProperty` flags (`UNSPECIFIED`, `NONE`, `TRANSLATIONAL_EQUIVARIANCE`, `VARIABLE_SIZE`), an `observation_type` (`DEFAULT` or `GOAL_SIGNAL`) and a `name`, which for observations from Unity is the sensor name. These mirror the C# types described on [[Sensors and Observations]].

Sources: [ml-agents-envs/mlagents_envs/base_env.py:459-521](repo://ml-agents-envs/mlagents_envs/base_env.py#L459-L521)

`ActionSpec` has a `continuous_size` and a tuple of `discrete_branches`. `discrete_size` is the number of branches, and `is_continuous()` / `is_discrete()` remain for backwards compatibility. `create_continuous`, `create_discrete` and `create_hybrid` build specs. `empty_action(n)` returns zeros, `random_action(n)` returns uniform continuous values in `[-1, 1]` and uniform discrete choices per branch.

Sources: [ml-agents-envs/mlagents_envs/base_env.py:335-410](repo://ml-agents-envs/mlagents_envs/base_env.py#L335-L410), [ml-agents-envs/mlagents_envs/base_env.py:435-456](repo://ml-agents-envs/mlagents_envs/base_env.py#L435-L456)

## Actions: ActionTuple

`ActionTuple` holds two arrays, `continuous` of shape `(n_agents, continuous_size)` as `float32` and `discrete` of shape `(n_agents, discrete_size)` as `int32`. Setting one part casts it to the right dtype and, if the other part is missing, fills it with a zero-width array, so a purely continuous action still has a valid `discrete` field.

Sources: [ml-agents-envs/mlagents_envs/base_env.py:267-332](repo://ml-agents-envs/mlagents_envs/base_env.py#L267-L332)

`set_actions` validates the shapes against the spec and the number of agents in the last `DecisionSteps`, raising `UnityActionException` with the expected and received dimensions. `set_action_for_agent` validates a single-row action, creates empty actions for the behavior if none were set, and writes into the row of that agent; it raises `IndexError` if the agent did not request a decision. Setting actions for a behavior with no state yet is ignored.

Sources: [ml-agents-envs/mlagents_envs/base_env.py:412-433](repo://ml-agents-envs/mlagents_envs/base_env.py#L412-L433), [ml-agents-envs/mlagents_envs/environment.py:360-400](repo://ml-agents-envs/mlagents_envs/environment.py#L360-L400)

## Step results

Each step separates agents that need an action from agents whose episode just ended. An agent can appear in both at once: when it ended an episode and immediately started a new one in the same step.

Sources: [ml-agents-envs/mlagents_envs/rpc_utils.py:317-327](repo://ml-agents-envs/mlagents_envs/rpc_utils.py#L317-L327)

| Field | `DecisionSteps` | `TerminalSteps` |
| --- | --- | --- |
| `obs` | list of arrays, one per observation, first dimension is the batch | same |
| `reward` | reward since the last step | reward since the last step |
| `agent_id` | unique agent ids | unique agent ids |
| `action_mask` | per-branch boolean arrays, `True` meaning unavailable, or `None` | not present |
| `interrupted` | not present | `True` if the episode was cut short (for example by `MaxStep`) |
| `group_id`, `group_reward` | group membership and group reward | same |

Sources: [ml-agents-envs/mlagents_envs/base_env.py:41-138](repo://ml-agents-envs/mlagents_envs/base_env.py#L41-L138), [ml-agents-envs/mlagents_envs/base_env.py:160-247](repo://ml-agents-envs/mlagents_envs/base_env.py#L160-L247)

Both classes are mappings from agent id to a single-agent `DecisionStep` or `TerminalStep`, built on demand from the batched arrays. `agent_id_to_index` gives the row of each agent, `len()` the batch size, and `empty(spec)` builds a zero-agent result with correctly shaped observation arrays.

Sources: [ml-agents-envs/mlagents_envs/base_env.py:64-157](repo://ml-agents-envs/mlagents_envs/base_env.py#L64-L157)

## UnityEnvironment

### Construction

| Argument | Default | Meaning |
| --- | --- | --- |
| `file_name` | `None` | Path to a built environment; `None` connects to the Editor |
| `worker_id` | 0 | Offset added to the base port; must be 0 with the Editor |
| `base_port` | 5005 with a file, 5004 without | First port to listen on |
| `seed` | 0 | Sent to Unity to seed its random generator |
| `no_graphics`, `no_graphics_monitor` | `False` | Launch with `-nographics -batchmode`; the monitor variant keeps worker 0 graphical |
| `timeout_wait` | 60 | Seconds to wait for Unity before raising |
| `additional_args` | none | Extra command-line arguments for the player |
| `side_channels` | none | Side channels to register ([[Side Channels]]) |
| `log_folder` | none | Folder for `Player-<worker_id>.log` |
| `num_areas` | 1 | Training areas per environment, read by `TrainingAreaReplicator` |

Sources: [ml-agents-envs/mlagents_envs/environment.py:145-226](repo://ml-agents-envs/mlagents_envs/environment.py#L145-L226), [ml-agents-envs/mlagents_envs/environment.py:269-285](repo://ml-agents-envs/mlagents_envs/environment.py#L269-L285)

The constructor registers `_close` with `atexit`, computes the port as `base_port + worker_id`, creates the gRPC server (which fails with `UnityWorkerInUseException` if the port is taken), and either launches the executable with `--mlagents-port <port>` or logs that it is waiting for Play in the Editor. It then sends the initialization message, checks version compatibility, warns if Unity lacks the base RL capabilities, and records the specs of behaviors found in the first output.

Sources: [ml-agents-envs/mlagents_envs/environment.py:173-263](repo://ml-agents-envs/mlagents_envs/environment.py#L173-L263)

### Launching executables

`env_utils.validate_environment_path` strips `.app`, `.exe`, `.x86_64` and `.x86` from the path and searches platform-specific locations: `<name>.x86_64` or `.x86` on Linux, `<name>.app/Contents/MacOS/<name>` (or any binary there) on macOS, and `<name>.exe` or any `.exe` inside a `<name>` folder other than `UnityCrashHandler` on Windows. `launch_executable` starts the process in a new session, so a Ctrl+C to Python is not forwarded on POSIX and Unity can shut down cleanly; its output is hidden unless logging is at debug level. A missing file or a permission error raises `UnityEnvironmentException`.

Sources: [ml-agents-envs/mlagents_envs/env_utils.py:20-130](repo://ml-agents-envs/mlagents_envs/env_utils.py#L20-L130)

### reset, step and close

`reset()` sends a reset command, updates behavior specs and the stored steps, and clears pending actions. The first `step()` call after construction behaves as `reset()`. Otherwise `step()` fills in empty actions for any behavior whose actions were not set, exchanges one message, registers newly seen behaviors, refreshes the stored `DecisionSteps`/`TerminalSteps` per behavior (empty results for behaviors absent from the output) and processes incoming side channel messages. `get_steps` then returns the stored pair.

Sources: [ml-agents-envs/mlagents_envs/environment.py:299-354](repo://ml-agents-envs/mlagents_envs/environment.py#L299-L354), [ml-agents-envs/mlagents_envs/environment.py:402-406](repo://ml-agents-envs/mlagents_envs/environment.py#L402-L406)

New behaviors can appear at any step, for example when an agent with a new behavior name is spawned. `behavior_specs` therefore grows over time; the trainer checks it after every step.

Sources: [ml-agents-envs/mlagents_envs/environment.py:287-297](repo://ml-agents-envs/mlagents_envs/environment.py#L287-L297), [ml-agents-envs/mlagents_envs/environment.py:356-358](repo://ml-agents-envs/mlagents_envs/environment.py#L356-L358)

`close()` closes the communicator, then waits up to `timeout_wait` seconds for the process to exit before killing it, and logs the return code with its signal name when there is one.

Sources: [ml-agents-envs/mlagents_envs/environment.py:420-449](repo://ml-agents-envs/mlagents_envs/environment.py#L420-L449), [ml-agents-envs/mlagents_envs/environment.py:500-518](repo://ml-agents-envs/mlagents_envs/environment.py#L500-L518)

## Errors

All exceptions derive from `UnityException`.

Sources: [ml-agents-envs/mlagents_envs/exception.py:1-86](repo://ml-agents-envs/mlagents_envs/exception.py#L1-L86)

| Exception | Raised when |
| --- | --- |
| `UnityEnvironmentException` | The executable cannot be found or launched, versions are incompatible, the process dies, or no environment is loaded |
| `UnityTimeOutException` | Unity does not answer within `timeout_wait` |
| `UnityWorkerInUseException` | The port for this `worker_id` is already in use |
| `UnityCommunicatorStoppedException` | Unity stopped the exchange (for example the Editor left play mode) |
| `UnityActionException` | Actions have the wrong shape or the behavior does not exist |
| `UnityObservationException` | An observation does not match its declared shape or mapping |
| `UnitySideChannelException`, `UnityCommunicationException` | A side channel was misused or received unexpected data |

Sources: [ml-agents-envs/mlagents_envs/exception.py:1-86](repo://ml-agents-envs/mlagents_envs/exception.py#L1-L86), [ml-agents-envs/mlagents_envs/environment.py:316-354](repo://ml-agents-envs/mlagents_envs/environment.py#L316-L354), [ml-agents-envs/mlagents_envs/rpc_communicator.py:93-121](repo://ml-agents-envs/mlagents_envs/rpc_communicator.py#L93-L121)

While waiting for a reply, `UnityEnvironment` polls its child process; if the process has exited, it raises `UnityEnvironmentException` with the return code instead of waiting for the full timeout.

Sources: [ml-agents-envs/mlagents_envs/environment.py:408-418](repo://ml-agents-envs/mlagents_envs/environment.py#L408-L418)
