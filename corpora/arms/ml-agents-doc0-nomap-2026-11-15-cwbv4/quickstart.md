---
title: "Quickstart"
---
## Overview

This page takes you from a clone of the repository to a trained 3DBall model running in Unity. You install the two Python packages and the Unity package from the repository, start `mlagents-learn` with a configuration from `config/`, press Play in the Editor, and pick up the `.onnx` file it writes. The flags used here are explained in [[mlagents-learn CLI and Run Lifecycle]] and the YAML fields in [[Training Configuration]].

Sources: [ml-agents/setup.py:79-92](repo://ml-agents/setup.py#L79-L92), [config/ppo/3DBall.yaml:1-25](repo://config/ppo/3DBall.yaml#L1-L25)

## Requirements

| Component | Requirement |
| --- | --- |
| Python | `>=3.10.1,<=3.10.12` for both `mlagents` and `mlagents_envs` |
| PyTorch | `torch>=2.1.1` (installed as a dependency of `mlagents`) |
| Unity | Unity `6000.0` or later for `com.unity.ml-agents` 3.0.0 |
| Inference | `com.unity.ai.inference` 2.2.1, pulled in by the Unity package |

Sources: [ml-agents/setup.py:55-77](repo://ml-agents/setup.py#L55-L77), [ml-agents-envs/setup.py:55-66](repo://ml-agents-envs/setup.py#L55-L66), [com.unity.ml-agents/package.json:1-13](repo://com.unity.ml-agents/package.json#L1-L13)

## Install

Install the environment API first, then the trainer. `mlagents` requires `mlagents_envs` at exactly its own version, so install both from the same checkout. Use `pip install -e` on the same folders if you plan to change the Python code.

Sources: [ml-agents/setup.py:55-60](repo://ml-agents/setup.py#L55-L60)

```bash
python -m pip install ./ml-agents-envs
python -m pip install ./ml-agents
```

Sources: [ml-agents-envs/setup.py:36-69](repo://ml-agents-envs/setup.py#L36-L69), [ml-agents/setup.py:39-60](repo://ml-agents/setup.py#L39-L60)

In Unity, open the `Project` folder of the repository: its example scenes use the local `com.unity.ml-agents` package. For your own project, add the package from disk with the Package Manager and point it at `com.unity.ml-agents/package.json`. Check the Python install with `mlagents-learn --help`; the command comes from the `console_scripts` entry point `mlagents.trainers.learn:main`.

Sources: [com.unity.ml-agents/package.json:1-13](repo://com.unity.ml-agents/package.json#L1-L13), [ml-agents/setup.py:78-85](repo://ml-agents/setup.py#L78-L85)

## Train 3DBall in the Editor

The `config/ppo/3DBall.yaml` file trains the `3DBall` behavior with PPO for 500,000 steps, a 2-layer 128-unit network with input normalization, and only the extrinsic reward.

Sources: [config/ppo/3DBall.yaml:1-25](repo://config/ppo/3DBall.yaml#L1-L25)

```yaml
behaviors:
  3DBall:
    trainer_type: ppo
    hyperparameters:
      batch_size: 64
      buffer_size: 12000
      learning_rate: 0.0003
      beta: 0.001
      epsilon: 0.2
      lambd: 0.99
      num_epoch: 3
      learning_rate_schedule: linear
    network_settings:
      normalize: true
      hidden_units: 128
      num_layers: 2
      vis_encode_type: simple
    reward_signals:
      extrinsic:
        gamma: 0.99
        strength: 1.0
    keep_checkpoints: 5
    max_steps: 500000
    time_horizon: 1000
    summary_freq: 12000
```

Sources: [config/ppo/3DBall.yaml:1-25](repo://config/ppo/3DBall.yaml#L1-L25)

Start the trainer from the repository root, naming the run with `--run-id`.

Sources: [ml-agents/mlagents/trainers/cli_utils.py:111-120](repo://ml-agents/mlagents/trainers/cli_utils.py#L111-L120)

```bash
mlagents-learn config/ppo/3DBall.yaml --run-id=first3DBall
```

Sources: [ml-agents/mlagents/trainers/learn.py:269-270](repo://ml-agents/mlagents/trainers/learn.py#L269-L270)

Without `--env`, `UnityEnvironment` launches nothing: it listens on the Editor port 5004 and logs "Start training by pressing the Play button in the Unity Editor." Open the 3DBall scene and press Play. When the Academy starts, it connects to that port, exchanges the version handshake and begins stepping under the trainer's control.

Sources: [ml-agents-envs/mlagents_envs/environment.py:70-80](repo://ml-agents-envs/mlagents_envs/environment.py#L70-L80), [ml-agents-envs/mlagents_envs/environment.py:176-226](repo://ml-agents-envs/mlagents_envs/environment.py#L176-L226), [ml-agents/mlagents/trainers/learn.py:97-109](repo://ml-agents/mlagents/trainers/learn.py#L97-L109)

> [!NOTE]
> Communication between Unity and Python is an open socket without authentication. Train on a network you trust.

Sources: [ml-agents-envs/mlagents_envs/environment.py:159-172](repo://ml-agents-envs/mlagents_envs/environment.py#L159-L172)

## Train against a built executable

To train faster, build the scene as a standalone player and pass it with `--env`. Each of `--num-envs` workers launches its own copy on port `--base-port + worker_id` (default base 5005). `--no-graphics` skips the graphics driver when the agents use no visual observations, and `--time-scale` (default 20) speeds up the simulation.

Sources: [ml-agents/mlagents/trainers/cli_utils.py:153-171](repo://ml-agents/mlagents/trainers/cli_utils.py#L153-L171), [ml-agents/mlagents/trainers/cli_utils.py:268-298](repo://ml-agents/mlagents/trainers/cli_utils.py#L268-L298)

```bash
mlagents-learn config/ppo/3DBall.yaml --env=builds/3DBall --num-envs=4 --no-graphics --run-id=3DBallExe
```

Sources: [ml-agents/mlagents/trainers/cli_utils.py:70-76](repo://ml-agents/mlagents/trainers/cli_utils.py#L70-L76)

## What the run writes

Every run writes to `<results-dir>/<run-id>`, with `results` as the default results directory. Starting a run whose folder already exists fails unless you pass `--resume` (continue it) or `--force` (overwrite it); `--resume` on a missing folder fails too.

Sources: [ml-agents/mlagents/trainers/settings.py:768-784](repo://ml-agents/mlagents/trainers/settings.py#L768-L784), [ml-agents/mlagents/trainers/directory_utils.py:7-45](repo://ml-agents/mlagents/trainers/directory_utils.py#L7-L45), [ml-agents/mlagents/trainers/cli_utils.py:229-234](repo://ml-agents/mlagents/trainers/cli_utils.py#L229-L234)

| Path | Written by | Contents |
| --- | --- | --- |
| `results/<run-id>/<behavior>/<behavior>-<step>.pt` and `.onnx` | each checkpoint | PyTorch state and the ONNX export at that step |
| `results/<run-id>/<behavior>/checkpoint.pt` | each checkpoint | the latest state, used by `--resume` and `--initialize-from` |
| `results/<run-id>/<behavior>.onnx` | end of training | copy of the final model |
| `results/<run-id>/configuration.yaml` | exit | the full resolved `RunOptions` |
| `results/<run-id>/run_logs/timers.json` | exit | profiling tree |
| `results/<run-id>/run_logs/training_status.json` | exit | checkpoint list and lesson state for resuming |
| `results/<run-id>/<behavior>/events.out.tfevents.*` | during training | TensorBoard summaries |

Sources: [ml-agents/mlagents/trainers/model_saver/torch_model_saver.py:49-61](repo://ml-agents/mlagents/trainers/model_saver/torch_model_saver.py#L49-L61), [ml-agents/mlagents/trainers/model_saver/torch_model_saver.py:139-153](repo://ml-agents/mlagents/trainers/model_saver/torch_model_saver.py#L139-L153), [ml-agents/mlagents/trainers/trainer/trainer_factory.py:97-97](repo://ml-agents/mlagents/trainers/trainer/trainer_factory.py#L97-L97), [ml-agents/mlagents/trainers/learn.py:136-172](repo://ml-agents/mlagents/trainers/learn.py#L136-L172), [ml-agents/mlagents/plugins/stats_writer.py:13-29](repo://ml-agents/mlagents/plugins/stats_writer.py#L13-L29)

## Watch training and use the model

Run `tensorboard --logdir results` to follow the curves: the default stats writers are a `TensorboardWriter` rooted at the run folder, a `GaugeWriter` and a `ConsoleWriter` that prints the mean reward every `summary_freq` steps. [[Stats and TensorBoard]] lists the metrics.

Sources: [ml-agents/mlagents/plugins/stats_writer.py:13-29](repo://ml-agents/mlagents/plugins/stats_writer.py#L13-L29)

Pressing Ctrl+C stops training cleanly: `TrainerController.start_learning` catches `KeyboardInterrupt`, joins the trainer threads and still saves every model in its `finally` block. To run the model in Unity, copy `results/<run-id>/3DBall.onnx` into the project and assign it to the agent's Behavior Parameters `Model` field; [[Behavior Parameters and Policies]] explains when a model is used and [[Inference with Sentis]] how it runs.

Sources: [ml-agents/mlagents/trainers/trainer_controller.py:167-200](repo://ml-agents/mlagents/trainers/trainer_controller.py#L167-L200), [ml-agents/mlagents/trainers/trainer/rl_trainer.py:159-178](repo://ml-agents/mlagents/trainers/trainer/rl_trainer.py#L159-L178)

## Where to go next

[[Example Environments]] lists the other scenes and the configurations that train them, [[Agents and Episodes]] shows how to write your own agent, and [[Low-Level Python API (UnityEnvironment)]] drives an environment from your own Python code instead of `mlagents-learn`.

Sources: [ml-agents-envs/mlagents_envs/environment.py:55-68](repo://ml-agents-envs/mlagents_envs/environment.py#L55-L68)
