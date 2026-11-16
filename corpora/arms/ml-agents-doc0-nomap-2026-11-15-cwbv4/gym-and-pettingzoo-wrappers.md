---
title: "Gym and PettingZoo Wrappers"
---
## Overview

`mlagents_envs.envs` adapts a Unity environment to two standard Python RL interfaces so that code written for them can train on Unity scenes without knowing about behaviors, batches or `ActionTuple`s. `UnityToGymWrapper` exposes a scene with exactly one agent as a `gym.Env`. `UnityAECEnv` and `UnityParallelEnv` expose any number of agents and behaviors as PettingZoo environments, in turn-based (AEC) and simultaneous (parallel) styles. All of them wrap a `BaseEnv`, usually a `UnityEnvironment` ([[Low-Level Python API (UnityEnvironment)]]).

Sources: [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:26-75](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L26-L75), [ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py:9-50](repo://ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py#L9-L50)

The package depends on `gym>=0.21.0` and pins `pettingzoo==1.15.0`.

Sources: [ml-agents-envs/setup.py:55-65](repo://ml-agents-envs/setup.py#L55-L65)

## UnityToGymWrapper

### Constraints

The gym wrapper supports a narrow case and checks it up front. If no behavior is known yet it steps once so Unity sends its specs. It then raises `UnityGymException` if the environment has more than one behavior, if there are no observations at all, or if the action spec mixes continuous and discrete actions. After every reset and step it raises if more than one agent requested a decision.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:51-132](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L51-L132), [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:300-305](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L300-L305)

### Options

| Argument | Effect |
| --- | --- |
| `unity_env` | The `BaseEnv` to wrap; it is closed when the wrapper closes |
| `uint8_visual` | Return images as `uint8` in 0 to 255 instead of `float32` in 0 to 1 |
| `flatten_branched` | Turn several discrete branches into a single `Discrete` space |
| `allow_multiple_obs` | Return all observations as a list instead of only the first |
| `action_space_seed` | Seed for the created action space |

Sources: [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:31-50](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L31-L50)

### Gym spaces

The action space is `Discrete(n)` for a single branch, `MultiDiscrete(branches)` for several, or a `Discrete` over all combinations when `flatten_branched` is set. `ActionFlattener` builds that lookup with `itertools.product` over the branch sizes, so the space has the product of the branch sizes as its size. Continuous actions become `Box(-1, 1)`; `flatten_branched` on a continuous space only logs a warning.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:105-135](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L105-L135), [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:324-360](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L324-L360)

Observations are split by rank: each rank-3 observation is a visual `Box` (0 to 1, or 0 to 255 as `uint8`), and all rank-1 observations are concatenated into one unbounded vector `Box`, placed last. With `allow_multiple_obs` the observation space is a `Tuple` of these; otherwise it is only the first, meaning the first visual observation if there is one, or else the vector. A warning is logged when observations are being dropped this way. Rank-2 (variable-length) observations are not represented.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:137-152](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L137-L152), [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:240-277](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L240-L277)

### reset and step

`reset()` resets the Unity environment and returns the observation of the single agent. `step(action)` raises if the previous step returned `done`, looks up the branched action when flattening, reshapes it to one row, wraps it in an `ActionTuple`, sets it and steps. If the agent appears in `TerminalSteps` the wrapper returns that observation with `done = True` and remembers that the game is over; otherwise it returns the decision step. The info dictionary is `{"step": <DecisionSteps or TerminalSteps>}`.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:154-232](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L154-L232)

`render()` returns the latest visual observation without rendering a new frame, and `seed()` only logs that seeding is not supported: pass a seed to `UnityEnvironment` instead.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_gym_env.py:279-298](repo://ml-agents-envs/mlagents_envs/envs/unity_gym_env.py#L279-L298)

## PettingZoo environments

### Agent ids

PettingZoo addresses agents by string. The wrappers build one from the behavior name and Unity's agent id, `"<behavior>?agent_id=<id>"`, and recover the behavior by splitting on `?agent_id=`. Observation and action spaces are kept per behavior and looked up from the agent id, so agents of different behaviors can coexist.

Sources: [ml-agents-envs/mlagents_envs/envs/env_helpers.py:4-9](repo://ml-agents-envs/mlagents_envs/envs/env_helpers.py#L4-L9), [ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py:56-107](repo://ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py#L56-L107)

### PettingZoo spaces

Each observation becomes an unbounded `float32` `Box` of its shape, and a behavior with several observations gets a `Tuple` of them. Actions map to `Discrete` for one branch, `MultiDiscrete` for several, a `Box(-1, 1)` for continuous actions, and a `Tuple(continuous, discrete)` for mixed specs; a behavior with no actions raises. Spaces are created for each behavior the first time it is seen and seeded with the wrapper's seed.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py:73-142](repo://ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py#L73-L142)

### Converting step results

`_unwrap_batch_steps` turns one behavior's `(DecisionSteps, TerminalSteps)` into per-agent dictionaries. Terminal agents are marked done, decision agents not done; rewards come from whichever batch the agent is in. When the behavior has action masks, a decision agent's observation is a dictionary `{"observation": ..., "action_mask": ...}`. A single observation is unwrapped from its list. Infos carry `behavior_name`, `group_id` and `group_reward`, plus `interrupted` for terminal agents.

Sources: [ml-agents-envs/mlagents_envs/envs/env_helpers.py:12-66](repo://ml-agents-envs/mlagents_envs/envs/env_helpers.py#L12-L66)

### The shared base

`UnityPettingzooBaseEnv` keeps the live agents, all agents of the current step, every agent ever seen (`possible_agents`), and per-agent observations, dones, rewards, cumulative rewards and infos. For each behavior it also keeps an `ActionTuple` of zeros sized to the current decision batch. `_process_action` validates an agent's action against its space, converts it to an `ActionTuple` and writes it into that agent's row; for an agent that is already done it instead removes the agent's entries. `_step` sets every behavior's actions, steps Unity and rebuilds the state from the new batches.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py:14-50](repo://ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py#L14-L50), [ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py:144-194](repo://ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py#L144-L194), [ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py:225-271](repo://ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py#L225-L271)

Side channels of the wrapped environment are exposed by class name through `env.side_channel["EnvironmentParametersChannel"]`, for example. `render()` and `state()` do nothing.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py:201-208](repo://ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py#L201-L208), [ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py:280-323](repo://ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py#L280-L323)

### UnityAECEnv

The AEC wrapper serves agents one at a time. `agent_selection` is the agent at the current index; `last()` returns its observation, cumulative reward, done flag and info. `step(action)` records the action for that agent, advances the index and zeroes the per-step rewards; once every agent of the step has acted, it steps Unity. Calling `step` with no live agents raises an error asking for `reset()`.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_aec_env.py:9-72](repo://ml-agents-envs/mlagents_envs/envs/unity_aec_env.py#L9-L72)

### UnityParallelEnv

The parallel wrapper takes a dictionary of actions for all agents at once. `reset()` returns the observation dictionary, and `step(actions)` processes every action, steps Unity, removes agents that are done from the live list and returns `(observations, rewards, dones, infos)`.

Sources: [ml-agents-envs/mlagents_envs/envs/unity_parallel_env.py:9-53](repo://ml-agents-envs/mlagents_envs/envs/unity_parallel_env.py#L9-L53)

## Registry shortcuts

Importing `mlagents_envs.envs` creates one `PettingZooEnvFactory` per entry of the default [[Environment Registry]], named after the registry id (a leading digit `3` becomes `Three`, so `3DBall` becomes `ThreeDBall`; ids that are still not identifiers are skipped with a warning).

Sources: [ml-agents-envs/mlagents_envs/envs/__init__.py:1-15](repo://ml-agents-envs/mlagents_envs/envs/__init__.py#L1-L15)

`factory.env(seed=..., **kwargs)` downloads and launches the registry environment and wraps it in `UnityAECEnv`. Unless side channels are given it adds engine configuration, environment parameters and stats channels, and unless `base_port` is given it tries ports from 6000 upward until one is free.

Sources: [ml-agents-envs/mlagents_envs/envs/pettingzoo_env_factory.py:18-50](repo://ml-agents-envs/mlagents_envs/envs/pettingzoo_env_factory.py#L18-L50)

```python
from mlagents_envs.envs import ThreeDBall

env = ThreeDBall.env()
env.reset()
for agent in env.agent_iter(env.num_agents * 10):
    obs, reward, done, info = env.last()
    env.step(env.action_spaces[agent].sample())
env.close()
```

Sources: [ml-agents-envs/mlagents_envs/envs/unity_aec_env.py:23-72](repo://ml-agents-envs/mlagents_envs/envs/unity_aec_env.py#L23-L72), [ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py:92-100](repo://ml-agents-envs/mlagents_envs/envs/unity_pettingzoo_base_env.py#L92-L100)
