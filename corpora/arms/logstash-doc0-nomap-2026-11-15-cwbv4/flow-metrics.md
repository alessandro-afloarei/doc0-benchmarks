---
title: "Flow Metrics"
---
## Overview

Counters and timers only ever grow, so on their own they say little about what Logstash is doing now. Flow metrics turn pairs of them into rates: events in per second of uptime, milliseconds of worker time per millisecond of wall time, and so on. Each `FlowMetric` divides the change of a numerator metric by the change of a denominator metric over several trailing windows (`current`, `last_1_minute`, up to `last_24_hours`) and over the whole lifetime. They are created for the whole process, for each pipeline and for each plugin, sampled every few seconds by a poller, and read by the [[Monitoring API]] and the [[Health Report]]. The underlying counters are described on [[Metrics System]].

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetric.java:25-50](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetric.java#L25-L50), [logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetricRetentionPolicy.java:35-43](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetricRetentionPolicy.java#L35-L43)

## Captures and rates

A `FlowCapture` records a monotonic `nanoTime`, the numerator value and the denominator value at one instant. The rate between two captures is `Δnumerator / Δdenominator`, rounded to four significant digits. When the denominator did not change, the result is empty if the numerator did not change either, and positive or negative infinity otherwise.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/FlowCapture.java:29-73](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/FlowCapture.java#L29-L73), [logstash-core/src/main/java/org/logstash/instrument/metrics/BaseFlowMetric.java:107-145](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/BaseFlowMetric.java#L107-L145)

`BaseFlowMetric.doCapture` reads both metrics and returns nothing while either is still `null` (a lazy gauge that has not been set yet). The first successful capture becomes the lifetime baseline, set once; the `lifetime` rate is always measured from it.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/BaseFlowMetric.java:39-106](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/BaseFlowMetric.java#L39-L106)

## Retention windows

`FlowMetric.create` returns an `ExtendedFlowMetric` unless the internal system property `logstash.flowMetric` is `simple`, which selects the simpler `SimpleFlowMetric`. The extended metric keeps one retention window per built-in policy, listed in the table.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetric.java:34-49](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetric.java#L34-L49), [logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetricRetentionPolicy.java:24-99](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetricRetentionPolicy.java#L24-L99), [logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java:51-81](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java#L51-L81)

| Window | Retention | Resolution |
| --- | --- | --- |
| `current` | 10 s | 1 s |
| `last_1_minute` | 1 min | 3 s |
| `last_5_minutes` | 5 min | 15 s |
| `last_15_minutes` | 15 min | 30 s |
| `last_1_hour` | 1 h | 1 min |
| `last_24_hours` | 24 h | 15 min |

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetric.java:34-49](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetric.java#L34-L49), [logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetricRetentionPolicy.java:24-99](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetricRetentionPolicy.java#L24-L99), [logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java:51-81](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java#L51-L81)

Each window is a lock-free linked list of captures. `append` stages the newest capture and promotes the previously staged one into the list only when the newest is more than one resolution step past the tail, so each window holds roughly `retention / resolution` captures however often `capture` is called. When the head grows much older than the retention (by at least 30 seconds or eight resolution steps), the list is compacted on insert.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java:193-247](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java#L193-L247), [logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetricRetentionPolicy.java:54-68](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/FlowMetricRetentionPolicy.java#L54-L68)

## Reading a flow metric

`getValue` takes a fresh capture and, for each window, compacts the head to the newest capture at least `retention` old and computes the rate from it. A window without such a capture yet is left out of the result, so `last_1_hour` only appears after Logstash has run for an hour. The exception is `current`, which reports before its window is satisfied by falling back to the lifetime baseline. The `lifetime` rate is always added. The result is a map such as `{current: 512.3, last_1_minute: 498.0, lifetime: 470.1}`.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java:83-154](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java#L83-L154), [logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java:257-271](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java#L257-L271)

`LazyInstantiatedFlowMetric` wraps suppliers for metrics that may not exist when the flow metric is created, such as persisted-queue gauges. It builds the real flow metric on first successful lookup and returns an empty map (and warns on capture) until then.

Sources: [logstash-core/src/main/java/org/logstash/instrument/metrics/LazyInstantiatedFlowMetric.java:20-87](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/LazyInstantiatedFlowMetric.java#L20-L87)

## Pipeline flow metrics

`AbstractPipelineExt#initialize_flow_metrics` runs at pipeline start when metrics are collected. It creates an uptime metric for the pipeline and registers the flows in the table under `stats.pipelines.<id>.flow`.

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:544-591](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L544-L591), [logstash-core/src/main/java/org/logstash/instrument/metrics/UpScaledMetric.java:10-50](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/UpScaledMetric.java#L10-L50)

| Flow | Numerator | Denominator | Meaning |
| --- | --- | --- | --- |
| `input_throughput` | `events.in` | uptime (s) | Events per second entering the queue |
| `filter_throughput` | `events.filtered` | uptime (s) | Events per second taken by workers |
| `output_throughput` | `events.out` | uptime (s) | Events per second sent to outputs |
| `queue_backpressure` | `queue_push_duration_in_millis` | uptime (ms) | Average number of inputs blocked on the queue |
| `worker_concurrency` | `duration_in_millis` | uptime (ms) | Average number of busy workers |
| `worker_utilization` | `duration_in_millis × 100` | uptime (ms) × workers | Percentage of worker capacity in use |

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:544-591](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L544-L591), [logstash-core/src/main/java/org/logstash/instrument/metrics/UpScaledMetric.java:10-50](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/UpScaledMetric.java#L10-L50)

For a persisted queue it also adds `queue_persisted_growth_events` (change in unread events per second) and `queue_persisted_growth_bytes` (change in queue size per second), built lazily because the queue gauges appear only after the first stats collection; positive values mean the queue is filling.

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:668-687](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L668-L687)

Each plugin gets its own flows under `stats.pipelines.<id>.plugins.<type>s.<plugin id>.flow`. Inputs get `throughput` (events out per second). Filters and outputs get `worker_millis_per_event` (time spent per event received) and `worker_utilization` (their share of total worker capacity), which shows which plugin is the bottleneck.

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:689-736](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L689-L736)

The metrics are registered with `Collector#register?`, so a flow already registered under the same key (after a reload, for instance) is not replaced; a failure is logged as "Metric registration error". They are also grouped in `ScopedFlowMetrics` by scope (`WORKER` or `PLUGIN`) so the pipeline can capture them together.

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:738-751](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L738-L751), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:593-609](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L593-L609)

## Process flow metrics

The agent registers five flows under `stats.flow` on the process-wide `stats.events` counters: `input_throughput`, `filter_throughput`, `output_throughput`, `queue_backpressure` and `worker_concurrency`. As written, the agent's `filter_throughput` uses the `out` counter and `output_throughput` the `filtered` counter, the reverse of the pipeline-level definitions above.

Sources: [logstash-core/lib/logstash/agent.rb:592-640](repo://logstash-core/lib/logstash/agent.rb#L592-L640)

## Capturing

The `FlowRate` periodic poller runs every 5 seconds by default. Each run calls `Agent#capture_flow_metrics` for the process flows and `collect_flow_metrics` on every running user pipeline, which captures all of that pipeline's scoped flows ([[Periodic Pollers and System Monitors]]). Reads between captures still see fresh numbers, because `getValue` always takes its own capture for the newest point.

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/flow_rate.rb:18-35](repo://logstash-core/lib/logstash/instrument/periodic_poller/flow_rate.rb#L18-L35), [logstash-core/lib/logstash/instrument/periodic_poller/base.rb:25-36](repo://logstash-core/lib/logstash/instrument/periodic_poller/base.rb#L25-L36), [logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java:83-110](repo://logstash-core/src/main/java/org/logstash/instrument/metrics/ExtendedFlowMetric.java#L83-L110)

`AbstractPipelineExt#collectWorkerUtilizationFlowObservation` exposes the pipeline's `worker_utilization` flow to the health indicators, which use it to report pipelines whose workers are saturated ([[Health Report]]).

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:599-609](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L599-L609), [logstash-core/lib/logstash/agent.rb:172-195](repo://logstash-core/lib/logstash/agent.rb#L172-L195)
