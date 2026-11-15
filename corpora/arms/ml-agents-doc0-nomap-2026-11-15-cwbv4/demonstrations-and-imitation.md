---
title: "Demonstrations and Imitation Learning"
---
## Overview

Imitation learning uses recorded examples of good behavior to speed up or replace reinforcement learning. The flow crosses both halves of the toolkit. In Unity, a `DemonstrationRecorder` on an agent writes every step the agent takes (usually while a human plays through the `Heuristic`) to a `.demo` file of length-prefixed protobuf messages. In Python, `demo_loader` reads such files into an `AgentBuffer`, which two trainer components consume: the behavioral cloning (BC) module, which trains the policy to copy the demonstrated actions, and the GAIL reward signal, which trains a discriminator to reward demonstration-like behavior ([[Reward Signals]]).

Sources: [com.unity.ml-agents/Runtime/Demonstrations/DemonstrationRecorder.cs:24-128](repo://com.unity.ml-agents/Runtime/Demonstrations/DemonstrationRecorder.cs#L24-L128), [ml-agents/mlagents/trainers/demo_loader.py:104-143](repo://ml-agents/mlagents/trainers/demo_loader.py#L104-L143)

## Recording in Unity

### DemonstrationRecorder

`DemonstrationRecorder` is a component that requires an `Agent`. Its fields are `Record` (on or off), `NumStepsToRecord` (0 for unlimited), `DemonstrationName` (defaults to the behavior name) and `DemonstrationDirectory` (defaults to `Assets/Demonstrations`).

Sources: [com.unity.ml-agents/Runtime/Demonstrations/DemonstrationRecorder.cs:24-68](repo://com.unity.ml-agents/Runtime/Demonstrations/DemonstrationRecorder.cs#L24-L68)

While `Record` is on, `Update` lazily creates the writer and, once `NumStepsToRecord` steps have been written, quits the application (and stops play mode in the Editor). `LazyInitialize` strips the name to letters, digits, spaces and hyphens and truncates it to 16 characters (it must fit in the fixed-size metadata), creates the directory if needed, picks a free file name by appending `_0`, `_1`, ... and opens the file. It then initializes the writer with the behavior's `BrainParameters` and fully qualified name and adds it to the agent's `DemonstrationWriters`. `Close`, called on destroy, removes and closes the writer.

Sources: [com.unity.ml-agents/Runtime/Demonstrations/DemonstrationRecorder.cs:75-176](repo://com.unity.ml-agents/Runtime/Demonstrations/DemonstrationRecorder.cs#L75-L176), [com.unity.ml-agents/Runtime/Demonstrations/DemonstrationRecorder.cs:183-226](repo://com.unity.ml-agents/Runtime/Demonstrations/DemonstrationRecorder.cs#L183-L226)

The agent itself feeds the writers: every time it sends a decision, and when its episode ends, it calls `Record(info, sensors)` on each registered `DemonstrationWriter` with the same `AgentInfo` and sensors it gives its policy. Recording therefore captures whatever policy is driving the agent, whether a heuristic, a model or the trainer ([[Agents and Episodes]]).

Sources: [com.unity.ml-agents/Runtime/Agent.cs:1140-1147](repo://com.unity.ml-agents/Runtime/Agent.cs#L1140-L1147), [com.unity.ml-agents/Runtime/Agent.cs:619-626](repo://com.unity.ml-agents/Runtime/Agent.cs#L619-L626)

### File format

| Position | Content |
| --- | --- |
| byte 0 | Length-delimited `DemonstrationMetaProto` (name, number of steps and episodes, mean reward, API version), padded to 32 bytes |
| byte 33 | Length-delimited `BrainParametersProto` for the behavior |
| then | One length-delimited `AgentInfoActionPairProto` per recorded step: the `AgentInfo` with its observations, and the stored actions |

Sources: [com.unity.ml-agents/Runtime/Demonstrations/DemonstrationWriter.cs:13-131](repo://com.unity.ml-agents/Runtime/Demonstrations/DemonstrationWriter.cs#L13-L131), [com.unity.ml-agents/Runtime/Demonstrations/DemonstrationMetaData.cs:10-19](repo://com.unity.ml-agents/Runtime/Demonstrations/DemonstrationMetaData.cs#L10-L19)

`DemonstrationWriter.Initialize` writes a first metadata block, then seeks to byte 33 and writes the brain parameters. `Record` increments the step count, adds the reward to a running total, counts an episode when the info is done, and appends the info-action pair with observations encoded by the same `GetObservationProto` used for training (so visual observations may be PNG-compressed). `Close` ends the last episode, computes the mean reward per episode and rewrites the metadata at the start of the file, which is why that block has a fixed size.

Sources: [com.unity.ml-agents/Runtime/Demonstrations/DemonstrationWriter.cs:49-157](repo://com.unity.ml-agents/Runtime/Demonstrations/DemonstrationWriter.cs#L49-L157)

### Importing in the Editor

`DemonstrationImporter` is a scripted importer for the `.demo` extension. It reads the metadata, the brain parameters and the first info-action pair (for observation shapes) and creates a `DemonstrationSummary` asset with a demo icon, so recorded files show their step count, episodes, mean reward and shapes in the Inspector. Read errors are ignored.

Sources: [com.unity.ml-agents/Editor/DemonstrationImporter.cs:19-74](repo://com.unity.ml-agents/Editor/DemonstrationImporter.cs#L19-L74), [com.unity.ml-agents/Runtime/Demonstrations/DemonstrationSummary.cs:11-36](repo://com.unity.ml-agents/Runtime/Demonstrations/DemonstrationSummary.cs#L11-L36)

## Loading in Python

`demo_path` may name a `.demo` file or a folder; `get_demo_files` returns every `.demo` in a folder and raises for a wrong extension, an empty folder or a missing path.

Sources: [ml-agents/mlagents/trainers/demo_loader.py:146-170](repo://ml-agents/mlagents/trainers/demo_loader.py#L146-L170)

`load_demonstration` reads each file whole and walks its varint-delimited messages. The first is the metadata; its `api_version` must be 0 or 1, and its `number_steps` is added to the expected total, after which the reader jumps to byte 33. The second is the brain parameters. Every following message is an info-action pair; the first one, together with the brain parameters, yields the `BehaviorSpec` through the same `behavior_spec_from_proto` the live environment uses. Reading stops once the expected number of steps has been collected. A file with no brain parameters raises.

Sources: [ml-agents/mlagents/trainers/demo_loader.py:18-19](repo://ml-agents/mlagents/trainers/demo_loader.py#L18-L19), [ml-agents/mlagents/trainers/demo_loader.py:173-228](repo://ml-agents/mlagents/trainers/demo_loader.py#L173-L228)

`make_demo_buffer` turns consecutive pairs into training rows. For each step it stores the observation, the action (from the separate continuous and discrete fields, or from the deprecated flat field for old recordings), the previous step's action, and the reward and done flag of the following step. Each finished episode is re-sequenced into the output buffer with the requested sequence length, so recurrent policies can train on it.

Sources: [ml-agents/mlagents/trainers/demo_loader.py:25-101](repo://ml-agents/mlagents/trainers/demo_loader.py#L25-L101)

`demo_to_buffer` combines the two and, when given the policy's behavior spec, raises if the demonstration's action spec, number of observations or any observation shape differs. `write_demo` writes a demo file from protos, which the tests use.

Sources: [ml-agents/mlagents/trainers/demo_loader.py:104-143](repo://ml-agents/mlagents/trainers/demo_loader.py#L104-L143), [ml-agents/mlagents/trainers/demo_loader.py:231-246](repo://ml-agents/mlagents/trainers/demo_loader.py#L231-L246)

## Behavioral cloning

### Setting up

When a behavior's configuration has a `behavioral_cloning` block, `TorchOptimizer` creates a `BCModule` with the policy, the settings, the trainer's learning rate and batch size, and 3 epochs as defaults. The module loads the demonstrations with the policy's sequence length, uses `batch_size` and `num_epoch` from the settings when given, and creates its own Adam optimizer on the actor's parameters with learning rate `learning_rate * strength`. With `steps` above 0 that rate decays linearly to zero over `steps` steps; with 0 it stays constant.

Sources: [ml-agents/mlagents/trainers/optimizer/torch_optimizer.py:34-44](repo://ml-agents/mlagents/trainers/optimizer/torch_optimizer.py#L34-L44), [ml-agents/mlagents/trainers/torch_entities/components/bc/module.py:15-59](repo://ml-agents/mlagents/trainers/torch_entities/components/bc/module.py#L15-L59)

### Updating

Trainers call `bc_module.update()` after each policy update: once per update in on-policy trainers, and in the update loop of off-policy trainers. Once the decayed rate reaches 1e-10 the update does nothing and reports a zero loss. Otherwise, for each epoch, it shuffles the demonstration buffer and runs minibatches over it, limited to `samples_per_update / batch` minibatches when `samples_per_update` is set.

Sources: [ml-agents/mlagents/trainers/trainer/on_policy_trainer.py:110-113](repo://ml-agents/mlagents/trainers/trainer/on_policy_trainer.py#L110-L113), [ml-agents/mlagents/trainers/trainer/off_policy_trainer.py:221-224](repo://ml-agents/mlagents/trainers/trainer/off_policy_trainer.py#L221-L224), [ml-agents/mlagents/trainers/torch_entities/components/bc/module.py:61-104](repo://ml-agents/mlagents/trainers/torch_entities/components/bc/module.py#L61-L104)

Each minibatch runs the actor on the demonstrated observations (all actions unmasked, zero initial memories) and computes the loss: mean squared error between sampled and expert continuous actions, plus, for each discrete branch, cross-entropy between the policy's log-probabilities and the one-hot expert action. The mean loss is reported as `Losses/Pretraining Loss`.

Sources: [ml-agents/mlagents/trainers/torch_entities/components/bc/module.py:106-186](repo://ml-agents/mlagents/trainers/torch_entities/components/bc/module.py#L106-L186)

## Combining BC and GAIL

BC pulls the policy directly toward the demonstrated actions and is strongest early; GAIL provides a reward that keeps encouraging demonstration-like states and actions throughout training. In `config/imitation`, the Pyramids, PushBlock and Crawler configurations use both together with the extrinsic reward (Pyramids also adds curiosity), while Hallway uses GAIL alone next to the extrinsic reward. Their settings are described on [[Training Configuration]].

Sources: [config/imitation/Hallway.yaml:1-35](repo://config/imitation/Hallway.yaml#L1-L35), [config/imitation/Pyramids.yaml:1-34](repo://config/imitation/Pyramids.yaml#L1-L34), [config/imitation/PushBlock.yaml:1-40](repo://config/imitation/PushBlock.yaml#L1-L40), [config/imitation/Crawler.yaml:1-39](repo://config/imitation/Crawler.yaml#L1-L39)
