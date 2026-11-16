---
title: "Dead Letter Queue"
---
## Overview

Some events cannot be delivered for reasons retrying will not fix: Elasticsearch rejects a document with a mapping conflict, or a conditional cannot be evaluated against the event. Rather than drop them or block the pipeline, a plugin can write such an event to the pipeline's dead letter queue (DLQ): a directory of append-only segment files, one directory per pipeline, under `path.dead_letter_queue`. A separate pipeline using the `dead_letter_queue` input plugin (shipped as its own gem) reads them back with `DeadLetterQueueReader`, so events can be fixed and reprocessed. Writing is off unless `dead_letter_queue.enable` is true for the pipeline.

Sources: [logstash-core/src/main/java/org/logstash/common/DeadLetterQueueFactory.java:55-135](repo://logstash-core/src/main/java/org/logstash/common/DeadLetterQueueFactory.java#L55-L135), [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java:81-133](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java#L81-L133)

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `dead_letter_queue.enable` | `false` | Create a real writer for the pipeline |
| `path.dead_letter_queue` | `path.data/dead_letter_queue` | Root directory; each pipeline writes to `<root>/<pipeline.id>` |
| `dead_letter_queue.max_bytes` | `1024mb` | Total size of all segments |
| `dead_letter_queue.storage_policy` | `drop_newer` | What to do when full: `drop_newer` or `drop_older` |
| `dead_letter_queue.flush_interval` | `5000` ms | Seal the current segment after this long without writes |
| `dead_letter_queue.retain.age` | none | Delete segments older than this (`5d`, `12h`, `30m`, `10s`) |

Sources: [logstash-core/lib/logstash/environment.rb:94-98](repo://logstash-core/lib/logstash/environment.rb#L94-L98), [logstash-core/lib/logstash/environment.rb:113-115](repo://logstash-core/lib/logstash/environment.rb#L113-L115), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:398-435](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L398-L435)

All of these are per-pipeline settings, so each pipeline in `pipelines.yml` can turn the DLQ on and size it separately ([[Settings and logstash.yml]]).

Sources: [logstash-core/lib/logstash/settings.rb:43-77](repo://logstash-core/lib/logstash/settings.rb#L43-L77)

## How a plugin gets a writer

The pipeline creates its writer lazily in `AbstractPipelineExt#dlq_writer`: a `DeadLetterQueueWriter` from `DeadLetterQueueFactory` when the DLQ is enabled, otherwise a `DummyDeadLetterQueueWriter` that ignores writes and reports itself closed ([[Pipeline Lifecycle]]).

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:384-413](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L384-L413), [logstash-core/src/main/java/org/logstash/common/AbstractDeadLetterQueueWriterExt.java:88-134](repo://logstash-core/src/main/java/org/logstash/common/AbstractDeadLetterQueueWriterExt.java#L88-L134)

`DeadLetterQueueFactory` keeps one writer per pipeline id in a static registry and creates it with a fixed segment size of 10 MiB. A pipeline that is being reloaded releases its writer on close so the new instance can take the directory lock. If the writer cannot be created, the factory logs "unable to create dead letter queue writer" and returns `null`.

Sources: [logstash-core/src/main/java/org/logstash/common/DeadLetterQueueFactory.java:55-135](repo://logstash-core/src/main/java/org/logstash/common/DeadLetterQueueFactory.java#L55-L135), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:442-449](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L442-L449)

Each plugin sees its own wrapper. `ExecutionContextFactoryExt#create` wraps the pipeline's writer in a `PluginDeadLetterQueueWriter` carrying the plugin's id and type, and puts it in the plugin's execution context. Ruby plugins call `execution_context.dlq_writer.write(event, reason)`; Java plugins get a `co.elastic.logstash.api.DeadLetterQueueWriter` from their `Context` through a `DLQWriterAdapter`, or a `NullDeadLetterQueueWriter` when the DLQ is off ([[Java Plugin API]]).

Sources: [logstash-core/src/main/java/org/logstash/plugins/factory/ExecutionContextFactoryExt.java:49-79](repo://logstash-core/src/main/java/org/logstash/plugins/factory/ExecutionContextFactoryExt.java#L49-L79), [logstash-core/src/main/java/org/logstash/common/AbstractDeadLetterQueueWriterExt.java:136-226](repo://logstash-core/src/main/java/org/logstash/common/AbstractDeadLetterQueueWriterExt.java#L136-L226)

Logstash core itself writes to the DLQ in one place: when a conditional fails to evaluate, the pipeline writes the event with plugin type and id `if-statement` ([[Compiled Pipeline Execution]]).

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:181-204](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L181-L204)

## Entries and files

A `DLQEntry` holds the event, the plugin type and id, the reason, and the time it was written. It serializes as five length-prefixed byte arrays: entry time, the event in CBOR (with metadata), plugin type, plugin id, reason.

Sources: [logstash-core/src/main/java/org/logstash/DLQEntry.java:49-114](repo://logstash-core/src/main/java/org/logstash/DLQEntry.java#L49-L114)

Segments are written in the RecordIO format. A file starts with a version byte `'1'` and is divided into 32 KiB blocks. Each record has a 13-byte header (type, size, total event size, checksum) followed by data. An entry that does not fit in the rest of a block is split into `START`, `MIDDLE` and `END` records; one that fits is a single `COMPLETE` record. Fixed blocks let a reader seek to any block boundary and resynchronise.

Sources: [logstash-core/src/main/java/org/logstash/common/io/RecordIOWriter.java:59-111](repo://logstash-core/src/main/java/org/logstash/common/io/RecordIOWriter.java#L59-L111)

| File | Meaning |
| --- | --- |
| `N.log.tmp` | The segment being written |
| `N.log` | A sealed segment, readable by the reader |
| `.lock` | Held by the writer |
| `dlq_reader.lock` | Held by a reader that deletes consumed segments |
| `.deleted_segment` | Notification from the reader that it removed segments |

Sources: [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java:130-136](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java#L130-L136), [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java:88-133](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java#L88-L133)

## The writer

On construction, `DeadLetterQueueWriter` takes the directory lock, computes the current size from existing segments, cleans up leftover `.tmp` files (deleting one whose sealed `.log` exists; otherwise sealing a valid one, deleting an empty one, and renaming an invalid one to `N.err`), finds the highest segment number, opens `N+1.log.tmp`, and starts a scheduled flush check and a file-system watcher.

Sources: [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java:290-321](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java#L290-L321), [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java:752-790](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java#L752-L790)

`writeEntry` runs under a lock and goes through these checks for every entry.

Sources: [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java:434-447](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java#L434-L447)

1. Skip an event that already carries `[@metadata][dead_letter_queue]`: it came from the DLQ and failed again, and writing it would loop. A warning "Event previously submitted to dead letter queue" is logged.
2. Apply age retention: delete the oldest segments while they are older than `retain.age`, counting their events as expired.
3. Apply the storage policy if the entry would exceed `max_bytes` (re-measuring the directory first, since a reader may have deleted segments). `drop_newer` drops this entry, counts it, and records the error; `drop_older` deletes the oldest segments until it fits.
4. Seal the current segment if the entry would push it past 10 MiB, and open the next one.
5. Append the record and add its size to the queue size.

Sources: [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java:449-552](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java#L449-L552), [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java:647-657](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java#L647-L657)

A segment is sealed by renaming `N.log.tmp` to `N.log` atomically, which is when readers can see it. Sealing happens when the segment is full, when the writer closes, and from the scheduled check when the segment has been written to but not for longer than `flush_interval`. Each scheduled check also re-applies age retention, so expired segments are removed even when nothing new is written.

Sources: [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java:109-128](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java#L109-L128), [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java:659-716](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java#L659-L716)

Every 3 seconds the watcher checks for a `.deleted_segment` file created by a cleaning reader; when it finds one, it deletes it and recomputes the queue size, so `max_bytes` accounting reflects consumed segments.

Sources: [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java:318-367](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueWriter.java#L318-L367)

## The reader

`DeadLetterQueueReader` is used by the `dead_letter_queue` input plugin, outside `logstash-core`'s pipeline code. It keeps a sorted set of sealed segments and watches the directory for created and deleted files.

Sources: [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java:81-133](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java#L81-L133)

| Method | Behaviour |
| --- | --- |
| `pollEntry(timeout)` | Return the next entry, moving to the next existing segment at end of file, or waiting up to `timeout` for new segments |
| `seekToNextEvent(timestamp)` | Position at the first entry written at or after a time |
| `setCurrentReaderAndPosition(segment, offset)` | Resume from a saved position (the input's sincedb) |
| `markForDelete()` | With clean-consumed on, delete segments fully read so far |

Sources: [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java:135-152](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java#L135-L152), [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java:217-277](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java#L217-L277), [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java:283-370](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java#L283-L370)

When created with `cleanConsumed`, the reader takes `dlq_reader.lock` so only one cleaning reader exists per queue, and requires a `SegmentListener`. `markForDelete` deletes the last consumed segment and any older ones, reports the counts to the listener, and writes the `.deleted_segment` notification for the writer. Segments that the writer removes for age or size disappear from under a reader; the reader detects deletions through its watcher and skips missing files.

Sources: [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java:283-318](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java#L283-L318), [logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java:372-420](repo://logstash-core/src/main/java/org/logstash/common/io/DeadLetterQueueReader.java#L372-L420)

## Metrics

The `DeadLetterQueue` periodic poller calls `collect_dlq_stats` on each running user pipeline ([[Periodic Pollers and System Monitors]]). With the DLQ enabled, the pipeline publishes `queue_size_in_bytes`, `storage_policy`, `max_queue_size_in_bytes`, `dropped_events`, `last_error` and `expired_events` under its `dlq` namespace (`stats.pipelines.<id>.dlq`).

Sources: [logstash-core/lib/logstash/instrument/periodic_poller/dlq.rb:18-35](repo://logstash-core/lib/logstash/instrument/periodic_poller/dlq.rb#L18-L35), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:456-479](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L456-L479)
