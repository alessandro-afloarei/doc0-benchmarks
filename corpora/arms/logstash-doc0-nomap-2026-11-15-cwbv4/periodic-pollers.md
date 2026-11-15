---
title: "Periodic Pollers and System Monitors"
---
## Overview

Some metrics are not driven by events: heap usage, garbage collection counts, open file descriptors, cgroup CPU limits, queue sizes on disk. The agent gathers these on a timer with a set of periodic pollers, each writing gauges into the same metric store as everything else ([[Metrics System]]). The pollers also trigger the per-pipeline queue, dead letter queue and flow-metric collection. Separately, a set of Java monitors read JVM management beans on demand; the hot threads report used by the [[Monitoring API]] is one of them.

Sources: [logstash-core/lib/logstash/instrument/periodic_pollers.rb:24-48](repo://logstash-core/lib/logstash/instrument/periodic_pollers.rb#L24-L48), [logstash-core/lib/logstash/agent.rb:511-527](repo://logstash-core/lib/logstash/agent.rb#L511-L527)

## The poller framework

`PeriodicPollers` builds five pollers when the agent configures metrics, starts them together, and stops them at agent shutdown.

Sources: [logstash-core/lib/logstash/instrument/periodic_pollers.rb:28-47](repo://logstash-core/lib/logstash/instrument/periodic_pollers.rb#L28-L47)

| Poller | Collects | Writes to |
| --- | --- | --- |
| `Os` | cgroup CPU statistics | `os.cgroup.*` |
| `JVM` | Heap, non-heap, pools, threads, GC, process CPU and file descriptors, load average | `jvm.*` |
| `PersistentQueue` | Calls `collect_stats` on each running user pipeline | `stats.pipelines.<id>.queue` |
| `DeadLetterQueue` | Calls `collect_dlq_stats` on each running user pipeline | `stats.pipelines.<id>.dlq` |
| `FlowRate` | Captures agent and pipeline flow metrics | `stats.flow`, `stats.pipelines.<id>.flow` |

Sources: [logstash-core/lib/logstash/instrument/periodic_pollers.rb:31-38](repo://logstash-core/lib/logstash/instrument/periodic_pollers.rb#L31-L38), [logstash-core/lib/logstash/instrument/periodic_poller/pq.rb:20-38](repo://logstash-core/lib/logstash/instrument/periodic_poller/pq.rb#L20-L38), [logstash-core/lib/logstash/instrument/periodic_poller/dlq.rb:20-35](repo://logstash-core/lib/logstash/instrument/periodic_poller/dlq.rb#L20-L35), [logstash-core/lib/logstash/instrument/periodic_poller/flow_rate.rb:20-35](repo://logstash-core/lib/logstash/instrument/periodic_poller/flow_rate.rb#L20-L35)

Each poller extends `PeriodicPoller::Base`, which wraps a `Concurrent::TimerTask` running `collect` every 5 seconds with a 120-second timeout. `start` collects once immediately, so metrics exist as soon as the agent starts, then schedules the task. The base class observes the task: a timeout is logged at debug level, any other exception at error level, and the next run happens regardless.

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/base.rb:21-90](repo://logstash-core/lib/logstash/instrument/periodic_poller/base.rb#L21-L90)

The queue, DLQ and flow pollers only visit `running_user_defined_pipelines`, so system pipelines such as x-pack monitoring are not measured, and terminated pipelines stop updating ([[Agent and Pipeline Convergence]]).

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/pq.rb:29-36](repo://logstash-core/lib/logstash/instrument/periodic_poller/pq.rb#L29-L36), [logstash-core/lib/logstash/pipelines_registry.rb:306-310](repo://logstash-core/lib/logstash/pipelines_registry.rb#L306-L310)

## JVM poller

`JVM#collect` takes a `MemoryReport` and records the following.

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/jvm.rb:63-76](repo://logstash-core/lib/logstash/instrument/periodic_poller/jvm.rb#L63-L76)

- `jvm.uptime_in_millis` from the runtime bean.
- `jvm.memory.heap` and `jvm.memory.non_heap`: `used_in_bytes`, `committed_in_bytes`, `max_in_bytes`, `peak_used_in_bytes`, `peak_max_in_bytes` summed over the memory pools, plus `used_percent` for the heap.
- `jvm.memory.pools.young`, `old` and `survivor`, merging the CMS, Parallel and G1 pool names into those three buckets.
- `jvm.threads.count` and `peak_count`.
- `jvm.gc.collectors.young` and `old`: `collection_count` and `collection_time_in_millis`. Collector names are mapped to young or old from fixed lists; an unknown collector is logged as an error.
- `jvm.process`: open, peak and maximum file descriptors, CPU percent and total CPU time, and total virtual memory, from `ProcessReport`.
- `jvm.process.cpu.load_average`: 1, 5 and 15 minute averages from `/proc/loadavg` on Linux, only the 1-minute value from the OS bean elsewhere, nothing on Windows.

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/jvm.rb:36-131](repo://logstash-core/lib/logstash/instrument/periodic_poller/jvm.rb#L36-L131), [logstash-core/lib/logstash/instrument/periodic_poller/jvm.rb:133-200](repo://logstash-core/lib/logstash/instrument/periodic_poller/jvm.rb#L133-L200), [logstash-core/lib/logstash/instrument/periodic_poller/load_average.rb:20-65](repo://logstash-core/lib/logstash/instrument/periodic_poller/load_average.rb#L20-L65)

The peak file descriptor count is tracked by the poller itself, as the maximum seen since start.

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/jvm.rb:101-120](repo://logstash-core/lib/logstash/instrument/periodic_poller/jvm.rb#L101-L120)

## OS poller and cgroups

`Os#collect` asks `Cgroup.get` for statistics and stores the returned nested hash as gauges under `os.cgroup`. `Cgroup` reads `/proc/self/cgroup` to find the control group paths of the `cpu` and `cpuacct` controllers, then reads files under `/sys/fs/cgroup/cpu` and `/sys/fs/cgroup/cpuacct`, as listed below.

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/os.rb:21-50](repo://logstash-core/lib/logstash/instrument/periodic_poller/os.rb#L21-L50), [logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb:40-92](repo://logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb#L40-L92)

| Controller | Values |
| --- | --- |
| `cpuacct` | `control_group`, `usage_nanos` (from `cpuacct.usage`) |
| `cpu` | `control_group`, `cfs_period_micros`, `cfs_quota_micros`, and `stat` (periods, throttled periods, throttled time from `cpu.stat`) |

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb:125-213](repo://logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb#L125-L213)

If any of the three paths is missing, as on cgroup v2-only hosts, or outside Linux, `get` returns nothing and no `os` metrics are written. Inside containers the path in `/proc/self/cgroup` may not match the mounted hierarchy; the system properties `ls.cgroup.cpu.path.override` and `ls.cgroup.cpuacct.path.override` (passed through `LS_JAVA_OPTS`) replace it, and a missing file logs a debug message suggesting the override.

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb:23-38](repo://logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb#L23-L38), [logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb:94-124](repo://logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb#L94-L124), [logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb:215-243](repo://logstash-core/lib/logstash/instrument/periodic_poller/cgroup.rb#L215-L243)

## Queue and DLQ pollers

`collect_stats` records the pipeline's queue type and, for persisted queues, `capacity.page_capacity_in_bytes`, `max_queue_size_in_bytes`, `max_unread_events` and `queue_size_in_bytes`, the unread `events` count, and `data.free_space_in_bytes`, `storage_type` and `path` of the queue's file system ([[Persistent Queue]]). `collect_dlq_stats` does the same for the dead letter queue ([[Dead Letter Queue]]). Because the pollers run every 5 seconds, these gauges lag by up to that interval.

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:514-541](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L514-L541), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:456-479](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L456-L479)

## Java monitors and reports

The `org.logstash.instrument.monitors` package reads JVM management beans when asked, and the `reports` package turns their output into plain maps for Ruby.

Sources: [logstash-core/src/main/java/org/logstash/instrument/reports/MemoryReport.java:39-45](repo://logstash-core/src/main/java/org/logstash/instrument/reports/MemoryReport.java#L39-L45), [logstash-core/src/main/java/org/logstash/instrument/reports/ProcessReport.java:34-37](repo://logstash-core/src/main/java/org/logstash/instrument/reports/ProcessReport.java#L34-L37)

| Monitor | Report | Provides |
| --- | --- | --- |
| `MemoryMonitor` | `MemoryReport` | Usage and peak of every heap and non-heap memory pool |
| `ProcessMonitor` | `ProcessReport` | Open and maximum file descriptors (Unix), process CPU load as a percentage, CPU time, total virtual memory |
| `HotThreadsMonitor` | `ThreadsReport` | Per-thread CPU, blocked and waited times, state and stack trace |
| `SystemMonitor` | none | OS name, architecture, processor count, system load |

Sources: [logstash-core/src/main/java/org/logstash/instrument/monitors/MemoryMonitor.java:41-100](repo://logstash-core/src/main/java/org/logstash/instrument/monitors/MemoryMonitor.java#L41-L100), [logstash-core/src/main/java/org/logstash/instrument/monitors/ProcessMonitor.java:41-138](repo://logstash-core/src/main/java/org/logstash/instrument/monitors/ProcessMonitor.java#L41-L138), [logstash-core/src/main/java/org/logstash/instrument/monitors/SystemMonitor.java:30-58](repo://logstash-core/src/main/java/org/logstash/instrument/monitors/SystemMonitor.java#L30-L58)

`HotThreadsMonitor.detect(options)` enables thread CPU time measurement if the JVM supports it, then builds a `ThreadReport` for every live thread except the calling one, skipping threads whose CPU time is unavailable. Options are `ordered_by` (`cpu` by default, `wait` or `block`, anything else is rejected) and `stacktrace_size` (default 50 frames). Reports are sorted in descending order of the chosen time. The API's hot threads endpoint calls it through `ThreadsReport.generate` ([[Monitoring API]]).

Sources: [logstash-core/src/main/java/org/logstash/instrument/monitors/HotThreadsMonitor.java:42-124](repo://logstash-core/src/main/java/org/logstash/instrument/monitors/HotThreadsMonitor.java#L42-L124), [logstash-core/src/main/java/org/logstash/instrument/monitors/HotThreadsMonitor.java:126-215](repo://logstash-core/src/main/java/org/logstash/instrument/monitors/HotThreadsMonitor.java#L126-L215), [logstash-core/src/main/java/org/logstash/instrument/reports/ThreadsReport.java:43-60](repo://logstash-core/src/main/java/org/logstash/instrument/reports/ThreadsReport.java#L43-L60)
