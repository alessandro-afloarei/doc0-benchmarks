---
title: "Logging"
---
## Overview

Logstash logs through Log4j2, from both Java and Ruby. Ruby classes get a logger by including `LogStash::Util::Loggable`, implemented in Java so that a Ruby call such as `logger.info("Pipeline started", "pipeline.id" => id)` becomes a Log4j event with structured key/value data. The configuration file `config/log4j2.properties` defines plain and JSON outputs to the console and rolling files, a separate slow log and deprecation log, and optional per-pipeline log files. Settings in `logstash.yml` choose the format, level and directory, and the [[Monitoring API]] can change levels at runtime.

Sources: [config/log4j2.properties:1-82](repo://config/log4j2.properties#L1-L82), [config/log4j2.properties:128-165](repo://config/log4j2.properties#L128-L165), [logstash-core/src/main/java/org/logstash/log/LoggableExt.java:40-110](repo://logstash-core/src/main/java/org/logstash/log/LoggableExt.java#L40-L110)

## Configuration at startup

The Log4j factories are installed through `log4j2.component.properties` on the classpath: `LogstashLogEventFactory` and `LogstashMessageFactory`. A settings post-process callback then copies `path.logs`, `log.format`, `log.level`, `pipeline.separate_logs` and `log.format.json.fix_duplicate_message_fields` into the `ls.*` system properties that the configuration file references, and reconfigures Log4j from `log4j2.properties` in `path.settings` unless `-Dlog4j.configurationFile` was given ([[Settings and logstash.yml]]).

Sources: [logstash-core/src/main/resources/log4j2.component.properties:1-2](repo://logstash-core/src/main/resources/log4j2.component.properties#L1-L2), [logstash-core/lib/logstash/environment.rb:117-134](repo://logstash-core/lib/logstash/environment.rb#L117-L134)

`LoggerExt.reconfigure` (also `initialize`) points the `LoggerContext` at that file and prints "Sending Logstash logs to ... which is now configured via log4j2.properties", or, if the file is missing, a message that the default console configuration is used. The runner refuses to start when the configuration uses a JavaScript script appender or filter.

Sources: [logstash-core/src/main/java/org/logstash/log/LoggerExt.java:171-201](repo://logstash-core/src/main/java/org/logstash/log/LoggerExt.java#L171-L201), [logstash-core/lib/logstash/runner.rb:268-271](repo://logstash-core/lib/logstash/runner.rb#L268-L271)

## Appenders in the shipped configuration

| Appender | Output |
| --- | --- |
| `plain_console` / `json_console` | Standard output, pattern or JSON layout |
| `plain_rolling` / `json_rolling` | `logstash-plain.log` / `logstash-json.log` in `path.logs`, rolled daily and at 100 MB, compressed, kept up to 30 files and 7 days |
| `pipeline_routing_appender` | `pipeline_<id>.log` per pipeline, with the same rolling rules |
| `*_console_slowlog` / `*_rolling_slowlog` | Slow log to console and `logstash-slowlog-plain.log` / `-json.log` |
| `deprecation_plain_rolling` | `logstash-deprecation.log` |

Sources: [config/log4j2.properties:3-76](repo://config/log4j2.properties#L3-L76), [config/log4j2.properties:86-160](repo://config/log4j2.properties#L86-L160)

The root logger's level is `${sys:ls.log.level}` and its console and file appenders are chosen by name from `${sys:ls.log.format}`, so `--log.format json` switches both to the JSON variants. The plain pattern prints the time, level, logger name, and, when present in the thread context, `[pipeline.id]` and `[plugin.id]`. Separate loggers send `slowlog` and the `deprecation` hierarchies to their own files without passing them to the root (`additivity = false`); the license reader logs only errors and the Apache HTTP client only fatal messages.

Sources: [config/log4j2.properties:79-82](repo://config/log4j2.properties#L79-L82), [config/log4j2.properties:128-165](repo://config/log4j2.properties#L128-L165)

## Per-pipeline log files

Every pipeline thread puts `pipeline.id` into the Log4j `ThreadContext` ([[Pipeline Lifecycle]]). With `pipeline.separate_logs: true`, `PipelineRoutingAppender` reads that value from each event, creates (once, under a lock) a child appender from its template for that id, and forwards the event to it. Events without a `pipeline.id` are skipped, which avoids a file literally named `pipeline_${ctx:pipeline.id}.log`.

Sources: [logstash-core/src/main/java/org/logstash/log/PipelineRoutingAppender.java:43-159](repo://logstash-core/src/main/java/org/logstash/log/PipelineRoutingAppender.java#L43-L159)

At the same time the `PipelineRoutingFilter` on the main rolling appenders denies events that carry a `pipeline.id`, so a pipeline's messages appear in its own file and not in `logstash-plain.log`. When separate logs are off, `LogstashConfigurationFactory` removes the routing appender from the configuration altogether.

Sources: [logstash-core/src/main/java/org/logstash/log/PipelineRoutingFilter.java:30-50](repo://logstash-core/src/main/java/org/logstash/log/PipelineRoutingFilter.java#L30-L50), [logstash-core/src/main/java/org/logstash/log/LogstashConfigurationFactory.java:40-74](repo://logstash-core/src/main/java/org/logstash/log/LogstashConfigurationFactory.java#L40-L74)

## Loggers in Ruby code

`include LogStash::Util::Loggable` gives a class and its instances `logger`, `slow_logger` and `deprecation_logger`. The logger is created once per class and cached in an instance variable of the class; its name is the class name with `::` turned into `.` and lower-cased, so `LogStash::Outputs::Elasticsearch` logs as `logstash.outputs.elasticsearch`, the name used by `PUT /_node/logging`.

Sources: [logstash-core/src/main/java/org/logstash/log/LoggableExt.java:40-143](repo://logstash-core/src/main/java/org/logstash/log/LoggableExt.java#L40-L143)

`LoggerExt` wraps a Log4j `Logger`: `debug?`, `info?` and the other predicates, and `trace`, `debug`, `info`, `warn`, `error`, `fatal`, each taking a message and an optional hash of data. `configure_logging(level, path)` sets the level of one logger, or the root logger when no path is given, and raises "invalid level" for a bad value.

Sources: [logstash-core/src/main/java/org/logstash/log/LoggerExt.java:46-152](repo://logstash-core/src/main/java/org/logstash/log/LoggerExt.java#L46-L152), [logstash-core/src/main/java/org/logstash/log/LoggerExt.java:154-169](repo://logstash-core/src/main/java/org/logstash/log/LoggerExt.java#L154-L169)

`logstash/logging/logger.rb` is now an empty compatibility file; the classes come from Java.

Sources: [logstash-core/lib/logstash/logging/logger.rb:18-18](repo://logstash-core/lib/logstash/logging/logger.rb#L18-L18)

## Structured messages and JSON output

`LogstashMessageFactory` turns a message with a single `Map` parameter (which is what a Ruby call with a hash produces) into a `StructuredMessage` holding the text and the map; other parameter lists become ordinary parameterized messages. `StructuredMessage` also accepts alternating key/value parameters and rejects an odd count with "must log key-value pairs".

Sources: [logstash-core/src/main/java/org/logstash/log/LogstashMessageFactory.java:36-66](repo://logstash-core/src/main/java/org/logstash/log/LogstashMessageFactory.java#L36-L66), [logstash-core/src/main/java/org/logstash/log/StructuredMessage.java:32-66](repo://logstash-core/src/main/java/org/logstash/log/StructuredMessage.java#L32-L66)

In JSON layout, `CustomLogEventSerializer` writes `level`, `loggerName`, `timeMillis`, `thread`, and a `logEvent` object holding `message` and each data key as its own field. Simple values are written directly; other values go through a separate generator with Logstash's Ruby-aware mapper, falling back to `toString()` if serialization fails, so one bad value cannot corrupt the line. A data key named `message` would collide with the text; with `log.format.json.fix_duplicate_message_fields` (default true) it is renamed `message_1`.

Sources: [logstash-core/src/main/java/org/logstash/log/CustomLogEventSerializer.java:40-120](repo://logstash-core/src/main/java/org/logstash/log/CustomLogEventSerializer.java#L40-L120), [logstash-core/lib/logstash/environment.rb:66-67](repo://logstash-core/lib/logstash/environment.rb#L66-L67)

## Slow log

Every plugin creates a `SlowLogger` from the four `slowlog.threshold.*` settings (each a time value, `-1` meaning off), using the logger `slowlog.<class name>`. Filters time each `filter` call and report it with `on_event`; the slow logger logs at the most severe level whose threshold the duration exceeds, with `plugin_params`, `took_in_nanos`, `took_in_millis` and the event as JSON.

Sources: [logstash-core/src/main/java/org/logstash/log/SlowLoggerExt.java:40-116](repo://logstash-core/src/main/java/org/logstash/log/SlowLoggerExt.java#L40-L116), [logstash-core/lib/logstash/plugin.rb:68-81](repo://logstash-core/lib/logstash/plugin.rb#L68-L81), [logstash-core/lib/logstash/filters/base.rb:155-160](repo://logstash-core/lib/logstash/filters/base.rb#L155-L160)

## Deprecation log

`deprecation_logger.deprecated(message, data)` writes through a `DefaultDeprecationLogger` whose name is the class's logger name prefixed with `deprecation.` (or with `org.logstash.` turned into `org.logstash.deprecation.` for Java classes). Those names match the `deprecation` loggers in the configuration, so deprecations land in their own file at `WARN` level. Java plugins get the same logger through `Context.getDeprecationLogger` ([[Java Plugin API]]).

Sources: [logstash-core/src/main/java/org/logstash/log/DeprecationLoggerExt.java:40-70](repo://logstash-core/src/main/java/org/logstash/log/DeprecationLoggerExt.java#L40-L70), [logstash-core/src/main/java/org/logstash/log/DefaultDeprecationLogger.java:32-62](repo://logstash-core/src/main/java/org/logstash/log/DefaultDeprecationLogger.java#L32-L62), [config/log4j2.properties:157-165](repo://config/log4j2.properties#L157-L165)

## Changing levels at runtime

`PUT /_node/logging` with `{"logger.<name>": "DEBUG"}` calls `configure_logging` for each key; `GET /_node/logging` lists current levels; `PUT /_node/logging/reset` reloads the configuration file, restoring its levels ([[Monitoring API]]).

Sources: [logstash-core/lib/logstash/api/modules/logging.rb:24-80](repo://logstash-core/lib/logstash/api/modules/logging.rb#L24-L80)
