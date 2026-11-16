---
title: "SAC Trainer"
---
## Overview

SAC (Soft Actor-Critic, `trainer_type: sac`) is the off-policy trainer. Instead of discarding experience after each update, it keeps a large replay buffer and repeatedly samples minibatches from it, which makes it more sample-efficient than PPO in environments where steps are expensive. Its objective adds an entropy bonus whose weight is tuned automatically, so the policy stays as random as it can while still maximizing reward. `SACTrainer` handles trajectories and the replay buffer through `OffPolicyTrainer`; `TorchSACOptimizer` holds the Q networks, value network, target network and entropy coefficients and computes the four losses.

Sources: [ml-agents/mlagents/trainers/sac/trainer.py:30-83](repo://ml-agents/mlagents/trainers/sac/trainer.py#L30-L83), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:126-162](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L126-L162), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:216-231](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L216-L231)

## Hyperparameters

| Field | Default | Role |
| --- | --- | --- |
| `batch_size` | 128 | Experiences per sampled minibatch |
| `buffer_size` | 50000 | Replay buffer capacity |
| `buffer_init_steps` | 0 | Steps to collect before the first update |
| `steps_per_update` | 1 | Environment steps per gradient update |
| `reward_signal_steps_per_update` | `steps_per_update` | Environment steps per reward-signal update |
| `tau` | 0.005 | Target network soft-update rate |
| `init_entcoef` | 1.0 | Initial entropy coefficient |
| `save_replay_buffer` | false | Save and restore the replay buffer with checkpoints |
| `learning_rate`, `learning_rate_schedule` | 3e-4, constant | Shared by all three Adam optimizers |

Sources: [ml-agents/mlagents/trainers/sac/optimizer_torch.py:29-41](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L29-L41), [ml-agents/mlagents/trainers/settings.py:156-176](repo://ml-agents/mlagents/trainers/settings.py#L156-L176)

## Replay buffer and update cadence

The cadence lives in `OffPolicyTrainer` ([[Trainer Architecture]]). The trainer becomes ready once the buffer holds `batch_size` experiences and `buffer_init_steps` steps have passed. Each time it is ready, it performs as many updates as needed to keep `(step - buffer_init_steps) / update_steps` at or below `steps_per_update`; each update samples random sequences from the buffer and evaluates every reward signal on that sample, so intrinsic rewards always reflect the current reward networks. The buffer is truncated to 80% of `buffer_size` once it exceeds `buffer_size`.

Sources: [ml-agents/mlagents/trainers/trainer/off_policy_trainer.py:126-134](repo://ml-agents/mlagents/trainers/trainer/off_policy_trainer.py#L126-L134), [ml-agents/mlagents/trainers/trainer/off_policy_trainer.py:182-234](repo://ml-agents/mlagents/trainers/trainer/off_policy_trainer.py#L182-L234)

Reward signals that learn (curiosity, GAIL, RND) are updated separately at `reward_signal_steps_per_update`, which allows schemes that update the policy several times per reward-signal update.

Sources: [ml-agents/mlagents/trainers/trainer/off_policy_trainer.py:236-263](repo://ml-agents/mlagents/trainers/trainer/off_policy_trainer.py#L236-L263)

## Processing a trajectory

`SACTrainer._process_trajectory` converts the trajectory to a buffer, updates the actor's and critic's observation normalizers, and evaluates reward signals and critic values only to report them (`Policy/<Signal> Value`, episode reward totals); the actual rewards for training are computed at sampling time. With a recurrent critic it stores the critic memories.

Sources: [ml-agents/mlagents/trainers/sac/trainer.py:85-130](repo://ml-agents/mlagents/trainers/sac/trainer.py#L85-L130)

Interrupted episodes get special treatment. Since a replay buffer stores single transitions, the last transition of an episode cut short by `MaxStep` would otherwise look terminal. The trainer replaces that transition's next observation with its own observation and sets `done` to false, so the Q target bootstraps from a real state instead of zero. The trajectory is then appended to the replay buffer.

Sources: [ml-agents/mlagents/trainers/sac/trainer.py:131-142](repo://ml-agents/mlagents/trainers/sac/trainer.py#L131-L142)

## Networks

| Network | Built from | Purpose |
| --- | --- | --- |
| Actor | `SimpleActor` with `conditional_sigma=True`, `tanh_squash=True` | The policy |
| `q_network.q1_network`, `q2_network` | `ValueNetwork`s taking continuous actions as input, outputting one value per discrete action (or one) per reward signal | Twin Q functions |
| `_critic` | `ValueNetwork` per reward signal | State value V |
| `target_network` | `ValueNetwork`, initialized as a copy of the critic | Slow-moving V for Q targets |
| `_log_ent_coef` | one log coefficient per discrete branch and one for continuous actions | Entropy weights |

Sources: [ml-agents/mlagents/trainers/sac/trainer.py:149-169](repo://ml-agents/mlagents/trainers/sac/trainer.py#L149-L169), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:45-124](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L45-L124), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:163-203](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L163-L203)

SAC refuses a `SharedActorCritic` actor. The target entropy is `-1.0 * continuous_size` for continuous actions and `0.2 * log(branch_size)` per discrete branch. Three Adam optimizers update the policy, the value parameters (both Q networks and the critic) and the entropy coefficients, all with the same decayed learning rate.

Sources: [ml-agents/mlagents/trainers/sac/optimizer_torch.py:126-231](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L126-L231)

## One update

`update` reads the per-signal rewards that the trainer stored in the minibatch, rebuilds observations, next observations, masks, actions and memories, and copies the actor's observation normalization into all the other networks so they see inputs on the same scale. It then samples fresh actions from the current policy, evaluates both Q networks on those actions (Q2 without gradients) and on the stored actions, condenses discrete Q outputs to the taken action of each branch, and evaluates the target network on the next observations.

Sources: [ml-agents/mlagents/trainers/sac/optimizer_torch.py:480-597](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L480-L597), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:459-478](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L459-L478)

| Loss | Target |
| --- | --- |
| Q loss (`sac_q_loss`) | `r + gamma * (1 - done) * V_target(s')` per reward signal, half mean-squared error for Q1 and Q2; `done` is ignored for signals that set `ignore_done` |
| Value loss (`sac_value_loss`) | `min(Q1, Q2)` of the sampled action minus the entropy term, using probability-weighted Q values for discrete branches |
| Policy loss (`sac_policy_loss`) | `alpha * log_prob - Q1` for continuous actions, and the per-branch expectation of the same for discrete actions |
| Entropy loss (`sac_entropy_loss`) | Pushes each `log(alpha)` so the policy's entropy approaches its target |

Sources: [ml-agents/mlagents/trainers/sac/optimizer_torch.py:243-275](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L243-L275), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:277-367](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L277-L367), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:369-457](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L369-L457)

The policy, value (Q1 + Q2 + V) and entropy losses are back-propagated by their own optimizers, then the target network is moved toward the critic by `tau`. A value loss that becomes infinite or NaN raises `UnityTrainerException`. The update returns `Losses/Policy Loss`, `Losses/Value Loss`, `Losses/Q1 Loss`, `Losses/Q2 Loss`, the mean discrete and continuous entropy coefficients and the learning rate.

Sources: [ml-agents/mlagents/trainers/sac/optimizer_torch.py:599-642](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L599-L642), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:364-367](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L364-L367)

## Saving and resuming

`get_modules` exposes the Q networks, value network, target network, the three optimizers and the reward providers' modules for checkpointing. With `save_replay_buffer`, the buffer is written to `last_replay_buffer.hdf5` with each checkpoint, and `create_policy` calls `maybe_load_replay_buffer` so a resumed run starts with its old experience ([[Model Saving and ONNX Export]]).

Sources: [ml-agents/mlagents/trainers/sac/optimizer_torch.py:644-655](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L644-L655), [ml-agents/mlagents/trainers/trainer/off_policy_trainer.py:81-149](repo://ml-agents/mlagents/trainers/trainer/off_policy_trainer.py#L81-L149), [ml-agents/mlagents/trainers/sac/trainer.py:149-169](repo://ml-agents/mlagents/trainers/sac/trainer.py#L149-L169)
