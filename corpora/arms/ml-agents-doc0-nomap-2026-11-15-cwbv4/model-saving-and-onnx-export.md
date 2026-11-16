---
title: "Model Saving and ONNX Export"
---
## Overview

Training produces two kinds of artifacts per behavior. PyTorch checkpoints (`.pt`) hold the state of every network and optimizer so a run can be resumed or used to initialize another. ONNX exports (`.onnx`) hold only the policy's acting network, with fixed input and output names, so the Unity package can run it with Sentis ([[Inference with Sentis]]) without Python. Each checkpoint writes both. `TorchModelSaver` does the writing and loading, `ModelSerializer` does the ONNX export, and `ModelCheckpointManager` keeps the list of checkpoints and deletes old ones.

Sources: [ml-agents/mlagents/trainers/model_saver/torch_model_saver.py:18-65](repo://ml-agents/mlagents/trainers/model_saver/torch_model_saver.py#L18-L65), [ml-agents/mlagents/trainers/torch_entities/model_serialization.py:87-173](repo://ml-agents/mlagents/trainers/torch_entities/model_serialization.py#L87-L173)

`BaseModelSaver` defines the interface (`register`, `save_checkpoint`, `export`, `initialize_or_load`), and `RLTrainer.create_model_saver` returns a `TorchModelSaver` for the trainer's artifact folder, `results/<run-id>/<behavior>`. When checkpoints are taken is described on [[Trainer Architecture]].

Sources: [ml-agents/mlagents/trainers/model_saver/model_saver.py:6-69](repo://ml-agents/mlagents/trainers/model_saver/model_saver.py#L6-L69), [ml-agents/mlagents/trainers/trainer/rl_trainer.py:117-124](repo://ml-agents/mlagents/trainers/trainer/rl_trainer.py#L117-L124)

## Registering what to save

A trainer registers its policy and its optimizer with the saver in `add_policy`. `register` accepts only a `TorchPolicy` or `TorchOptimizer` (anything else raises `UnityPolicyException`) and merges the module's `get_modules()` dictionary into the saver's own. The first policy registered also becomes the one exported, through a `ModelSerializer` built for it. The module names are the keys of the checkpoint, so the policy, the critic, and each reward signal's networks are stored side by side.

Sources: [ml-agents/mlagents/trainers/model_saver/torch_model_saver.py:23-47](repo://ml-agents/mlagents/trainers/model_saver/torch_model_saver.py#L23-L47), [ml-agents/mlagents/trainers/trainer/on_policy_trainer.py:139-141](repo://ml-agents/mlagents/trainers/trainer/on_policy_trainer.py#L139-L141)

## Writing a checkpoint

`save_checkpoint(behavior_name, step)` collects the `state_dict` of every registered module and writes it twice: as `<behavior>-<step>.pt` and as `checkpoint.pt`, the latest checkpoint used for resuming. It then exports `<behavior>-<step>.onnx` and returns the ONNX path with the `.pt` path as an auxiliary file.

Sources: [ml-agents/mlagents/trainers/model_saver/torch_model_saver.py:49-61](repo://ml-agents/mlagents/trainers/model_saver/torch_model_saver.py#L49-L61)

At the end of training, `copy_final_model` copies the last checkpoint's ONNX file to `results/<run-id>/<behavior>.onnx`, the file a user drags into Unity. It does so only when `SerializationSettings.convert_to_onnx` is set, and ignores copy errors.

Sources: [ml-agents/mlagents/trainers/model_saver/torch_model_saver.py:139-153](repo://ml-agents/mlagents/trainers/model_saver/torch_model_saver.py#L139-L153), [ml-agents/mlagents/trainers/trainer/rl_trainer.py:159-178](repo://ml-agents/mlagents/trainers/trainer/rl_trainer.py#L159-L178)

## Keeping N checkpoints

`ModelCheckpoint` records a checkpoint's step, ONNX path, mean reward since the last policy update, creation time and auxiliary files. `ModelCheckpointManager` keeps the list per behavior in `GlobalTrainingStatus` under `checkpoints`, so it is written to `training_status.json`.

Sources: [ml-agents/mlagents/trainers/policy/checkpoint_manager.py:11-31](repo://ml-agents/mlagents/trainers/policy/checkpoint_manager.py#L11-L31)

`add_checkpoint` appends the new entry and, while the list is longer than `keep_checkpoints`, removes the oldest entry and deletes its ONNX and `.pt` files. `track_final_checkpoint` records the final model (or the last one if training was interrupted) under `final_checkpoint`.

Sources: [ml-agents/mlagents/trainers/policy/checkpoint_manager.py:33-101](repo://ml-agents/mlagents/trainers/policy/checkpoint_manager.py#L33-L101)

## Loading: resume and initialize-from

`initialize_or_load` runs when the trainer adds its policy. With an `init_path` (from `--initialize-from` or the behavior's `init_path`), it loads that file and resets the step count to 0, unless the run is also resuming. With `--resume`, it loads `checkpoint.pt` from the artifact folder and keeps the stored step count.

Sources: [ml-agents/mlagents/trainers/model_saver/torch_model_saver.py:67-83](repo://ml-agents/mlagents/trainers/model_saver/torch_model_saver.py#L67-L83)

`_load_model` loads each registered module from the checkpoint by name. For `nn.Module`s it uses `load_state_dict(strict=False)` and warns about missing keys (left initialized) and unexpected keys (ignored). A module absent from the checkpoint, an optimizer whose parameters changed, or a layer whose size changed is logged as a warning and keeps its fresh initialization, while layers that still match are loaded. This makes `--initialize-from` usable even after adding a reward signal or changing part of the network.

Sources: [ml-agents/mlagents/trainers/model_saver/torch_model_saver.py:85-137](repo://ml-agents/mlagents/trainers/model_saver/torch_model_saver.py#L85-L137)

The optional `policy` argument loads into a different policy than the registered one; the ghost trainer uses it to initialize its frozen opponent policies ([[Self-Play]]).

Sources: [ml-agents/mlagents/trainers/model_saver/torch_model_saver.py:67-71](repo://ml-agents/mlagents/trainers/model_saver/torch_model_saver.py#L67-L71)

## Exporting to ONNX

### Graph inputs and outputs

`ModelSerializer` prepares a dummy input and the tensor names once, when the policy is registered. Inputs are one tensor per observation (batch size 1, channel-first for visual observations), the action mask sized to the sum of discrete branch sizes, and the recurrent memory sized to the policy's export memory size. All inputs have a dynamic batch axis.

Sources: [ml-agents/mlagents/trainers/torch_entities/model_serialization.py:87-121](repo://ml-agents/mlagents/trainers/torch_entities/model_serialization.py#L87-L121), [ml-agents/mlagents/trainers/torch_entities/model_serialization.py:144-152](repo://ml-agents/mlagents/trainers/torch_entities/model_serialization.py#L144-L152)

| Name | Present when | Contents |
| --- | --- | --- |
| `obs_0`, `obs_1`, ... | always | observations in sensor order |
| `action_masks` | always | 1 for allowed discrete actions |
| `recurrent_in` | always | memory from the previous step |
| `version_number` | always | model API version (3) |
| `memory_size` | always | memory size, 0 without memory |
| `continuous_actions`, `continuous_action_output_shape`, `deterministic_continuous_actions` | continuous actions | sampled actions, action count, mean actions |
| `discrete_actions`, `discrete_action_output_shape`, `deterministic_discrete_actions` | discrete actions | sampled actions, branch sizes, most likely actions |
| `recurrent_out` | memory | memory for the next step |

Sources: [ml-agents/mlagents/trainers/torch_entities/model_serialization.py:44-84](repo://ml-agents/mlagents/trainers/torch_entities/model_serialization.py#L44-L84), [ml-agents/mlagents/trainers/torch_entities/model_serialization.py:115-142](repo://ml-agents/mlagents/trainers/torch_entities/model_serialization.py#L115-L142)

These names are the contract with Unity: the C# `TensorNames` class lists the same strings, and the Unity side reads the metadata outputs to learn the version, memory size and action sizes ([[Inference with Sentis]]).

Sources: [com.unity.ml-agents/Runtime/Inference/TensorNames.cs:6-49](repo://com.unity.ml-agents/Runtime/Inference/TensorNames.cs#L6-L49)

### What gets traced

`export_policy_model` runs `torch.onnx.export` on the policy's actor with opset 9 (`SerializationSettings.onnx_opset`). The actor's `forward` exists for this purpose: it runs the network body and the action model's `get_action_out`, and returns the metadata parameters and action tensors in the order of the output names. Metadata such as `version_number` are stored as non-trainable parameters so they become constant outputs of the graph.

Sources: [ml-agents/mlagents/trainers/torch_entities/model_serialization.py:154-173](repo://ml-agents/mlagents/trainers/torch_entities/model_serialization.py#L154-L173), [ml-agents/mlagents/trainers/torch_entities/networks.py:571-611](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L571-L611), [ml-agents/mlagents/trainers/torch_entities/networks.py:670-709](repo://ml-agents/mlagents/trainers/torch_entities/networks.py#L670-L709)

`get_action_out` computes the distributions and exports a sample from each as the action output and the deterministic sample (mean or most likely class) as the deterministic output. When the action model clips actions, continuous outputs are clamped to `[-3, 3]` and divided by 3 inside the graph.

Sources: [ml-agents/mlagents/trainers/torch_entities/action_model.py:166-217](repo://ml-agents/mlagents/trainers/torch_entities/action_model.py#L166-L217)

### Export-only code paths

`exporting_to_onnx` is a context manager that sets a thread-local flag for the duration of the export and holds a global lock, so only one thread exports at a time. Modules check `exporting_to_onnx.is_exporting()` where ONNX or Sentis need something different from training: the LSTM transposes memories to sequence-first and back, and attention modules refuse to export without a fixed maximum number of entities.

Sources: [ml-agents/mlagents/trainers/torch_entities/model_serialization.py:12-41](repo://ml-agents/mlagents/trainers/torch_entities/model_serialization.py#L12-L41), [ml-agents/mlagents/trainers/torch_entities/layers.py:204-225](repo://ml-agents/mlagents/trainers/torch_entities/layers.py#L204-L225), [ml-agents/mlagents/trainers/torch_entities/attention.py:154-163](repo://ml-agents/mlagents/trainers/torch_entities/attention.py#L154-L163)

## Sharing models

`mlagents-push-to-hf` uploads a results folder with its ONNX model to the Hugging Face Hub and `mlagents-load-from-hf` downloads one; see [[Hugging Face Integration]].

Sources: [ml-agents/setup.py:78-85](repo://ml-agents/setup.py#L78-L85)
