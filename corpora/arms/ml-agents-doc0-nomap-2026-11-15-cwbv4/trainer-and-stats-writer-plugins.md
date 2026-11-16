---
title: "Trainer and Stats Writer Plugins"
---
## Overview

`mlagents-learn` can be extended with new training algorithms and new places to send training metrics without changing the `mlagents` package. Both extension points use Python package entry points: an installed package declares a function under the group `mlagents.trainer_type` or `mlagents.stats_writer`, and `mlagents-learn` calls every such function at start-up. The built-in PPO, SAC and POCA trainers and the default stats writers are registered the same way, through entry points in `mlagents`'s own `setup.py`.

Sources: [ml-agents/mlagents/plugins/__init__.py:1-8](repo://ml-agents/mlagents/plugins/__init__.py#L1-L8), [ml-agents/setup.py:79-92](repo://ml-agents/setup.py#L79-L92)

The repository contains two example plugin packages: `ml-agents-trainer-plugin` adds A2C and DQN trainers, and `ml-agents-plugin-examples` adds a stats writer that prints to the console.

Sources: [ml-agents-trainer-plugin/setup.py:1-18](repo://ml-agents-trainer-plugin/setup.py#L1-L18), [ml-agents-plugin-examples/setup.py:1-17](repo://ml-agents-plugin-examples/setup.py#L1-L17)

## Trainer plugins

### The registration function

A trainer plugin's entry point names a function that takes no arguments and returns two dictionaries keyed by the trainer type string: one mapping it to the trainer class and one mapping it to the hyperparameter settings class. The built-in function, `get_default_trainer_types`, returns PPO, SAC and POCA this way.

Sources: [ml-agents/mlagents/plugins/trainer_type.py:17-38](repo://ml-agents/mlagents/plugins/trainer_type.py#L17-L38)

```python
def get_type_and_setting():
    return {A2CTrainer.get_trainer_name(): A2CTrainer}, {
        A2CTrainer.get_trainer_name(): A2CSettings
    }
```

Sources: [ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_trainer.py:210-213](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_trainer.py#L210-L213)

### Discovery

`register_trainer_plugins` loads every `mlagents.trainer_type` entry point and merges the returned dictionaries into the module-level `all_trainer_types` and `all_trainer_settings`. Any exception raised by a plugin, including `BaseException`, is logged and that plugin is skipped. If no entry points exist at all (a broken installation), it warns and registers only the defaults. `mlagents-learn` and `mlagents-run-experiment` call it before parsing the configuration.

Sources: [ml-agents/mlagents/plugins/trainer_type.py:41-72](repo://ml-agents/mlagents/plugins/trainer_type.py#L41-L72), [ml-agents/mlagents/trainers/learn.py:51-56](repo://ml-agents/mlagents/trainers/learn.py#L51-L56), [ml-agents/mlagents/trainers/run_experiment.py:18-27](repo://ml-agents/mlagents/trainers/run_experiment.py#L18-L27)

### What the registries are used for

Two parts of the training code read the registries. When the YAML is structured, `trainer_type` must be a registered type, and the `hyperparameters` block is checked against that type's settings class, so a plugin's own fields (such as DQN's `exploration_initial_eps`) are validated like built-in ones. When a behavior first appears, `TrainerFactory` instantiates the registered trainer class with the behavior name, reward buffer length, settings, flags, seed and artifact path.

Sources: [ml-agents/mlagents/trainers/settings.py:614-725](repo://ml-agents/mlagents/trainers/settings.py#L614-L725), [ml-agents/mlagents/trainers/trainer/trainer_factory.py:97-119](repo://ml-agents/mlagents/trainers/trainer/trainer_factory.py#L97-L119)

A plugin trainer therefore needs a settings class (usually derived from `OnPolicyHyperparamSettings` or `OffPolicyHyperparamSettings`), a trainer class with that constructor signature (usually derived from `OnPolicyTrainer` or `OffPolicyTrainer`), and an optimizer derived from `TorchOptimizer`. [[Trainer Architecture]] describes what the base classes already provide.

Sources: [ml-agents/mlagents/trainers/settings.py:156-176](repo://ml-agents/mlagents/trainers/settings.py#L156-L176), [ml-agents/mlagents/trainers/trainer/on_policy_trainer.py:21-57](repo://ml-agents/mlagents/trainers/trainer/on_policy_trainer.py#L21-L57)

## Example: A2C

`A2CTrainer` is an `OnPolicyTrainer`. Its `A2CSettings` adds `beta`, `lambd`, `shared_critic` and linear schedules, and validates that `num_epoch` is exactly 1, since A2C makes a single pass over its data. It processes trajectories like PPO (GAE advantages, returns per reward signal) and builds the same kind of policy.

Sources: [ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_optimizer.py:24-38](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_optimizer.py#L24-L38), [ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_trainer.py:66-163](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_trainer.py#L66-L163), [ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_trainer.py:173-199](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_trainer.py#L173-L199)

`A2COptimizer.update` uses the unclipped actor-critic loss: `-mean(sum(log_prob) * advantage) + 0.5 * value_loss - beta * mean(entropy)`, with a plain squared-error value loss per reward signal.

Sources: [ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_optimizer.py:139-183](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_optimizer.py#L139-L183)

## Example: DQN

`DQNTrainer` is an `OffPolicyTrainer`, so it inherits the replay buffer and update cadence. `DQNSettings` adds `gamma`, an exploration schedule from `exploration_initial_eps` to `exploration_final_eps`, `tau` and a target update interval. Its policy's actor is a `QNetwork` that serves as both actor and critic, with one head per reward signal and one output per discrete action, choosing a random action with probability epsilon.

Sources: [ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_optimizer.py:25-39](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_optimizer.py#L25-L39), [ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_trainer.py:121-162](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_trainer.py#L121-L162), [ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_optimizer.py:174-190](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_optimizer.py#L174-L190)

Each update sets the decayed exploration rate on the actor, computes target Q values from a target network with the reward signal's gamma (masked by `done` for signals that do not ignore it), minimizes the smooth L1 loss between the Q value of the taken action and the target, soft-updates the target network with `tau`, and updates the reward signals.

Sources: [ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_optimizer.py:98-166](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_optimizer.py#L98-L166)

## Running the examples

Each example folder ships a configuration: `a2c_3DBall.yaml` trains 3DBall with `trainer_type: a2c` and `dqn_basic.yaml` trains Basic with `trainer_type: dqn`. After installing the plugin package (for example `pip install -e ./ml-agents-trainer-plugin`), these are passed to `mlagents-learn` like any other configuration.

Sources: [ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_3DBall.yaml:1-24](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/a2c/a2c_3DBall.yaml#L1-L24), [ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_basic.yaml:1-27](repo://ml-agents-trainer-plugin/mlagents_trainer_plugin/dqn/dqn_basic.yaml#L1-L27)

## Stats writer plugins

A stats writer plugin's entry point names a function that takes the run's `RunOptions` and returns a list of `StatsWriter` instances. `register_stats_writer_plugins` calls every such function and collects the writers, skipping (and logging) plugins that raise; `run_training` adds them all to the `StatsReporter`. The default plugin returns the TensorBoard, gauge and console writers ([[Stats and TensorBoard]]).

Sources: [ml-agents/mlagents/plugins/stats_writer.py:13-63](repo://ml-agents/mlagents/plugins/stats_writer.py#L13-L63), [ml-agents/mlagents/trainers/learn.py:92-95](repo://ml-agents/mlagents/trainers/learn.py#L92-L95)

A writer subclasses `StatsWriter` and must implement `write_stats(category, values, step)`, which receives a `StatsSummary` per key at each summary step. It can also override `on_add_stat` to see each value as it is reported and `add_property` to receive hyperparameters.

Sources: [ml-agents/mlagents/trainers/stats.py:79-128](repo://ml-agents/mlagents/trainers/stats.py#L79-L128)

The example plugin is the minimal case:

Sources: [ml-agents-plugin-examples/mlagents_plugin_examples/example_stats_writer.py:1-27](repo://ml-agents-plugin-examples/mlagents_plugin_examples/example_stats_writer.py#L1-L27)

```python
class ExampleStatsWriter(StatsWriter):
    """
    Example implementation of the StatsWriter abstract class.
    This doesn't do anything interesting, just prints the stats that it gets.
    """

    def write_stats(
        self, category: str, values: Dict[str, StatsSummary], step: int
    ) -> None:
        print(f"ExampleStatsWriter category: {category} values: {values}")
```

Sources: [ml-agents-plugin-examples/mlagents_plugin_examples/example_stats_writer.py:6-15](repo://ml-agents-plugin-examples/mlagents_plugin_examples/example_stats_writer.py#L6-L15)

It is registered in its package's `setup.py` under `ML_AGENTS_STATS_WRITER` as `example=mlagents_plugin_examples.example_stats_writer:get_example_stats_writer`.

Sources: [ml-agents-plugin-examples/setup.py:1-17](repo://ml-agents-plugin-examples/setup.py#L1-L17)
