---
title: "Built-in Java Plugins"
---
## Overview

`logstash-core` ships a handful of plugins written against the [[Java Plugin API]] in the `org.logstash.plugins` package. They are discovered by the Java `PluginRegistry` classpath scan, so they are always available without installing a gem ([[Plugin Registry and Factory]]). Most carry a `java_` prefix in their names so they do not shadow the Ruby plugins of the same purpose (`stdin`, `stdout`, `generator`, `uuid`, `line`, `plain`), which come from separate gems. They are useful as small, dependency-free inputs and outputs for testing and benchmarking, and as reference implementations of the API. Two Ruby plugins are also built in: the `pipeline` input and output described on [[Pipeline-to-Pipeline Communication]].

Sources: [logstash-core/src/main/java/org/logstash/plugins/discovery/PluginRegistry.java:81-118](repo://logstash-core/src/main/java/org/logstash/plugins/discovery/PluginRegistry.java#L81-L118), [logstash-core/lib/logstash/plugins/builtin.rb:18-24](repo://logstash-core/lib/logstash/plugins/builtin.rb#L18-L24)

| Name | Kind | Class | Use it for |
| --- | --- | --- | --- |
| `java_generator` | input | `inputs.Generator` | Synthetic events for tests and load generation |
| `java_stdin` | input | `inputs.Stdin` | Reading lines from standard input |
| `java_uuid` | filter | `filters.Uuid` | Adding a random UUID to each event |
| `java_stdout` | output | `outputs.Stdout` | Printing events to standard output |
| `sink` | output | `outputs.Sink` | Discarding events, e.g. to benchmark inputs and filters |
| `java_line` | codec | `codecs.Line` | Delimiter-separated text in and out |
| `java_plain` | codec | `codecs.Plain` | Raw text in, formatted text out |
| `jdots` | codec | `codecs.Dots` | One `.` per event, as a progress indicator |

Sources: [logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java:48-60](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java#L48-L60), [logstash-core/src/main/java/org/logstash/plugins/inputs/Stdin.java:49-57](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Stdin.java#L49-L57), [logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java:39-46](repo://logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java#L39-L46), [logstash-core/src/main/java/org/logstash/plugins/outputs/Stdout.java:41-45](repo://logstash-core/src/main/java/org/logstash/plugins/outputs/Stdout.java#L41-L45), [logstash-core/src/main/java/org/logstash/plugins/outputs/Sink.java:36-37](repo://logstash-core/src/main/java/org/logstash/plugins/outputs/Sink.java#L36-L37), [logstash-core/src/main/java/org/logstash/plugins/codecs/Line.java:52-64](repo://logstash-core/src/main/java/org/logstash/plugins/codecs/Line.java#L52-L64), [logstash-core/src/main/java/org/logstash/plugins/codecs/Plain.java:49-56](repo://logstash-core/src/main/java/org/logstash/plugins/codecs/Plain.java#L49-L56), [logstash-core/src/main/java/org/logstash/plugins/codecs/Dots.java:42-47](repo://logstash-core/src/main/java/org/logstash/plugins/codecs/Dots.java#L42-L47)

## Inputs

### java_generator

| Option | Type | Default |
| --- | --- | --- |
| `count` | number | `0` (unlimited) |
| `message` | string | `Hello world!` |
| `lines` | array | none; overrides `message` |
| `threads` | number | `1`; must be at least 1 |
| `eps` | float | `0` (unthrottled) |

Sources: [logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java:51-111](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java#L51-L111), [logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java:210-215](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java#L210-L215)

Plus the common input options (`add_field`, `codec`, `id`, `tags`, `type`, `enable_metric`).

Sources: [logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java:51-111](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java#L51-L111), [logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java:210-215](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java#L210-L215)

Each thread emits events with `hostname`, `thread_number`, `sequence` and `message`. With `lines`, a thread cycles through the lines and increments `sequence` after each full round, so `count` counts rounds, not events. Without `eps` the first thread runs on the input thread and the others on new threads named `generator_<id>_<n>`, as fast as the queue accepts. With `eps`, a scheduled executor emits one event per thread every `1000 / eps` milliseconds. The input ends when every thread has reached `count`, which lets a test pipeline terminate by itself ([[Pipeline Lifecycle]]).

Sources: [logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java:113-198](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java#L113-L198)

### java_stdin

`java_stdin` reads standard input through a `FileChannel` in 64 KiB chunks and passes each chunk to its codec (default `java_line`), adding `hostname` to events that lack it. `stop` closes the channel, which interrupts a blocked read; at end of input or on stop it flushes the codec so a final line without a trailing delimiter is still emitted. A read error stops the input with an `IllegalStateException`.

Sources: [logstash-core/src/main/java/org/logstash/plugins/inputs/Stdin.java:54-144](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Stdin.java#L54-L144)

## Filter: java_uuid

| Option | Type | Default |
| --- | --- | --- |
| `target` | string, required | Field to write the UUID to |
| `overwrite` | boolean | `false` |

Sources: [logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java:39-80](repo://logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java#L39-L80)

Plus the common filter options (`add_field`, `add_tag`, `remove_field`, `remove_tag`, `id`, `enable_metric`, `periodic_flush`).

Sources: [logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java:39-80](repo://logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java#L39-L80)

For every event it sets `target` to a random UUID unless the field exists and `overwrite` is false, then calls `filterMatched`, so the common decorations apply to every event.

Sources: [logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java:65-74](repo://logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java#L65-L74)

## Outputs

### java_stdout

`java_stdout` encodes each event with its codec (default `java_line`) straight to `System.out`. Its only own option is `codec`, merged with the common output options. `stop` releases `awaitStop`.

Sources: [logstash-core/src/main/java/org/logstash/plugins/outputs/Stdout.java:41-97](repo://logstash-core/src/main/java/org/logstash/plugins/outputs/Stdout.java#L41-L97)

### sink

`sink` accepts batches and does nothing with them, and its `stop` and `awaitStop` return immediately. Pointing a pipeline at `sink` measures everything up to the output without output cost.

Sources: [logstash-core/src/main/java/org/logstash/plugins/outputs/Sink.java:36-69](repo://logstash-core/src/main/java/org/logstash/plugins/outputs/Sink.java#L36-L69)

## Codecs

### java_line

| Option | Default |
| --- | --- |
| `charset` | `UTF-8` |
| `delimiter` | the platform line separator |
| `format` | none |

Sources: [logstash-core/src/main/java/org/logstash/plugins/codecs/Line.java:52-68](repo://logstash-core/src/main/java/org/logstash/plugins/codecs/Line.java#L52-L68), [logstash-core/src/main/java/org/logstash/plugins/codecs/Line.java:169-173](repo://logstash-core/src/main/java/org/logstash/plugins/codecs/Line.java#L169-L173)

Decoding splits the text on `delimiter` into one `message` per line, keeping an incomplete trailing line as a remainder until more data arrives; malformed bytes for the charset are ignored. `flush` emits the remainder. Encoding writes the event's data as JSON, or `format` expanded with `sprintf` when set, followed by the delimiter ([[Field References and String Interpolation]]).

Sources: [logstash-core/src/main/java/org/logstash/plugins/codecs/Line.java:100-167](repo://logstash-core/src/main/java/org/logstash/plugins/codecs/Line.java#L100-L167)

### java_plain

`java_plain` takes `charset` and `format`. Decoding turns each whole buffer into one event's `message`, without splitting. Encoding writes `event.toString()` (timestamp, host and message) or the expanded `format`, with no delimiter.

Sources: [logstash-core/src/main/java/org/logstash/plugins/codecs/Plain.java:49-131](repo://logstash-core/src/main/java/org/logstash/plugins/codecs/Plain.java#L49-L131)

### jdots

`jdots` has no options. Encoding writes a single `.` per event and flushes the stream; decoding raises `UnsupportedOperationException`, so it can only be used on outputs.

Sources: [logstash-core/src/main/java/org/logstash/plugins/codecs/Dots.java:42-83](repo://logstash-core/src/main/java/org/logstash/plugins/codecs/Dots.java#L42-L83)

## Example

```text
input  { java_generator { count => 1000000 threads => 2 } }
filter { java_uuid { target => "uuid" } }
output { sink { } }
```

Sources: [logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java:51-60](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java#L51-L60), [logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java:42-46](repo://logstash-core/src/main/java/org/logstash/plugins/filters/Uuid.java#L42-L46), [logstash-core/src/main/java/org/logstash/plugins/outputs/Sink.java:36-49](repo://logstash-core/src/main/java/org/logstash/plugins/outputs/Sink.java#L36-L49)

This pipeline produces two million events (one million per thread), adds a UUID to each, and discards them, measuring generation and filtering throughput with no I/O.

Sources: [logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java:184-198](repo://logstash-core/src/main/java/org/logstash/plugins/inputs/Generator.java#L184-L198)
