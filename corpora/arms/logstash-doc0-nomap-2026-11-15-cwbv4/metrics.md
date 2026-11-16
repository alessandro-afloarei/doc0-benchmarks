---
title: "Metrics System"
---
## Overview

Everything Logstash reports about itself, from events per pipeline to a plugin's own counters, is stored in one in-memory tree: the `MetricStore` held by the agent's `Collector`. Code writes to it through metric objects: a root `Metric` bound to the collector, and `NamespacedMetric` objects that prefix every key with a path such as `[:stats, :pipelines, :main, :plugins, :filters, "grok_1"]`. Values are Java metric types (counters, gauges, timers, uptime). Readers, chiefly the [[Monitoring API]] and x-pack monitoring, query the tree by path. Rates derived from these values are on [[Flow Metrics]]; host and JVM figures gathered on a schedule are on [[Periodic Pollers and System Monitors]].

Sources: [logstash-core/lib/logstash/instrument/collector.rb:24-117](repo://logstash-core/lib/logstash/instrument/collector.rb#L24-L117), [logstash-core/lib/logstash/agent.rb:511-523](repo://logstash-core/lib/logstash/agent.rb#L511-L523)

## Collector and store

The agent creates one `Collector` and wraps it in a `Metric`, or in a `NullMetric` when `metric.collect` is false ([[Agent and Pipeline Convergence]]). `Collector#push(path, key, type, action, value)` fetches or creates the metric at `path/key` and applies a `:gauge` set or a `:counter` increment; `Collector#get(path, key, type)` returns the metric object itself so Java code can hold a direct reference and skip later lookups. Recording errors are logged rather than raised, so a bad metric call never breaks event processing.

Sources: [logstash-core/lib/logstash/instrument/collector.rb:34-117](repo://logstash-core/lib/logstash/instrument/collector.rb#L34-L117)

`MetricStore` keeps a tree of `Concurrent::Map`s for structured queries and a flat `fast_lookup` map keyed by the full path, so repeated access to an existing metric costs one hash lookup. Creation takes a mutex and stores in both. A path element that already holds a metric cannot become a namespace: that raises `NamespacesExpectedError`.

Sources: [logstash-core/lib/logstash/instrument/metric_store.rb:26-89](repo://logstash-core/lib/logstash/instrument/metric_store.rb#L26-L89), [logstash-core/lib/logstash/instrument/metric_store.rb:311-321](repo://logstash-core/lib/logstash/instrument/metric_store.rb#L311-L321)

| Read method | Returns |
| --- | --- |
| `get(*path)` | Nested hash for the path; a path element may list several keys separated by commas |
| `get_shallow(*path)` | The sub-tree at the path |
| `get_with_path("a/b/c")` | Same as `get`, from a slash-separated string |
| `extract_metrics(path, *keys)` | Plain values for selected keys, with nested key specs |
| `each(path)` | Flat list of metric objects |
| `has_metric?(*path)` | Whether a metric exists |

Sources: [logstash-core/lib/logstash/instrument/metric_store.rb:106-207](repo://logstash-core/lib/logstash/instrument/metric_store.rb#L106-L207), [logstash-core/lib/logstash/instrument/metric_store.rb:245-270](repo://logstash-core/lib/logstash/instrument/metric_store.rb#L245-L270)

`prune(path)` deletes a sub-tree; `Collector#clear` uses it when a pipeline shuts down to drop its `plugins`, `events` and `flow` metrics ([[Pipeline Lifecycle]]). `snapshot_metric` returns a `Snapshot` holding a copy of the store and its creation time.

Sources: [logstash-core/lib/logstash/instrument/metric_store.rb:209-216](repo://logstash-core/lib/logstash/instrument/metric_store.rb#L209-L216), [logstash-core/lib/logstash/instrument/collector.rb:109-115](repo://logstash-core/lib/logstash/instrument/collector.rb#L109-L115), [logstash-core/src/main/java/org/logstash/instrument/metrics/SnapshotExt.java:33-65](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/SnapshotExt.java#L33-L65)

## Metric types

`MetricType.create` maps the type symbol to a Java class.

Sources: [logstash-core/lib/logstash/instrument/metric_type.rb:18-30](repo://logstash-core/lib/logstash/instrument/metric_type.rb#L18-L30), [logstash-core/src/main/java/org/logstash/instrument/metrics/counter/LongCounter.java:35-118](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/counter/LongCounter.java#L35-L118), [logstash-core/src/main/java/org/logstash/instrument/metrics/timer/TimerMetricFactory.java:6-16](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/timer/TimerMetricFactory.java#L6-L16)

| Symbol | Class | Behaviour |
| --- | --- | --- |
| `:counter` | `LongCounter` | `LongAdder`; `increment(n)`; negative increments are rejected |
| `:gauge` | `LazyDelegatingGauge` | Picks a concrete gauge from the first non-null value |
| `:timer` | `ConcurrentLiveTimerMetric` | Cumulative milliseconds, including executions still running |
| `:uptime` | `UptimeMetric` | Milliseconds since creation, scalable to other units |

Sources: [logstash-core/lib/logstash/instrument/metric_type.rb:18-30](repo://logstash-core/lib/logstash/instrument/metric_type.rb#L18-L30), [logstash-core/src/main/java/org/logstash/instrument/metrics/counter/LongCounter.java:35-118](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/counter/LongCounter.java#L35-L118), [logstash-core/src/main/java/org/logstash/instrument/metrics/timer/TimerMetricFactory.java:6-16](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/timer/TimerMetricFactory.java#L6-L16)

`LazyDelegatingGauge` becomes a `TextGauge`, `NumberGauge`, `BooleanGauge`, `RubyHashGauge`, `RubyTimeStampGauge` or `ListGauge` depending on the first value set, and logs a warning before falling back to `UnknownGauge` for anything else. This lets Ruby code call `gauge(key, value)` without declaring a type.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/gauge/LazyDelegatingGauge.java:38-130](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/gauge/LazyDelegatingGauge.java#L38-L130)

`ConcurrentLiveTimerMetric` is lock-free. `time(work)` atomically raises a concurrency count before the work and lowers it after; between changes the state records a checkpoint, so `getValue` returns completed time plus the time accumulated so far by executions in progress. A long-running output batch is therefore visible in `duration_in_millis` while it runs, not only when it finishes, which keeps worker utilization accurate. `reportUntrackedMillis` adds externally measured time.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/timer/ConcurrentLiveTimerMetric.java:13-75](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/timer/ConcurrentLiveTimerMetric.java#L13-L75)

## Writing metrics

The Ruby-visible API lives in `AbstractMetricExt` and its subclasses. `MetricExt` (the root) validates that keys are not empty, then calls the collector: `increment`/`decrement` push a counter action, `gauge` pushes a set, `timer` gets the timer object, `time(key) { ... }` times a block (or returns a timed execution to stop later), and `report_time` adds a duration.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/MetricExt.java:42-112](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/MetricExt.java#L42-L112), [logstash-core/src/main/java/org/logstash/instrument/metrics/MetricExt.java:137-184](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/MetricExt.java#L137-L184)

`namespace(name)` returns a `NamespacedMetricExt` that holds the root and a path, and forwards every call with the path prepended; calling `namespace` again appends to the path. `NullMetricExt` and `NullNamespacedMetricExt` accept the same calls and do nothing, so code never needs to check whether metrics are enabled.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/NamespacedMetricExt.java:35-126](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/NamespacedMetricExt.java#L35-L126), [logstash-core/src/main/java/org/logstash/instrument/metrics/NullMetricExt.java:37-70](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/NullMetricExt.java#L37-L70)

Hot Java paths do not go through the collector on every event. `LongCounter.fromRubyBase(namespacedMetric, key)` and `TimerMetric.fromRubyBase` resolve the metric object once at setup, and the code then increments the Java object directly. The worker observer, queue clients and plugin delegators all work this way ([[Worker Loop and Batches]]).

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/counter/LongCounter.java:53-70](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/counter/LongCounter.java#L53-L70), [logstash-core/src/main/java/org/logstash/instrument/metrics/timer/TimerMetric.java:21-38](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/timer/TimerMetric.java#L21-L38), [logstash-core/src/main/java/org/logstash/execution/WorkerObserver.java:20-31](repo://logstash-core/src/main/java/org/logstash/execution/WorkerObserver.java#L20-L31)

## Plugin metrics

Each plugin gets a metric namespaced to `[:stats, :pipelines, <pipeline id>, :plugins, :<type>s, <plugin id>]`, created by `PluginMetricsFactoryExt`. Ruby plugins reach it through `metric` (a null metric when `enable_metric => false`, see [[Ruby Plugin Model]]); Java plugins through `Context.getMetric(this)`, which wraps it in `NamespacedMetricImpl` with `gauge`, `counter`, `timer`, `increment`, `time`, `reportTime` and `namespace` ([[Java Plugin API]]).

Sources: [logstash-core/src/main/java/org/logstash/plugins/factory/PluginMetricsFactoryExt.java:40-58](repo://logstash-core/src/main/java/org/logstash/plugins/factory/PluginMetricsFactoryExt.java#L40-L58), [logstash-core/src/main/java/org/logstash/plugins/NamespacedMetricImpl.java:44-120](repo://logstash-core/src/main/java/org/logstash/plugins/NamespacedMetricImpl.java#L44-L120)

## The metric tree

`MetricKeys` names the symbols used across the tree. The table lists the main branches.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/MetricKeys.java:32-111](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/MetricKeys.java#L32-L111), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:514-541](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L514-L541), [logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java:83-102](repo://logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java#L83-L102)

| Path | Written by | Content |
| --- | --- | --- |
| `stats.events` | write clients, worker observer | Process-wide `in`, `filtered`, `out`, `duration_in_millis`, `queue_push_duration_in_millis` |
| `stats.pipelines.<id>.events` | same | The same counters for one pipeline |
| `stats.pipelines.<id>.plugins.<type>s.<id>.events` | delegators, write clients | Per-plugin `in`, `out`, `duration_in_millis` |
| `stats.pipelines.<id>.queue` | `collect_stats` | Queue type; for persisted queues capacity, unread events, free disk space |
| `stats.pipelines.<id>.dlq` | `collect_dlq_stats` | DLQ size and drop counters ([[Dead Letter Queue]]) |
| `stats.pipelines.<id>.config` | `start_workers` | Workers, batch size and delay, hash, graph |
| `stats.pipelines.<id>.reloads` | agent | Successes, failures, last error |
| `stats.pipelines.<id>.flow`, `stats.flow` | pipeline, agent | Flow metrics ([[Flow Metrics]]) |
| `stats.jvm`, `stats.os`, `stats.process` | periodic pollers | Host and JVM figures |

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/MetricKeys.java:32-111](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/MetricKeys.java#L32-L111), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:514-541](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L514-L541), [logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java:83-102](repo://logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java#L83-L102)

Event counts mean different things at each level. `in` counts events pushed by inputs, `filtered` counts events taken from the queue into a batch, and `out` counts events handed to outputs after filtering, so drops and clones in filters make `out` differ from `filtered`.

Sources: [logstash-core/src/main/java/org/logstash/execution/WorkerObserver.java:37-61](repo://logstash-core/src/main/java/org/logstash/execution/WorkerObserver.java#L37-L61), [logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java:107-144](repo://logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java#L107-L144)

`logstash/instrument/metric.rb` and `null_metric.rb` are empty files kept for plugins that require them; the classes now come from Java.

Sources: [logstash-core/lib/logstash/instrument/metric.rb:17-18](repo://logstash-core/lib/logstash/instrument/metric.rb#L17-L18), [logstash-core/lib/logstash/instrument/null_metric.rb:17-19](repo://logstash-core/lib/logstash/instrument/null_metric.rb#L17-L19)
