---
title: "Stats and TensorBoard"
---
## Overview

Every number that shows up in TensorBoard or in the console during training goes through one class, `StatsReporter`. Trainers, optimizers, the agent processor and the Unity scene all report values to it under a category (the behavior name) and a key (such as `Environment/Cumulative Reward`). The reporter accumulates them, and at each summary step hands a summary of everything collected since the last one to a list of `StatsWriter`s, which write TensorBoard events, console lines and timer gauges. Writers are plugins, so a project can add its own destination.

Sources: [ml-agents/mlagents/trainers/stats.py:289-393](repo://ml-agents/mlagents/trainers/stats.py#L289-L393), [ml-agents/mlagents/trainers/stats.py:79-128](repo://ml-agents/mlagents/trainers/stats.py#L79-L128)

## StatsReporter

`StatsReporter` instances are lightweight handles carrying a category; the data is class-level, shared by all instances and guarded by an `RLock`, so threaded trainers can report safely. Each `Trainer` creates one for its behavior name.

Sources: [ml-agents/mlagents/trainers/stats.py:289-309](repo://ml-agents/mlagents/trainers/stats.py#L289-L309), [ml-agents/mlagents/trainers/trainer/trainer.py:39-45](repo://ml-agents/mlagents/trainers/trainer/trainer.py#L39-L45)

| Method | Effect |
| --- | --- |
| `add_writer(writer)` | Register a writer for all categories (static) |
| `add_stat(key, value, aggregation)` | Append a value and remember the key's aggregation method; notify writers' `on_add_stat` |
| `set_stat(key, value)` | Replace the key's values with this one and mark it `MOST_RECENT` |
| `add_property(type, value)` | Pass a property (hyperparameters, self-play flag) to every writer |
| `write_stats(step)` | Summarize every key with values, call every writer's `write_stats`, then clear the category |
| `get_stats_summaries(key)` | A `StatsSummary` of the key's values since the last write |

Sources: [ml-agents/mlagents/trainers/stats.py:306-393](repo://ml-agents/mlagents/trainers/stats.py#L306-L393)

`StatsSummary` keeps the full list of values and the aggregation method. Its `aggregated_value` is the sum for `SUM` and the mean otherwise; `mean`, `std`, `num` and `sum` are also available.

Sources: [ml-agents/mlagents/trainers/stats.py:42-71](repo://ml-agents/mlagents/trainers/stats.py#L42-L71)

## When stats are written

Trainers call `write_stats` from `_write_summary`, triggered when a processed trajectory pushes the step count past the next multiple of `summary_freq`. Just before writing, the trainer adds an `Is Training` stat, and every step it sets `Step`. So every TensorBoard point for a behavior is the aggregate of everything reported in the preceding `summary_freq` steps.

Sources: [ml-agents/mlagents/trainers/trainer/rl_trainer.py:188-236](repo://ml-agents/mlagents/trainers/trainer/rl_trainer.py#L188-L236)

## Built-in writers

### Default writer set

The default plugin, `get_default_stats_writers`, returns three writers.

Sources: [ml-agents/mlagents/plugins/stats_writer.py:13-29](repo://ml-agents/mlagents/plugins/stats_writer.py#L13-L29)

### TensorboardWriter

Writes to `results/<run-id>/<category>/` with one `SummaryWriter` per category, created on first use. Each key becomes a scalar of its aggregated value; `HISTOGRAM` keys additionally get a `<key>_hist` histogram of all values. The `Hyperparameters` property is written once as text. Keys listed in `hidden_keys` are skipped: the default writer hides `Is Training` and `Step`. Unless resuming, old `events.out*` files in a category folder are deleted with a warning so a forced rerun does not mix with old curves.

Sources: [ml-agents/mlagents/trainers/stats.py:213-286](repo://ml-agents/mlagents/trainers/stats.py#L213-L286), [ml-agents/mlagents/plugins/stats_writer.py:20-29](repo://ml-agents/mlagents/plugins/stats_writer.py#L20-L29)

### ConsoleWriter

Logs one line per summary: behavior, step, elapsed time and, if any episode finished, the mean reward and either its standard deviation or the mean group reward, plus `Training` or `Not Training`; otherwise "No episode was completed since last summary". With self-play enabled it appends the ELO. It logs the hyperparameters once when the trainer starts.

Sources: [ml-agents/mlagents/trainers/stats.py:157-210](repo://ml-agents/mlagents/trainers/stats.py#L157-L210)

### GaugeWriter

Copies every summary into the timer gauges as `<category>.<key>.mean` and `.sum`, with `/` turned into `.` and spaces removed. Gauges end up in `run_logs/timers.json`, which gives a machine-readable record of the final values ([[Profiling with Hierarchical Timers]]).

Sources: [ml-agents/mlagents/trainers/stats.py:131-154](repo://ml-agents/mlagents/trainers/stats.py#L131-L154)

## Writer plugins

`register_stats_writer_plugins(run_options)` loads every `mlagents.stats_writer` entry point, calls it with the `RunOptions` and collects the writers it returns. A plugin that raises is logged and skipped. If no entry points are registered at all, which means a broken install, it warns and falls back to the default writers. `run_training` adds all of them to `StatsReporter`. See [[Trainer and Stats Writer Plugins]].

Sources: [ml-agents/mlagents/plugins/stats_writer.py:32-63](repo://ml-agents/mlagents/plugins/stats_writer.py#L32-L63), [ml-agents/mlagents/trainers/learn.py:92-95](repo://ml-agents/mlagents/trainers/learn.py#L92-L95)

## Metrics from Unity

Game code can report its own metrics with `Academy.Instance.StatsRecorder.Add(key, value, aggregationMethod)`. Keys can contain `/` to group them in TensorBoard, such as `Agent/Health`.

Sources: [com.unity.ml-agents/Runtime/StatsRecorder.cs:33-79](repo://com.unity.ml-agents/Runtime/StatsRecorder.cs#L33-L79)

| C# `StatAggregationMethod` | Python handling |
| --- | --- |
| `Average` (default) | `add_stat`, averaged |
| `MostRecent` | `set_stat`, from environment worker 0 only |
| `Sum` | `add_stat`, summed |
| `Histogram` | `add_stat`, mean scalar plus histogram |

Sources: [com.unity.ml-agents/Runtime/StatsRecorder.cs:8-31](repo://com.unity.ml-agents/Runtime/StatsRecorder.cs#L8-L31), [ml-agents/mlagents/trainers/agent_processor.py:441-469](repo://ml-agents/mlagents/trainers/agent_processor.py#L441-L469)

The recorder sends each value through the stats side channel ([[Side Channels]]). Each environment worker collects the received values after every step with `get_and_reset_stats`, returns them with the step results, and the environment manager passes them to the behavior's `AgentManager`, which reports them under that behavior's category. Environment stats therefore appear under every behavior that has data in that step.

Sources: [ml-agents/mlagents/trainers/subprocess_env_manager.py:176-197](repo://ml-agents/mlagents/trainers/subprocess_env_manager.py#L176-L197), [ml-agents/mlagents/trainers/env_manager.py:132-157](repo://ml-agents/mlagents/trainers/env_manager.py#L132-L157)

## Metrics the trainers report

| Key | Reported by |
| --- | --- |
| `Environment/Cumulative Reward` | End of each agent's episode (histogram) |
| `Environment/Group Cumulative Reward` | End of each group episode (POCA) |
| `Environment/Episode Length` | Agent processor, end of each episode |
| `Environment/Lesson Number/<param>` | Trainer controller, every step |
| `Policy/Entropy` | Agent processor, from the policy's outputs |
| `Policy/<Signal> Reward` | End of each episode, per reward signal |
| `Policy/<Signal> Value Estimate`, `Policy/<Signal> Baseline Estimate` | PPO and POCA trajectory processing |
| `Policy/Learning Rate`, `Policy/Epsilon`, `Policy/Beta` | PPO and POCA updates |
| `Losses/Policy Loss`, `Losses/Value Loss`, `Losses/Baseline Loss` | Optimizer updates |
| `Losses/Q1 Loss`, `Losses/Q2 Loss`, `Policy/Continuous Entropy Coeff`, `Policy/Discrete Entropy Coeff` | SAC updates |
| `Losses/Curiosity Forward Loss`, `Losses/RND Loss`, `Losses/GAIL Loss`, `Losses/Pretraining Loss` | Reward signal and behavioral cloning updates |
| `Self-play/ELO` | Ghost trainer |

Sources: [ml-agents/mlagents/trainers/trainer/rl_trainer.py:70-94](repo://ml-agents/mlagents/trainers/trainer/rl_trainer.py#L70-L94), [ml-agents/mlagents/trainers/agent_processor.py:103-111](repo://ml-agents/mlagents/trainers/agent_processor.py#L103-L111), [ml-agents/mlagents/trainers/ppo/optimizer_torch.py:180-196](repo://ml-agents/mlagents/trainers/ppo/optimizer_torch.py#L180-L196), [ml-agents/mlagents/trainers/ppo/trainer.py:95-110](repo://ml-agents/mlagents/trainers/ppo/trainer.py#L95-L110), [ml-agents/mlagents/trainers/trainer_controller.py:237-245](repo://ml-agents/mlagents/trainers/trainer_controller.py#L237-L245)

The per-algorithm pages ([[PPO Trainer]], [[SAC Trainer]], [[POCA Multi-Agent Trainer]], [[Reward Signals]]) describe what each loss measures.

Sources: [ml-agents/mlagents/trainers/poca/trainer.py:105-120](repo://ml-agents/mlagents/trainers/poca/trainer.py#L105-L120), [ml-agents/mlagents/trainers/poca/trainer.py:185-192](repo://ml-agents/mlagents/trainers/poca/trainer.py#L185-L192), [ml-agents/mlagents/trainers/sac/optimizer_torch.py:628-640](repo://ml-agents/mlagents/trainers/sac/optimizer_torch.py#L628-L640)
