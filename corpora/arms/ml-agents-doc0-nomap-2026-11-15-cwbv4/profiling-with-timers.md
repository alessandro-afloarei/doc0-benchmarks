---
title: "Profiling with Hierarchical Timers"
---
## Overview

Both halves of the toolkit carry a small built-in profiler. Code marks blocks with named timers; nested timers form a tree in which every node accumulates total time and call count, so a run ends with a breakdown of where time went: stepping environments, decompressing images, processing trajectories, updating networks. Alongside timings, the profilers keep gauges (latest, minimum and maximum of a value) and string metadata. Python writes its tree to `results/<run-id>/run_logs/timers.json`; Unity writes its own to a JSON file in the project when the Academy shuts down.

Sources: [ml-agents-envs/mlagents_envs/timers.py:1-39](repo://ml-agents-envs/mlagents_envs/timers.py#L1-L39), [com.unity.ml-agents/Runtime/Timer.cs:372-480](repo://com.unity.ml-agents/Runtime/Timer.cs#L372-L480), [com.unity.ml-agents/Runtime/Timer.cs:492-532](repo://com.unity.ml-agents/Runtime/Timer.cs#L492-L532), [ml-agents/mlagents/trainers/learn.py:164-172](repo://ml-agents/mlagents/trainers/learn.py#L164-L172)

## Python timers

### Marking code

Two equivalent ways time a block. `hierarchical_timer(name)` is a context manager that pushes a child node named `name` under the current one, measures the block with `time.perf_counter()` and adds the elapsed time to the node, also when the block raises. `@timed` wraps a function in a timer named after its `__qualname__`. The same name under different parents is a different node, so a function called from two places is timed separately in each.

Sources: [ml-agents-envs/mlagents_envs/timers.py:267-307](repo://ml-agents-envs/mlagents_envs/timers.py#L267-L307)

```python
@timed
def foo(t):
    time.sleep(t)

def main():
    for i in range(3):
        foo(i + 1)
    with hierarchical_timer("context"):
        foo(1)

    print(get_timer_tree())
```

Sources: [ml-agents-envs/mlagents_envs/timers.py:4-16](repo://ml-agents-envs/mlagents_envs/timers.py#L4-L16)

### Data structures

A `TimerNode` holds its children by name, its total time, its call count and an `is_parallel` flag. A `TimerStack` holds the root, the stack of open nodes, the start time, gauges and metadata; default metadata records the timer format version, start time, Python version and command line. `GaugeNode` tracks the latest value with its minimum, maximum and update count; NaN values are ignored.

Sources: [ml-agents-envs/mlagents_envs/timers.py:42-133](repo://ml-agents-envs/mlagents_envs/timers.py#L42-L133), [ml-agents-envs/mlagents_envs/timers.py:136-245](repo://ml-agents-envs/mlagents_envs/timers.py#L136-L245)

Each thread has its own timer stack, created on first use and keyed by thread id, so timers in trainer threads never interleave with the main thread's. `get_timer_stack_for_thread` retrieves another thread's stack for merging.

Sources: [ml-agents-envs/mlagents_envs/timers.py:248-264](repo://ml-agents-envs/mlagents_envs/timers.py#L248-L264)

### Output format

`get_timer_tree()` turns the stack into a nested dictionary. The root's total is the time since the stack was created and its count 1; it also carries the gauges and the metadata, stamped with an end time. Each node reports `total`, `count`, `self` (total minus its children's totals, at least 0), `children`, and `is_parallel` when set, which explains why a parallel node's children can add up to more than the node itself.

Sources: [ml-agents-envs/mlagents_envs/timers.py:184-221](repo://ml-agents-envs/mlagents_envs/timers.py#L184-L221)

## Merging timers from threads and processes

Training spreads work over processes and threads, and the profiler gathers it back into one tree.

Sources: [ml-agents-envs/mlagents_envs/timers.py:73-93](repo://ml-agents-envs/mlagents_envs/timers.py#L73-L93)

| Source | How it is merged |
| --- | --- |
| Environment worker processes | Each step response carries the worker's root `TimerNode`; the worker then resets its timers. The main process merges all responses under a `workers` node with `is_parallel` set. |
| Trainer threads | When training ends, `join_threads` merges each thread's root under `trainer_threads`, marked parallel, and merges its gauges into the main stack. |

Sources: [ml-agents/mlagents/trainers/subprocess_env_manager.py:176-197](repo://ml-agents/mlagents/trainers/subprocess_env_manager.py#L176-L197), [ml-agents/mlagents/trainers/subprocess_env_manager.py:509-536](repo://ml-agents/mlagents/trainers/subprocess_env_manager.py#L509-L536), [ml-agents/mlagents/trainers/trainer_controller.py:270-292](repo://ml-agents/mlagents/trainers/trainer_controller.py#L270-L292)

`TimerNode.merge` adds the other node's total and count into a child named `root_name` (or into itself) and recurses into children; `GaugeNode.merge` keeps the more recent value and combines minimum, maximum and count.

Sources: [ml-agents-envs/mlagents_envs/timers.py:73-125](repo://ml-agents-envs/mlagents_envs/timers.py#L73-L125), [ml-agents-envs/mlagents_envs/timers.py:318-331](repo://ml-agents-envs/mlagents_envs/timers.py#L318-L331)

## What gets timed during training

`mlagents-learn` adds metadata for the ml-agents, ml-agents-envs, communication protocol, PyTorch and NumPy versions, and wraps set-up in `run_training.setup`. The training loop times `env_step` and `trainer_advance`; `@timed` marks many functions along the way, such as `UnityEnvironment.step`, `communicator.exchange`, `_take_step`, trajectory processing and optimizer updates, and image decompression is timed as `image_decompress`. The `GaugeWriter` stats writer copies every training statistic into gauges, so `timers.json` also records final reward and loss values ([[Stats and TensorBoard]]).

Sources: [ml-agents/mlagents/trainers/learn.py:256-261](repo://ml-agents/mlagents/trainers/learn.py#L256-L261), [ml-agents/mlagents/trainers/trainer_controller.py:229-252](repo://ml-agents/mlagents/trainers/trainer_controller.py#L229-L252), [ml-agents-envs/mlagents_envs/environment.py:331-354](repo://ml-agents-envs/mlagents_envs/environment.py#L331-L354), [ml-agents-envs/mlagents_envs/rpc_utils.py:106-142](repo://ml-agents-envs/mlagents_envs/rpc_utils.py#L106-L142), [ml-agents/mlagents/trainers/stats.py:131-154](repo://ml-agents/mlagents/trainers/stats.py#L131-L154)

`timers.json` is written in the `finally` block of `run_training`, so it is produced even when training is interrupted. A failure to write it is logged as a warning.

Sources: [ml-agents/mlagents/trainers/learn.py:136-143](repo://ml-agents/mlagents/trainers/learn.py#L136-L143), [ml-agents/mlagents/trainers/learn.py:164-172](repo://ml-agents/mlagents/trainers/learn.py#L164-L172)

## Unity timers

### TimerStack in C#

The C# `TimerStack` is a singleton (`TimerStack.Instance`) with the same model: `Scoped(name)` pushes a child and returns the stack, whose `Dispose` pops it, so a `using` block times a scope. Each non-root `TimerNode` also creates a Unity `CustomSampler`, so the same scopes appear in the Unity Profiler. `SetGauge` and `AddMetadata` work like their Python counterparts.

Sources: [com.unity.ml-agents/Runtime/Timer.cs:118-162](repo://com.unity.ml-agents/Runtime/Timer.cs#L118-L162), [com.unity.ml-agents/Runtime/Timer.cs:372-480](repo://com.unity.ml-agents/Runtime/Timer.cs#L372-L480)

The package times the Academy's step phases (`AgentSendState`, `DecideAction`, `AgentAct`), agent initialization of sensors and actuators, observation collection, action masking, protobuf conversion, sensor writes and compression. Agents also publish their cumulative episode reward as a `<Behavior>.CumulativeReward` gauge. The Academy records the communication protocol and package versions as metadata.

Sources: [com.unity.ml-agents/Runtime/Academy.cs:583-602](repo://com.unity.ml-agents/Runtime/Academy.cs#L583-L602), [com.unity.ml-agents/Runtime/Academy.cs:421-424](repo://com.unity.ml-agents/Runtime/Academy.cs#L421-L424), [com.unity.ml-agents/Runtime/Agent.cs:791-795](repo://com.unity.ml-agents/Runtime/Agent.cs#L791-L795), [com.unity.ml-agents/Runtime/Agent.cs:1114-1138](repo://com.unity.ml-agents/Runtime/Agent.cs#L1114-L1138)

### Root metadata and output

The root node records the Unity version and the command line, with arguments containing `accessToken`, `hubSessionId` or `licensingIpc` removed. When the Academy is disposed it calls `SaveJsonTimers()`, which adds the scene name and end time and serializes the tree with `DataContractJsonSerializer` to `Assets/ML-Agents/Timers/<scene>_timers.json` (under `Application.dataPath`). Saving is compiled only for the Editor and standalone players, and a write failure only logs a warning.

Sources: [com.unity.ml-agents/Runtime/Timer.cs:216-264](repo://com.unity.ml-agents/Runtime/Timer.cs#L216-L264), [com.unity.ml-agents/Runtime/Timer.cs:492-532](repo://com.unity.ml-agents/Runtime/Timer.cs#L492-L532), [com.unity.ml-agents/Runtime/Academy.cs:671-673](repo://com.unity.ml-agents/Runtime/Academy.cs#L671-L673)
