---
title: "POCA Multi-Agent Trainer"
---
## Overview

MA-POCA (`trainer_type: poca`) trains agents that cooperate in a group toward a shared reward. Training each agent independently with PPO works poorly here: an agent's reward depends on what its teammates did, and agents that leave the episode early (killed, removed, finished) stop receiving the group reward they helped earn. POCA addresses both with a centralized critic that looks at all group members through attention, so it handles any number of agents, and a per-agent counterfactual baseline that estimates how much this agent's action contributed. Groups are formed in Unity with `SimpleMultiAgentGroup` ([[Multi-Agent Groups]]).

Sources: [ml-agents/mlagents/trainers/poca/trainer.py:27-69](repo://ml-agents/mlagents/trainers/poca/trainer.py#L27-L69), [ml-agents/mlagents/trainers/poca/optimizer_torch.py:53-154](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L53-L154)

POCA reuses PPO's on-policy machinery: same buffer cadence, epochs and clipped policy loss through `OnPolicyTrainer` ([[Trainer Architecture]], [[PPO Trainer]]). What differs is how values, baselines and advantages are computed.

Sources: [ml-agents/mlagents/trainers/poca/trainer.py:195-201](repo://ml-agents/mlagents/trainers/poca/trainer.py#L195-L201), [ml-agents/mlagents/trainers/trainer/on_policy_trainer.py:67-115](repo://ml-agents/mlagents/trainers/trainer/on_policy_trainer.py#L67-L115)

## Group data in trajectories

Each POCA trajectory carries, for every step, the teammates' observations, actions, rewards and done flags, the group reward, and the teammates' next observations, all filled in by the agent processor from the group status of each agent ([[Agent Processor and Trajectories]]). Teammate observations are stored as list-valued columns and converted to padded arrays with `NaN` where a step had fewer teammates, which is how the critic later knows which slots are empty.

Sources: [ml-agents/mlagents/trainers/trajectory.py:167-239](repo://ml-agents/mlagents/trainers/trajectory.py#L167-L239), [ml-agents/mlagents/trainers/trajectory.py:103-133](repo://ml-agents/mlagents/trainers/trajectory.py#L103-L133)

## The centralized critic

### Two questions, one network

`POCAValueNetwork` wraps a `MultiAgentNetworkBody` and one value head per reward signal. It answers two questions with the same network.

Sources: [ml-agents/mlagents/trainers/poca/optimizer_torch.py:54-154](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L54-L154)

| Method | Inputs | Meaning |
| --- | --- | --- |
| `critic_pass(obs)` | observations of every group member | Value of the group's state, V(s) |
| `baseline(self_obs, (teammate_obs, teammate_actions))` | this agent's observation, and teammates' observations with their actions | Value with this agent's action marginalized out, the counterfactual baseline |

Sources: [ml-agents/mlagents/trainers/poca/optimizer_torch.py:87-144](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L87-L144)

### MultiAgentNetworkBody

The body encodes each agent's observations with a shared `ObservationEncoder`. Observation-only entities go through one entity embedding; observation-plus-action entities (observations concatenated with the flattened action) go through another. All embedded entities are fed to a `ResidualSelfAttention` block, with an attention mask built from the `NaN` padding so absent teammates are ignored, then through a linear encoder and an optional LSTM.

Sources: [ml-agents/mlagents/trainers/torch_entities/networks.py:254-316](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L254-L316), [ml-agents/mlagents/trainers/torch_entities/networks.py:359-426](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L359-L426)

The network also appends the number of agents present, rescaled to `[-1, 1]` against the largest group size seen so far (tracked in a non-trainable parameter), so the value head can tell a full team from a depleted one. Because attention works over a set, the same weights handle groups whose size changes during an episode. The attention layer is described on [[Observation Encoders and Attention]].

Sources: [ml-agents/mlagents/trainers/torch_entities/networks.py:328-357](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L328-L357), [ml-agents/mlagents/trainers/torch_entities/networks.py:406-426](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L406-L426)

## Processing a trajectory

### Value and baseline estimates

`POCATrainer._process_trajectory` updates the normalizers, then asks the optimizer for value estimates, baseline estimates and the bootstrap value. The trajectory counts as terminal only if this agent is done, every teammate is done, and the episode was not interrupted: an agent that dies while its teammates play on still gets a bootstrapped value, because the group's outcome is not yet known.

Sources: [ml-agents/mlagents/trainers/poca/trainer.py:70-119](repo://ml-agents/mlagents/trainers/poca/trainer.py#L70-L119)

`get_trajectory_and_baseline_value_estimates` runs `critic_pass` on the agent plus its teammates for every step and `baseline` with the teammates' actions, keeping separate per-agent value and baseline memories for recurrent critics. The bootstrap value uses the agent's next observation together with the teammates' next observations, and is zeroed on a terminal trajectory for signals that do not ignore `done`.

Sources: [ml-agents/mlagents/trainers/poca/optimizer_torch.py:551-640](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L551-L640), [ml-agents/mlagents/trainers/poca/optimizer_torch.py:641-690](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L641-L690)

### Rewards and advantages

Rewards are evaluated and scaled per signal as in PPO. POCA's extrinsic reward provider is switched to also add the group reward (and teammates' individual rewards when that flag is set), so the shared outcome drives learning. Other reward signals log a warning that they are not supported with POCA.

Sources: [ml-agents/mlagents/trainers/poca/trainer.py:121-135](repo://ml-agents/mlagents/trainers/poca/trainer.py#L121-L135), [ml-agents/mlagents/trainers/poca/optimizer_torch.py:215-234](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L215-L234), [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/extrinsic_reward_provider.py:19-40](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/extrinsic_reward_provider.py#L19-L40)

For each signal, POCA computes TD(lambda) returns from the rewards and the centralized value estimates with `lambda_return`, and the advantage as return minus the agent's own baseline. The mean advantage over signals becomes the `advantages` column used by the policy loss.

Sources: [ml-agents/mlagents/trainers/poca/trainer.py:137-177](repo://ml-agents/mlagents/trainers/poca/trainer.py#L137-L177), [ml-agents/mlagents/trainers/trainer/trainer_utils.py:36-45](repo://ml-agents/mlagents/trainers/trainer/trainer_utils.py#L36-L45)

### Group episode stats

Besides the per-agent `Environment/Cumulative Reward`, the trainer sums each agent's group rewards. When the whole group is done it reports `Environment/Group Cumulative Reward` (histogram aggregation); an agent that finished before its teammates is dropped from that tally. `end_episode` clears it on a forced reset.

Sources: [ml-agents/mlagents/trainers/poca/trainer.py:179-210](repo://ml-agents/mlagents/trainers/poca/trainer.py#L179-L210)

## The update

`TorchPOCAOptimizer.update` re-evaluates the stored actions' log-probabilities, the centralized values with all observations, and the baselines with teammates' observations and actions, each sequence starting from the stored memories. Three trust-region losses are combined:

Sources: [ml-agents/mlagents/trainers/poca/optimizer_torch.py:240-330](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L240-L330)

| Term | Definition |
| --- | --- |
| Value loss | Clipped value loss of the centralized values against the lambda returns |
| Baseline loss | Clipped value loss of the baselines against the same returns |
| Policy loss | PPO clipped surrogate with the baseline advantages |
| Total | `policy_loss + 0.5 * (value_loss + 0.5 * baseline_loss) - beta * mean(entropy)` |

Sources: [ml-agents/mlagents/trainers/poca/optimizer_torch.py:331-369](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L331-L369)

One Adam optimizer covers actor and critic, with the same decayed learning rate, epsilon and beta as PPO. The update reports `Losses/Baseline Loss` in addition to PPO's statistics, and `get_modules` saves the optimizer, the critic and the reward providers.

Sources: [ml-agents/mlagents/trainers/poca/optimizer_torch.py:156-213](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L156-L213), [ml-agents/mlagents/trainers/poca/optimizer_torch.py:358-375](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L358-L375)

## Policy

The actor is a plain `SimpleActor` that sees only the agent's own observations, as in PPO; only the critic is centralized. A trained POCA model therefore runs in Unity like any other model, one agent at a time.

Sources: [ml-agents/mlagents/trainers/poca/trainer.py:212-237](repo://ml-agents/mlagents/trainers/poca/trainer.py#L212-L237)

## Teams and self-play

POCA supports `self_play` like the other trainers: the SoccerTwos and StrikersVsGoalie configurations combine POCA groups per team with a ghost trainer that alternates which team learns ([[Self-Play]]).

Sources: [config/poca/SoccerTwos.yaml:1-30](repo://config/poca/SoccerTwos.yaml#L1-L30), [ml-agents/mlagents/trainers/trainer/trainer_factory.py:121-131](repo://ml-agents/mlagents/trainers/trainer/trainer_factory.py#L121-L131)
