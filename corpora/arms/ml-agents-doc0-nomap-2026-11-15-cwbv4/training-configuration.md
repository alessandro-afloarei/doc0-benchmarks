---
title: "Training Configuration"
---
## Overview

A training run is described by one `RunOptions` object, defined with `attrs` classes in `mlagents/trainers/settings.py` and filled from the YAML file and the command line by `cattrs`. The YAML file mirrors the class tree: top-level keys are `RunOptions` fields, `behaviors` maps behavior names to `TrainerSettings`, and so on down. Because the schema is the class tree, an unknown key anywhere is an error rather than being silently ignored, and the resolved object can be written back out as `configuration.yaml`. How the YAML and the flags are merged is on [[mlagents-learn CLI and Run Lifecycle]].

Sources: [ml-agents/mlagents/trainers/settings.py:857-891](repo://ml-agents/mlagents/trainers/settings.py#L857-L891), [ml-agents/mlagents/trainers/settings.py:38-68](repo://ml-agents/mlagents/trainers/settings.py#L38-L68)

## Top-level structure

| Key | Type | Purpose |
| --- | --- | --- |
| `behaviors` | name to `TrainerSettings` | One trainer configuration per behavior name |
| `default_settings` | `TrainerSettings` | Base settings merged under every behavior |
| `env_settings` | `EnvironmentSettings` | `env_path`, `env_args`, `base_port`, `num_envs`, `num_areas`, `timeout_wait`, `seed`, restart limits |
| `engine_settings` | `EngineSettings` | `width`, `height`, `quality_level`, `time_scale`, `target_frame_rate`, `capture_frame_rate`, `no_graphics`, `no_graphics_monitor` |
| `checkpoint_settings` | `CheckpointSettings` | `run_id`, `initialize_from`, `resume`, `force`, `inference`, `results_dir` |
| `torch_settings` | `TorchSettings` | `device` |
| `environment_parameters` | name to parameter settings | Constants, samplers and curricula sent to Unity |
| `debug` | bool | Debug logging |

Sources: [ml-agents/mlagents/trainers/settings.py:759-870](repo://ml-agents/mlagents/trainers/settings.py#L759-L870)

The defaults of the non-behavior settings come from the argparse parser itself (`parser.get_default(...)`), so the CLI and the YAML cannot disagree on a default. `num_envs` above 1 without `env_path`, and `num_areas` below 1, fail validation.

Sources: [ml-agents/mlagents/trainers/settings.py:813-853](repo://ml-agents/mlagents/trainers/settings.py#L813-L853)

## TrainerSettings

| Field | Default | Meaning |
| --- | --- | --- |
| `trainer_type` | `ppo` | Any registered trainer type: `ppo`, `sac`, `poca`, or a plugin's |
| `hyperparameters` | the trainer type's settings class | Algorithm hyperparameters |
| `network_settings` | `NetworkSettings()` | Policy network architecture |
| `reward_signals` | `extrinsic` only | Reward signals and their settings |
| `max_steps` | 500000 | Steps after which this behavior stops training |
| `time_horizon` | 64 | Steps collected per agent before a trajectory is sent to the trainer |
| `summary_freq` | 50000 | Steps between summary writes |
| `checkpoint_interval` | 500000 | Steps between checkpoints |
| `keep_checkpoints` | 5 | Checkpoints to keep on disk |
| `even_checkpoints` | false | Space checkpoints evenly: `checkpoint_interval = max_steps / keep_checkpoints` |
| `init_path` | none | Checkpoint to initialize from |
| `threaded` | false | Run this trainer's updates in its own thread |
| `self_play` | none | Self-play settings |
| `behavioral_cloning` | none | Behavioral cloning settings |

Sources: [ml-agents/mlagents/trainers/settings.py:614-662](repo://ml-agents/mlagents/trainers/settings.py#L614-L662)

`TrainerSettings.structure` is a custom hook. It starts from `default_settings` when one was given and deep-merges the behavior's own dictionary on top, so a behavior only needs the fields that differ. It drops the deprecated `framework` key with a warning, converts `max_steps` through `float` so `5.0e5` is accepted, rejects unknown trainer types, and requires `trainer_type` whenever `hyperparameters` are given, because the trainer type picks the hyperparameter class.

Sources: [ml-agents/mlagents/trainers/settings.py:670-725](repo://ml-agents/mlagents/trainers/settings.py#L670-L725), [ml-agents/mlagents/trainers/settings.py:75-83](repo://ml-agents/mlagents/trainers/settings.py#L75-L83)

`behaviors` is a `DefaultTrainerDict`. When the trainer asks for a behavior that is not in the file, it returns a copy of `default_settings` if there is one, raises `TrainerConfigError` if a config file was given, or logs a warning and uses plain defaults if not.

Sources: [ml-agents/mlagents/trainers/settings.py:727-756](repo://ml-agents/mlagents/trainers/settings.py#L727-L756)

## Hyperparameters

Hyperparameter classes form a small hierarchy. Each trainer type registers its own class through the plugin system; `all_trainer_settings[trainer_type]` is what `TrainerSettings` instantiates.

Sources: [ml-agents/mlagents/trainers/settings.py:156-176](repo://ml-agents/mlagents/trainers/settings.py#L156-L176), [ml-agents/mlagents/plugins/trainer_type.py:17-38](repo://ml-agents/mlagents/plugins/trainer_type.py#L17-L38)

| Class | Fields and defaults |
| --- | --- |
| `HyperparamSettings` | `batch_size` 1024, `buffer_size` 10240, `learning_rate` 3e-4, `learning_rate_schedule` constant |
| `OnPolicyHyperparamSettings` | adds `num_epoch` 3 |
| `PPOSettings` | `beta` 5e-3, `epsilon` 0.2, `lambd` 0.95, `shared_critic` false, `learning_rate_schedule`, `beta_schedule`, `epsilon_schedule` linear |
| `POCASettings` | same as PPO without `shared_critic` |
| `OffPolicyHyperparamSettings` | `batch_size` 128, `buffer_size` 50000, `buffer_init_steps` 0, `steps_per_update` 1, `save_replay_buffer` false, `reward_signal_steps_per_update` 4 |
| `SACSettings` | adds `tau` 0.005, `init_entcoef` 1.0; `reward_signal_steps_per_update` defaults to `steps_per_update` |

Sources: [ml-agents/mlagents/trainers/settings.py:156-176](repo://ml-agents/mlagents/trainers/settings.py#L156-L176), [ml-agents/mlagents/trainers/ppo/optimizer_torch.py:24-32](repo://ml-agents/mlagents/trainers/ppo/optimizer_torch.py#L24-L32), [ml-agents/mlagents/trainers/poca/optimizer_torch.py:43-50](repo://ml-agents/mlagents/trainers/poca/optimizer_torch.py#L43-L50), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:29-41](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L29-L41)

For PPO and POCA, if `learning_rate_schedule` is given but `beta_schedule` or `epsilon_schedule` is not, those follow the learning-rate schedule. Schedules are `constant` or `linear` (decaying to a floor over `max_steps`; see [[PPO Trainer]]).

Sources: [ml-agents/mlagents/trainers/settings.py:48-58](repo://ml-agents/mlagents/trainers/settings.py#L48-L58), [ml-agents/mlagents/trainers/settings.py:105-109](repo://ml-agents/mlagents/trainers/settings.py#L105-L109)

The SAC configuration for 3DBall shows the off-policy fields in use:

Sources: [config/sac/3DBall.yaml:1-27](repo://config/sac/3DBall.yaml#L1-L27)

```yaml
behaviors:
  3DBall:
    trainer_type: sac
    hyperparameters:
      learning_rate: 0.0003
      learning_rate_schedule: constant
      batch_size: 64
      buffer_size: 200000
      buffer_init_steps: 0
      tau: 0.005
      steps_per_update: 10.0
      save_replay_buffer: false
      init_entcoef: 0.5
      reward_signal_steps_per_update: 10.0
```

Sources: [config/sac/3DBall.yaml:1-14](repo://config/sac/3DBall.yaml#L1-L14)

## Network settings

| Field | Default | Meaning |
| --- | --- | --- |
| `normalize` | false | Running normalization of vector observations |
| `hidden_units` | 128 | Width of hidden layers |
| `num_layers` | 2 | Number of hidden layers |
| `vis_encode_type` | `simple` | Visual encoder: `simple`, `nature_cnn`, `resnet`, `match3`, `fully_connected` |
| `memory` | none | Adds an LSTM: `sequence_length` (64) and `memory_size` (128, must be positive and even) |
| `goal_conditioning_type` | `hyper` | How goal-signal observations condition the network: `hyper` or `none` |
| `deterministic` | false | Use the most likely action when acting |

Sources: [ml-agents/mlagents/trainers/settings.py:97-141](repo://ml-agents/mlagents/trainers/settings.py#L97-L141)

With `memory`, `sequence_length` may not exceed `batch_size`. [[Policies and Network Architecture]] and [[Observation Encoders and Attention]] describe how these settings shape the network.

Sources: [ml-agents/mlagents/trainers/settings.py:648-657](repo://ml-agents/mlagents/trainers/settings.py#L648-L657)

## Reward signals

`reward_signals` maps a `RewardSignalType` (`extrinsic`, `gail`, `curiosity`, `rnd`) to its settings. Every signal has `gamma` (0.99), `strength` (1.0) and its own `network_settings`. GAIL adds `learning_rate`, `use_actions`, `use_vail` and a required `demo_path`; curiosity and RND add `learning_rate` (3e-4 and 1e-4). The deprecated `encoding_size` still works with a warning and sets the signal network's `hidden_units` when no `network_settings` are given. The signals themselves are on [[Reward Signals]].

Sources: [ml-agents/mlagents/trainers/settings.py:179-250](repo://ml-agents/mlagents/trainers/settings.py#L179-L250)

## Behavioral cloning and self-play

`behavioral_cloning` takes a required `demo_path`, plus `steps` (0: keep cloning for the whole run), `strength` (1.0), `samples_per_update` (0: use the whole demonstration buffer), and optional `num_epoch` and `batch_size` that default to the trainer's own. See [[Demonstrations and Imitation Learning]].

Sources: [ml-agents/mlagents/trainers/settings.py:144-153](repo://ml-agents/mlagents/trainers/settings.py#L144-L153)

`self_play` takes `save_steps` (20000), `team_change` (5 times `save_steps` by default), `swap_steps` (2000), `window` (10), `play_against_latest_model_ratio` (0.5) and `initial_elo` (1200). See [[Self-Play]].

Sources: [ml-agents/mlagents/trainers/settings.py:598-611](repo://ml-agents/mlagents/trainers/settings.py#L598-L611)

## Environment parameters

Each entry under `environment_parameters` is one of three forms, all normalized into an `EnvironmentParameterSettings` holding a list of lessons:

Sources: [ml-agents/mlagents/trainers/settings.py:530-594](repo://ml-agents/mlagents/trainers/settings.py#L530-L594)

| Form | YAML | Result |
| --- | --- | --- |
| Constant | `gravity: 9.81` | One lesson with a `ConstantSettings` |
| Sampler | `sampler_type` and `sampler_parameters` | One lesson with `UniformSettings` (`min_value`, `max_value`), `GaussianSettings` (`mean`, `st_dev`) or `MultiRangeUniformSettings` (`intervals`) |
| Curriculum | `curriculum:` list of lessons | Lessons with `name`, `value` (constant or sampler) and `completion_criteria` |

Sources: [ml-agents/mlagents/trainers/settings.py:253-306](repo://ml-agents/mlagents/trainers/settings.py#L253-L306), [ml-agents/mlagents/trainers/settings.py:338-417](repo://ml-agents/mlagents/trainers/settings.py#L338-L417), [ml-agents/mlagents/trainers/settings.py:516-528](repo://ml-agents/mlagents/trainers/settings.py#L516-L528)

Sampler settings validate their ranges (minimum above maximum is an error, each interval needs two values) and carry a seed. Every non-final lesson must have `completion_criteria`; one on the final lesson is ignored with a warning. Completion criteria and how lessons advance are on [[Curriculum and Environment Parameters]].

Sources: [ml-agents/mlagents/trainers/settings.py:358-451](repo://ml-agents/mlagents/trainers/settings.py#L358-L451), [ml-agents/mlagents/trainers/settings.py:540-556](repo://ml-agents/mlagents/trainers/settings.py#L540-L556)

## How validation works

`strict_to_cls` is the structure hook for most classes: it checks that every key is a field of the target class (raising `TrainerConfigError` naming the bad key and class) and structures each value with that field's type. `RunOptions` registers it and the custom hooks for trainer settings, reward signals, samplers and environment parameters, and the reverse hooks so `as_dict()` produces YAML-ready dictionaries.

Sources: [ml-agents/mlagents/trainers/settings.py:38-68](repo://ml-agents/mlagents/trainers/settings.py#L38-L68), [ml-agents/mlagents/trainers/settings.py:872-891](repo://ml-agents/mlagents/trainers/settings.py#L872-L891)

`SerializationSettings` holds two class-level switches used at export time: `convert_to_onnx` (true) and `onnx_opset` (9).

Sources: [ml-agents/mlagents/trainers/settings.py:86-88](repo://ml-agents/mlagents/trainers/settings.py#L86-L88)

## Upgrading old configuration files

`mlagents/trainers/upgrade_config.py` converts configurations from before the `behaviors` format, run as `python -m mlagents.trainers.upgrade_config <old.yaml> <new.yaml>` with optional `--curriculum` and `--sampler` files. For files up to 0.16 it splits each flat behavior entry (merged with the old `default` entry) into `trainer_type`, `hyperparameters`, `network_settings` (turning `use_recurrent` into a `memory` block) and the remaining trainer fields. For 0.17 and 0.18 files it folds separate `curriculum` and `parameter_randomization` sections into `environment_parameters`. `None` values are removed before writing.

Sources: [ml-agents/mlagents/trainers/upgrade_config.py:1-66](repo://ml-agents/mlagents/trainers/upgrade_config.py#L1-L66), [ml-agents/mlagents/trainers/upgrade_config.py:162-251](repo://ml-agents/mlagents/trainers/upgrade_config.py#L162-L251)
