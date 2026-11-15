---
title: "Shutdown Watcher and Pipeline Reporter"
---
## Overview

Stopping a pipeline can take a long time: an output may be retrying a dead Elasticsearch, or a filter may be stuck on a slow lookup. Logstash does not kill such a pipeline by default. Instead, `JavaPipeline#shutdown` blocks in a `ShutdownWatcher` that takes a snapshot of the pipeline every second, logs a summary every few seconds, and declares the shutdown stalled when nothing moves. The snapshot comes from the pipeline's `PipelineReporter`, which also answers "what is in flight and which threads are busy". Both are Java classes (`ShutdownWatcherExt`, `PipelineReporterExt`) exposed to Ruby; the Ruby files of the same names are empty stubs kept for plugins that `require` them. The shutdown sequence itself is described on [[Pipeline Lifecycle]].

Sources: [logstash-core/lib/logstash/java_pipeline.rb:454-470](repo://logstash-core/lib/logstash/java_pipeline.rb#L454-L470), [logstash-core/lib/logstash/pipeline_reporter.rb:18-19](repo://logstash-core/lib/logstash/pipeline_reporter.rb#L18-L19)

## The watch loop

`ShutdownWatcher.new(pipeline)` uses three parameters, each overridable through optional constructor arguments: `cycle_period` 1 second, `report_every` 5 cycles, and `abort_threshold` 3 stalled reports. `start` runs on the thread that called `shutdown`.

Sources: [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:43-96](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L43-L96), [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:148-194](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L148-L194)

1. Sleep one cycle and count the attempt.
2. Stop if `stop!` was called or the pipeline's `finished_execution?` is true.
3. Append a reporter snapshot to a sliding window of the last `report_every` snapshots.
4. Every `report_every` cycles, log the latest snapshot as a warning, unless a worker is still draining a queue.
5. In that same cycle, check `shutdown_stalled?`. On the first stalled check, log "The shutdown process appears to be stalled due to busy or blocked plugins" (and, if draining, that the queue is draining). Count consecutive stalled checks and reset the count when one is not stalled.
6. With unsafe shutdown on and the count reaching `abort_threshold`, log "Forcefully quitting Logstash ..." and raise `SystemExit(-1)`.

Sources: [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:43-96](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L43-L96), [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:148-194](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L148-L194)

With the defaults, a busy pipeline logs a report every 5 seconds, and a stuck pipeline with `--pipeline.unsafe_shutdown` is abandoned after about 15 seconds of no progress. Without that flag, Logstash keeps waiting and logging.

Sources: [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:58-62](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L58-L62), [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:171-186](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L171-L186)

## What counts as stalled

`shutdown_stalled?` needs a full window of `report_every` snapshots. It then requires two things across the window.

Sources: [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:103-131](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L103-L131)

- the in-flight event count never decreases from one snapshot to the next, and
- the `stalling_threads` information is identical in every snapshot.

Sources: [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:103-131](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L103-L131)

If events drain at all, the shutdown is making progress and is not stalled. Note that the watcher asks each snapshot for `stalling_threads`, while the reporter stores the list under `stalling_threads_info`; the snapshot's `method_missing` looks the name up as a hash key, so as written that lookup yields `nil` for every snapshot and the in-flight count alone decides.

Sources: [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:103-131](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L103-L131), [logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java:294-297](repo://logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java#L294-L297), [logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java:149-152](repo://logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java#L149-L152)

## Unsafe shutdown

`ShutdownWatcher.unsafe_shutdown` is a process-wide flag. The runner sets it from `pipeline.unsafe_shutdown` (`--pipeline.unsafe_shutdown`) before creating the agent. Forcing the exit drops whatever is in flight, which with the memory queue means data loss; with a persisted queue unacknowledged events are replayed on the next start ([[Persistent Queue]]).

Sources: [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:50-77](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L50-L77), [logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java:211-214](repo://logstash-core/src/main/java/org/logstash/execution/ShutdownWatcherExt.java#L211-L214), [logstash-core/lib/logstash/runner.rb:331-334](repo://logstash-core/lib/logstash/runner.rb#L331-L334)

A separate, process-level escape hatch exists in the runner: a second `SIGINT` calls `exit!(1)` regardless of any watcher ([[Startup and the Runner]]).

Sources: [logstash-core/lib/logstash/runner.rb:548-563](repo://logstash-core/lib/logstash/runner.rb#L548-L563)

## The pipeline reporter

`AbstractPipelineExt` creates one `PipelineReporterExt` per pipeline at construction. `to_hash` builds a fresh picture each time it is called.

Sources: [logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java:94-158](repo://logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java#L94-L158), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:251-258](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L251-L258)

| Key | Content |
| --- | --- |
| `worker_states` | For each worker thread: `status` (or `dead`), `alive`, `index`, and `inflight_count`, the size of the batch that thread is processing |
| `events_filtered` | Sum of the pipeline's `events_filtered` counter |
| `events_consumed` | Sum of the pipeline's `events_consumed` counter |
| `output_info` | For each output: `type`, `id`, `concurrency` |
| `thread_info` | `plugin_threads_info`: details of live input and worker threads |
| `stalling_threads_info` | `stalling_threads_info`: busy threads only |
| `inflight_count` | Sum of the workers' in-flight counts |

Sources: [logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java:94-158](repo://logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java#L94-L158), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:251-258](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L251-L258)

In-flight counts come from the read client's `inflight_batches` map, keyed by the native id of the thread holding each batch ([[Worker Loop and Batches]]). The reporter looks up each worker thread's id in that map and takes the batch's `filteredSize`.

Sources: [logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java:160-209](repo://logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java#L160-L209), [logstash-core/src/main/java/org/logstash/execution/QueueReadClientBase.java:68-73](repo://logstash-core/src/main/java/org/logstash/execution/QueueReadClientBase.java#L68-L73)

## Thread information

`LogStash::Util.thread_info` describes a Ruby thread: id, name, the plugin it runs (from the thread-local `:plugin`), its backtrace with `LOGSTASH_HOME` replaced by `[...]`, its status, and its current call. It classifies two harmless states from the top frame: `blocked_on_push` (an input waiting to write to a full queue) and `waiting_for_events` (a worker waiting to pop).

Sources: [logstash-core/lib/logstash/util.rb:67-88](repo://logstash-core/lib/logstash/util.rb#L67-L88)

`JavaPipeline#stalling_threads_info` collects the live input and worker threads plus the pipeline thread, drops those in the harmless states, and removes `backtrace`, `blocked_on` and `status` so that only the plugin, name, id and current call remain. These are the threads the periodic warning lists, so a reader can see which plugin is busy and at which call.

Sources: [logstash-core/lib/logstash/java_pipeline.rb:522-537](repo://logstash-core/lib/logstash/java_pipeline.rb#L522-L537)

## Snapshots and log output

`snapshot` wraps the hash in a `Snapshot` object. Missing methods are looked up as hash keys, so the watcher can call `inflight_count` on it. `to_s` prints `to_simple_hash`: the in-flight count plus the stalling threads grouped by plugin, with threads not tied to a plugin under `other`. The warning therefore names the plugins whose threads are holding up the shutdown.

Sources: [logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java:119-124](repo://logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java#L119-L124), [logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java:245-321](repo://logstash-core/src/main/java/org/logstash/execution/PipelineReporterExt.java#L245-L321)
