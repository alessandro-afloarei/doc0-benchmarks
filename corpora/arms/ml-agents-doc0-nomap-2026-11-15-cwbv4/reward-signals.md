---
title: "Reward Signals"
---
## Overview

Trainers do not learn from the environment's reward alone. Each behavior has a set of reward signals declared under `reward_signals`, and each signal produces its own reward per step, has its own discount factor `gamma`, its own value head in the critic, and a `strength` that scales it. The environment reward is one such signal (`extrinsic`); the others are intrinsic rewards computed by neural networks that learn alongside the policy: curiosity and RND reward visiting unfamiliar states, and GAIL rewards behaving like a set of demonstrations.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/base_reward_provider.py:11-81](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/base_reward_provider.py#L11-L81), [ml-agents/mlagents/trainers/settings.py:179-250](repo://ml-agents/mlagents/trainers/settings.py#L179-L250)

## The reward provider interface

`BaseRewardProvider` stores `gamma` and `strength` from the signal's settings and defines what every signal must offer.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/base_reward_provider.py:11-81](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/base_reward_provider.py#L11-L81)

| Member | Purpose |
| --- | --- |
| `evaluate(mini_batch)` | Rewards for every step of a buffer, as a numpy array |
| `update(mini_batch)` | Train the signal's own networks; returns stats |
| `get_modules()` | Networks to save in checkpoints |
| `name` | Class name without `RewardProvider`, used in stat names |
| `ignore_done` | If true, returns are bootstrapped past episode ends for this signal |

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/base_reward_provider.py:18-81](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/base_reward_provider.py#L18-L81)

`create_reward_provider` maps each `RewardSignalType` to its class and raises `UnityTrainerException` for an unknown type. `TorchOptimizer.create_reward_signals` calls it for every configured signal, keyed by the signal's string name.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/reward_provider_factory.py:24-47](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/reward_provider_factory.py#L24-L47), [ml-agents/mlagents/trainers/optimizer/torch_optimizer.py:53-64](repo://ml-agents/mlagents/trainers/optimizer/torch_optimizer.py#L53-L64)

## How trainers use the signals

On-policy trainers evaluate every signal on each trajectory, multiply by `strength`, store the result as that signal's rewards, and compute per-signal advantages and returns with the signal's `gamma`; the policy follows the mean advantage. Signals are updated with `update_reward_signals` on each minibatch of the PPO update. SAC evaluates signals on every sampled minibatch and updates them on their own schedule ([[PPO Trainer]], [[SAC Trainer]]).

Sources: [ml-agents/mlagents/trainers/ppo/trainer.py:108-159](repo://ml-agents/mlagents/trainers/ppo/trainer.py#L108-L159), [ml-agents/mlagents/trainers/trainer/on_policy_trainer.py:96-105](repo://ml-agents/mlagents/trainers/trainer/on_policy_trainer.py#L96-L105), [ml-agents/mlagents/trainers/trainer/off_policy_trainer.py:200-263](repo://ml-agents/mlagents/trainers/trainer/off_policy_trainer.py#L200-L263)

`ignore_done` matters for intrinsic rewards. Curiosity and RND set it, so when an episode ends their value is still bootstrapped: otherwise an agent could learn that ending episodes avoids the novelty it is rewarded for, or the reverse. GAIL and extrinsic leave it false.

Sources: [ml-agents/mlagents/trainers/optimizer/torch_optimizer.py:205-210](repo://ml-agents/mlagents/trainers/optimizer/torch_optimizer.py#L205-L210), [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/curiosity_reward_provider.py:32-41](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/curiosity_reward_provider.py#L32-L41), [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/rnd_reward_provider.py:25-32](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/rnd_reward_provider.py#L25-L32)

Each signal's episode total is reported as `Policy/<Name> Reward`, and its losses under `Losses/` ([[Stats and TensorBoard]]).

Sources: [ml-agents/mlagents/trainers/trainer/rl_trainer.py:70-94](repo://ml-agents/mlagents/trainers/trainer/rl_trainer.py#L70-L94)

## Extrinsic

`ExtrinsicRewardProvider` returns the environment reward of each step plus the group reward. When `add_groupmate_rewards` is set, which POCA does, it also adds the sum of teammates' individual rewards. It has nothing to train.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/extrinsic_reward_provider.py:12-43](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/extrinsic_reward_provider.py#L12-L43), [ml-agents/mlagents/trainers/poca/optimizer_torch.py:215-234](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L215-L234)

## Curiosity

Curiosity follows the intrinsic curiosity module: reward the agent where it cannot yet predict the consequences of its actions. `CuriosityNetwork` encodes observations with a `NetworkBody` (memory is ignored with a warning) and has two heads on top.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/curiosity_reward_provider.py:69-110](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/curiosity_reward_provider.py#L69-L110)

| Model | Input | Predicts | Loss |
| --- | --- | --- | --- |
| Inverse | encoding of `s` and `s'` | the action taken | squared error (continuous) and cross-entropy (discrete) |
| Forward | encoding of `s` and the flattened action | the encoding of `s'` | half squared error |

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/curiosity_reward_provider.py:136-239](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/curiosity_reward_provider.py#L136-L239)

The inverse model shapes the encoder so it captures what the agent can influence; the forward model's error is the reward. `update` minimizes `10 * (0.2 * forward_loss + 0.8 * inverse_loss)`, with losses averaged over non-padding steps. `evaluate` returns the forward prediction error clipped at `1 / strength`, so a scaled reward never exceeds 1, and returns zeros until the networks have been updated once.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/curiosity_reward_provider.py:28-66](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/curiosity_reward_provider.py#L28-L66)

## Random Network Distillation (RND)

RND rewards states that are new without predicting dynamics. It has two identical `NetworkBody` encoders: a randomly initialized target that is never trained and a predictor trained to reproduce the target's output. The reward is the squared prediction error summed over features, which is high for states the predictor has seen little of. `update` takes one Adam step on the mean error and reports `Losses/RND Loss`. Both encoders update their observation normalization on the batches they see. Memory settings are ignored with a warning.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/rnd_reward_provider.py:20-80](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/rnd_reward_provider.py#L20-L80)

## GAIL

### Demonstrations

GAIL (generative adversarial imitation learning) learns a reward from demonstrations. On creation the provider loads the `.demo` file named by `demo_path` into a buffer ([[Demonstrations and Imitation Learning]]) and builds a `DiscriminatorNetwork` that outputs the probability that a step came from the demonstrations.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py:23-64](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py#L23-L64)

### Discriminator

The discriminator encodes observations with a `NetworkBody`; with `use_actions` it also feeds the flattened action and the done flag, so it judges state-action pairs rather than states alone. A sigmoid output layer produces the estimate. With `use_vail` (variational discriminator bottleneck) the encoding passes through a 128-dimensional stochastic code with learned sigma before the estimate.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py:67-157](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py#L67-L157)

### Training and reward

`update` samples an expert minibatch of the same size from the demonstrations, updates the encoder's normalization with it, and minimizes:

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py:48-61](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py#L48-L61)

| Term | Definition |
| --- | --- |
| Discriminator loss | `-mean(log D(expert) + log(1 - D(policy)))` |
| VAIL term (with `use_vail`) | `beta * (KL - 0.5)`, with `beta` adapted toward the 0.5 information constraint at rate 0.0005 |
| Gradient penalty | `10 * mean((norm(grad D(x)) - 1)^2)` at random interpolations between policy and expert inputs |

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py:159-260](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py#L159-L260)

The reward is `-log(1 - D(s, a))`: large when the discriminator believes the step looks like the demonstrations. Stats include `Losses/GAIL Loss`, `Policy/GAIL Policy Estimate`, `Policy/GAIL Expert Estimate`, `Policy/GAIL Grad Mag Loss`, and with VAIL `Losses/GAIL KL Loss` and `Policy/GAIL Beta`.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py:35-46](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py#L35-L46), [ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py:173-209](repo://ml-agents/mlagents/trainers/torch_entities/components/reward_providers/gail_reward_provider.py#L173-L209)

## Configuring signals

The example configurations show typical combinations: Pyramids adds curiosity (or RND in `PyramidsRND.yaml`) to a sparse extrinsic reward, and the imitation configurations add a GAIL signal with a small strength next to extrinsic, often with behavioral cloning as well.

Sources: [config/ppo/Pyramids.yaml:1-30](repo://config/ppo/Pyramids.yaml#L1-L30), [config/ppo/PyramidsRND.yaml:1-30](repo://config/ppo/PyramidsRND.yaml#L1-L30), [config/imitation/Hallway.yaml:1-30](repo://config/imitation/Hallway.yaml#L1-L30)
