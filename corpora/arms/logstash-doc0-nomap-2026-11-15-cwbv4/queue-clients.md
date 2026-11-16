---
title: "Queue Selection and the Memory Queue"
---
## Overview

Every pipeline puts a queue between its inputs and its workers. Inputs push events through a write client; workers pull batches through a read client ([[Worker Loop and Batches]]). The `queue.type` setting chooses the implementation per pipeline: `memory`, the default, is a bounded in-process buffer; `persisted` writes events to disk before acknowledging them ([[Persistent Queue]]). This page covers the selection, the common client interfaces, the per-input metrics wrapper, and the memory queue.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java:67-115](repo://logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java#L67-L115), [logstash-core/lib/logstash/environment.rb:85-86](repo://logstash-core/lib/logstash/environment.rb#L85-L86)

## Choosing the queue

`QueueFactoryExt.create(settings)` is called from `AbstractPipelineExt#open_queue` when a pipeline is constructed for real (not for validation). It reads `queue.type` from the pipeline's settings and builds one of two queues.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java:67-120](repo://logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java#L67-L120), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:292-310](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L292-L310)

| `queue.type` | Result |
| --- | --- |
| `persisted` | `JRubyWrappedAckedQueueExt` in `path.queue/<pipeline.id>`, created if missing, with `queue.page_capacity`, `queue.max_events`, `queue.checkpoint.writes`, `queue.checkpoint.acks`, `queue.checkpoint.retry` and `queue.max_bytes` |
| `memory` | `JrubyWrappedSynchronousQueueExt` with capacity `pipeline.batch.size × pipeline.workers` |
| anything else | `ConfigurationError`: supported types are `memory` or `persisted` |

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java:67-120](repo://logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java#L67-L120), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:292-310](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L292-L310)

Each persisted pipeline therefore has its own directory; two pipelines never share queue files. The existence check before `Files.createDirectories` lets `path.queue/<id>` be a symlink to another disk.

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java:71-82](repo://logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java#L71-L82)

## The wrapped queue contract

### Queue object

Both queue types extend `AbstractWrappedQueueExt`, which exposes three Ruby methods: `write_client`, `read_client` and `close`. The pipeline asks for one write client and one read client when it opens the queue and keeps them for its whole life.

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractWrappedQueueExt.java:32-64](repo://logstash-core/src/main/java/org/logstash/execution/AbstractWrappedQueueExt.java#L32-L64), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:300-310](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L300-L310)

### Write side

`JRubyAbstractQueueWriteClientExt` defines `push` (alias `<<`) for one event and `push_batch` for a collection, delegating to the subclass's `doPush` and `doPushBatch`. It also implements the Java `QueueWriter` interface, whose `push(Map)` is what Java inputs call; implementations must copy the map because callers may reuse it.

Sources: [logstash-core/src/main/java/org/logstash/ext/JRubyAbstractQueueWriteClientExt.java:34-63](repo://logstash-core/src/main/java/org/logstash/ext/JRubyAbstractQueueWriteClientExt.java#L34-L63), [logstash-core/src/main/java/org/logstash/execution/queue/QueueWriter.java:25-38](repo://logstash-core/src/main/java/org/logstash/execution/queue/QueueWriter.java#L25-L38)

### Read side

The read client is a `QueueReadClientBase` subclass: `readBatch`, `newBatch`, `closeBatch`, `isEmpty`, and batch dimensions set by the pipeline from `pipeline.batch.size` and `pipeline.batch.delay` ([[Worker Loop and Batches]]).

Sources: [logstash-core/src/main/java/org/logstash/execution/QueueReadClientBase.java:44-136](repo://logstash-core/src/main/java/org/logstash/execution/QueueReadClientBase.java#L44-L136)

## Per-input write metrics

Inputs do not get the raw write client. Ruby inputs receive a `JRubyWrappedWriteClientExt` built by `AbstractPipelineExt#wrapped_write_client(plugin_id)`, and Java inputs a `QueueWriter` from `getQueueWriter(input_name)`. The wrapper counts and times every push at three levels at once.

Sources: [logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java:67-105](repo://logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java#L67-L105), [logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java:140-153](repo://logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java#L140-L153), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:791-807](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L791-L807)

| Namespace | Counter | Timer |
| --- | --- | --- |
| `stats.events` | `in` | `queue_push_duration_in_millis` |
| `stats.pipelines.<id>.events` | `in` | `queue_push_duration_in_millis` |
| `stats.pipelines.<id>.plugins.inputs.<plugin id>.events` | `out` | `queue_push_duration_in_millis` |

Sources: [logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java:67-105](repo://logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java#L67-L105), [logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java:140-153](repo://logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java#L140-L153), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:791-807](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L791-L807)

The push duration includes time spent blocked on a full queue, which makes it the measure of back-pressure on each input; [[Flow Metrics]] derives the `queue_backpressure` rate from it.

Sources: [logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java:107-153](repo://logstash-core/src/main/java/org/logstash/ext/JRubyWrappedWriteClientExt.java#L107-L153)

## The memory queue

### Capacity

`JrubyWrappedSynchronousQueueExt` wraps a `java.util.concurrent.ArrayBlockingQueue` of `RubyEvent`. The capacity, `batch.size × workers`, is the number of events all workers can hold in flight at once, so the queue buffers about one round of batches. Closing it does nothing.

Sources: [logstash-core/src/main/java/org/logstash/ext/JrubyWrappedSynchronousQueueExt.java:36-77](repo://logstash-core/src/main/java/org/logstash/ext/JrubyWrappedSynchronousQueueExt.java#L36-L77), [logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java:95-105](repo://logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java#L95-L105)

### Writing

`JrubyMemoryWriteClientExt.doPush` calls `queue.put(event)`, which blocks while the queue is full. `doPushBatch` puts the events one by one with `LsQueueUtils.addAll`. The `QueueWriter.push(Map)` variant builds a new `Event` from the map first. When workers fall behind, inputs block inside `push`, and the input plugins in turn stop reading from their sources: this is how back-pressure propagates with the memory queue.

Sources: [logstash-core/src/main/java/org/logstash/ext/JrubyMemoryWriteClientExt.java:35-80](repo://logstash-core/src/main/java/org/logstash/ext/JrubyMemoryWriteClientExt.java#L35-L80), [logstash-core/src/main/java/org/logstash/common/LsQueueUtils.java:45-53](repo://logstash-core/src/main/java/org/logstash/common/LsQueueUtils.java#L45-L53)

### Reading

`JrubyMemoryReadClientExt.readBatch` calls `LsQueueUtils.drain(queue, batchSize, waitForNanos)`, wraps the result in a `MemoryReadBatch`, and registers it as the calling thread's in-flight batch. The read client starts with 125 events and 50 ms; the pipeline overrides both with its settings before the workers start.

Sources: [logstash-core/src/main/java/org/logstash/ext/JrubyMemoryReadClientExt.java:34-87](repo://logstash-core/src/main/java/org/logstash/ext/JrubyMemoryReadClientExt.java#L34-L87), [logstash-core/lib/logstash/java_pipeline.rb:293](repo://logstash-core/lib/logstash/java_pipeline.rb#L293-L293)

`drain` repeatedly takes whatever is immediately available with `drainTo`, and when it still needs more, waits up to the batch delay for one more event with `poll`. A wait that times out ends the batch. A busy queue therefore yields full batches at once, and an idle one yields a smaller batch after at most one delay per missing event gap.

Sources: [logstash-core/src/main/java/org/logstash/common/LsQueueUtils.java:71-122](repo://logstash-core/src/main/java/org/logstash/common/LsQueueUtils.java#L71-L122)

`closeBatch` only removes the in-flight entry; nothing is acknowledged because nothing was stored.

Sources: [logstash-core/src/main/java/org/logstash/execution/QueueReadClientBase.java:130-136](repo://logstash-core/src/main/java/org/logstash/execution/QueueReadClientBase.java#L130-L136), [logstash-core/src/main/java/org/logstash/execution/MemoryReadBatch.java:76-79](repo://logstash-core/src/main/java/org/logstash/execution/MemoryReadBatch.java#L76-L79)

## Memory vs persisted

| Concern | `memory` | `persisted` |
| --- | --- | --- |
| Events survive a crash or kill | No: in-flight and queued events are lost | Yes: written events are replayed until acknowledged |
| Capacity | `batch.size × workers` events | `queue.max_bytes` / `queue.max_events` on disk |
| Drain on shutdown | Always | Only with `queue.drain: true` |
| Back-pressure starts | As soon as workers are busy | When the on-disk queue is full |

Sources: [logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java:67-115](repo://logstash-core/src/main/java/org/logstash/ackedqueue/QueueFactoryExt.java#L67-L115), [logstash-core/lib/logstash/java_pipeline.rb:62](repo://logstash-core/lib/logstash/java_pipeline.rb#L62-L62)

When a worker crashes, inputs can stay blocked on a full memory queue with nobody reading. The pipeline's monitor then drains and discards batches to unblock them, logging "Dropping events to unblock input plugin" ([[Pipeline Lifecycle]]).

Sources: [logstash-core/lib/logstash/java_pipeline.rb:377-385](repo://logstash-core/lib/logstash/java_pipeline.rb#L377-L385)
