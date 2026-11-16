---
title: "Java Plugin API"
---
## Overview

Plugins can be written in Java instead of Ruby against the stable interfaces in the `co.elastic.logstash.api` package. A Java plugin is a class annotated with `@LogstashPlugin(name = "...")` that implements `Input`, `Filter`, `Output` or `Codec`, declares its options as `PluginConfigSpec` objects, and has a constructor taking its id, a `Configuration` and a `Context`. Logstash wraps it in a delegator so the pipeline treats it like a Ruby plugin. This page covers the interfaces and the core classes that implement the plugin's side of the contract; how the class is discovered by name is on [[Plugin Registry and Factory]], and examples shipped in core are on [[Built-in Java Plugins]].

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/Plugin.java:28-54](repo://logstash-core/src/main/java/co/elastic/logstash/api/Plugin.java#L28-L54), [logstash-core/src/main/java/co/elastic/logstash/api/LogstashPlugin.java:28-40](repo://logstash-core/src/main/java/co/elastic/logstash/api/LogstashPlugin.java#L28-L40), [logstash-core/src/main/java/org/logstash/plugins/factory/AbstractPluginCreator.java:16-45](repo://logstash-core/src/main/java/org/logstash/plugins/factory/AbstractPluginCreator.java#L16-L45)

## The plugin interfaces

Every plugin implements `Plugin`: `configSchema()` returns the accepted options, `getId()` returns the id passed to the constructor, and `getName()` defaults to the annotation's `name`.

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/Plugin.java:28-54](repo://logstash-core/src/main/java/co/elastic/logstash/api/Plugin.java#L28-L54)

| Interface | Methods | Called |
| --- | --- | --- |
| `Input` | `start(Consumer<Map> writer)`, `stop()`, `awaitStop()` | `start` on its own thread; push events by calling `writer.accept(map)` until stopped |
| `Filter` | `filter(Collection<Event>, FilterMatchListener)`, optional `flush`, `requiresFlush`, `requiresPeriodicFlush`, `close` | Once per batch by each worker |
| `Output` | `output(Collection<Event>)`, `stop()`, `awaitStop()` | Once per batch by each worker |
| `Codec` | `decode(ByteBuffer, Consumer<Map>)`, `flush(ByteBuffer, Consumer<Map>)`, `encode(Event, OutputStream)`, `cloneCodec()` | By inputs and outputs that use the codec |

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/Input.java:39-63](repo://logstash-core/src/main/java/co/elastic/logstash/api/Input.java#L39-L63), [logstash-core/src/main/java/co/elastic/logstash/api/Filter.java:42-95](repo://logstash-core/src/main/java/co/elastic/logstash/api/Filter.java#L42-L95), [logstash-core/src/main/java/co/elastic/logstash/api/Output.java:29-51](repo://logstash-core/src/main/java/co/elastic/logstash/api/Output.java#L29-L51), [logstash-core/src/main/java/co/elastic/logstash/api/Codec.java:33-82](repo://logstash-core/src/main/java/co/elastic/logstash/api/Codec.java#L33-L82)

A filter returns the events that continue down the pipeline, so it can drop events by leaving them out or add new ones; for each event it handled successfully it calls `matchListener.filterMatched(event)`. Inputs and codecs produce plain `Map`s, and Logstash builds events from them.

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/FilterMatchListener.java:23-30](repo://logstash-core/src/main/java/co/elastic/logstash/api/FilterMatchListener.java#L23-L30), [logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaFilterDelegatorExt.java:75-87](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaFilterDelegatorExt.java#L75-L87)

## Declaring options

`PluginConfigSpec<T>` describes one option: name, Java type, default, and whether it is deprecated or required. Static factories create the common kinds.

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/PluginConfigSpec.java:30-67](repo://logstash-core/src/main/java/co/elastic/logstash/api/PluginConfigSpec.java#L30-L67)

| Factory | Type |
| --- | --- |
| `stringSetting`, `requiredStringSetting` | `String` |
| `numSetting` | `Long` |
| `floatSetting` | `Double` |
| `booleanSetting`, `requiredBooleanSetting` | `Boolean` |
| `hashSetting` | `Map<String, Object>` |
| `arraySetting` | `List<Object>` |
| `codecSetting` | `Codec` (default given by name) |
| `uriSetting` | `URI` |
| `passwordSetting` | `Password` |

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/PluginConfigSpec.java:69-127](repo://logstash-core/src/main/java/co/elastic/logstash/api/PluginConfigSpec.java#L69-L127), [logstash-core/src/main/java/co/elastic/logstash/api/PluginConfigSpec.java:129-197](repo://logstash-core/src/main/java/co/elastic/logstash/api/PluginConfigSpec.java#L129-L197)

`PluginHelper` defines the options every plugin of a kind should accept and merges them into a plugin's own schema with `commonInputSettings(mine)`, `commonFilterSettings(mine)` or `commonOutputSettings(mine)`. Inputs get `add_field`, `enable_metric`, `codec`, `id`, `tags`, `type`; outputs get `enable_metric`, `codec`, `id`; filters get the decoration options `add_field`, `add_tag`, `remove_field`, `remove_tag`, plus `enable_metric`, `id` and `periodic_flush`.

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/PluginHelper.java:30-125](repo://logstash-core/src/main/java/co/elastic/logstash/api/PluginHelper.java#L30-L125)

## Construction and validation

`AbstractPluginCreator.instantiateAndValidate` finds the constructor `(String id, Configuration config, Context context)`, wraps the parsed arguments in a `ConfigurationImpl`, calls the constructor, and then validates. Constructor exceptions are unwrapped and rethrown as `IllegalStateException`.

Sources: [logstash-core/src/main/java/org/logstash/plugins/factory/AbstractPluginCreator.java:24-44](repo://logstash-core/src/main/java/org/logstash/plugins/factory/AbstractPluginCreator.java#L24-L44)

`PluginUtil.validateConfig` compares the provided keys with `configSchema()`. It logs "Unknown setting '...' specified for plugin '...'" for each key not in the schema and "Required setting '...' not specified" for each missing required option, then throws "Config errors found for plugin".

Sources: [logstash-core/src/main/java/org/logstash/plugins/PluginUtil.java:45-80](repo://logstash-core/src/main/java/org/logstash/plugins/PluginUtil.java#L45-L80)

Before a class is used, `PluginValidator.validatePlugin` checks that it has every method of its API interface with the same name, return type and parameter types. A plugin compiled against an older or newer API that lacks a method fails here rather than at runtime.

Sources: [logstash-core/src/main/java/org/logstash/plugins/PluginValidator.java:31-77](repo://logstash-core/src/main/java/org/logstash/plugins/PluginValidator.java#L31-L77)

## Reading configuration

`Configuration.get(spec)` returns the typed value: the provided value when its type matches, otherwise a conversion, otherwise the spec's default. `getRawValue`, `contains` and `allKeys` give access to the raw map.

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/Configuration.java:28-57](repo://logstash-core/src/main/java/co/elastic/logstash/api/Configuration.java#L28-L57)

`ConfigurationImpl` converts provided values to the declared type, as the table shows.

Sources: [logstash-core/src/main/java/org/logstash/plugins/ConfigurationImpl.java:60-110](repo://logstash-core/src/main/java/org/logstash/plugins/ConfigurationImpl.java#L60-L110)

| Declared type | Provided value | Result |
| --- | --- | --- |
| `Double` | `Long` | Widened to double |
| `Boolean` | `String` | `Boolean.parseBoolean` |
| `Codec` | `String` codec name | Codec built by the plugin factory |
| `Codec` | Ruby codec object | Ruby codec wrapped as a Java `Codec` |
| `URI` | `String` | `new URI(...)`, error on bad syntax |
| `Password` | `String` | `new Password(...)` |
| any | incompatible | `IllegalStateException` naming the option and both types |

Sources: [logstash-core/src/main/java/org/logstash/plugins/ConfigurationImpl.java:60-110](repo://logstash-core/src/main/java/org/logstash/plugins/ConfigurationImpl.java#L60-L110)

Defaults given as strings for `Codec`, `URI` and `Password` options are converted the same way when the option is absent. `${VAR}` references in values were already expanded by `CompiledPipeline` before the plugin was built ([[Secret Store and Variable Substitution]]).

Sources: [logstash-core/src/main/java/org/logstash/plugins/ConfigurationImpl.java:93-109](repo://logstash-core/src/main/java/org/logstash/plugins/ConfigurationImpl.java#L93-L109), [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:240-260](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L240-L260)

## The Context

`Context` hands a plugin the services it may use.

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/Context.java:28-65](repo://logstash-core/src/main/java/co/elastic/logstash/api/Context.java#L28-L65)

| Method | `ContextImpl` returns |
| --- | --- |
| `getDlqWriter()` | The pipeline's DLQ writer, or a null writer when the DLQ is off ([[Dead Letter Queue]]) |
| `getMetric(plugin)` | A `NamespacedMetric` under `stats.pipelines.<id>.plugins.<type>.<plugin id>` ([[Metrics System]]) |
| `getLogger(plugin)` | A Log4j logger named after the plugin class |
| `getDeprecationLogger(plugin)` | A `DefaultDeprecationLogger` for that logger |
| `getEventFactory()` | `BasicEventFactory.INSTANCE` |

Sources: [logstash-core/src/main/java/org/logstash/plugins/ContextImpl.java:31-69](repo://logstash-core/src/main/java/org/logstash/plugins/ContextImpl.java#L31-L69), [logstash-core/src/main/java/org/logstash/plugins/factory/ExecutionContextFactoryExt.java:63-79](repo://logstash-core/src/main/java/org/logstash/plugins/factory/ExecutionContextFactoryExt.java#L63-L79)

## How the pipeline drives a Java plugin

Java plugins are wrapped in delegators that present the Ruby plugin interface to the pipeline.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaInputDelegatorExt.java:43-147](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaInputDelegatorExt.java#L43-L147)

`JavaInputDelegatorExt.start` gets a `QueueWriter` for the input and starts a thread named `<pipeline>_<name>_<id>` that calls `input.start(queueWriter::push)`, with `pipeline.id` and `plugin.id` in the Log4j context. When the input config has `add_field` or `type`, a `DecoratingQueueWriter` applies them to each map before it is pushed. `do_stop` calls `stop()` and then `awaitStop()`. Java inputs report themselves as not threadable, reloadable, and needing no `register` step.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaInputDelegatorExt.java:72-189](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaInputDelegatorExt.java#L72-L189)

`JavaFilterDelegatorExt` unwraps the Ruby events into `Event`s, calls `filter`, and wraps the results. Its `FilterMatchListener` applies the filter's `add_field`, `add_tag`, `remove_field` and `remove_tag` options when the plugin calls `filterMatched`; with none of them configured it is a no-op. It flushes only when `requiresFlush()` is true, and periodically only when `requiresPeriodicFlush()` is true. Java filters are always treated as thread-safe and reloadable.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaFilterDelegatorExt.java:75-184](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaFilterDelegatorExt.java#L75-L184), [logstash-core/src/main/java/org/logstash/config/ir/compiler/CommonActions.java:48-80](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/CommonActions.java#L48-L80)

`JavaOutputDelegatorExt` converts each batch to Java events and calls `output`; closing the output calls `stop()`.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaOutputDelegatorExt.java:85-101](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/JavaOutputDelegatorExt.java#L85-L101)

## The Event interface

Java plugins see events through `co.elastic.logstash.api.Event`, implemented by `org.logstash.Event`: `getField`, `getUnconvertedField`, `setField`, `includes`, `remove`, `getData`, `getMetadata`, `getEventTimestamp`, `setEventTimestamp`, `sprintf`, `tag`, `cancel`, `uncancel`, `isCancelled`, `clone`, `overwrite`, `append` and `toMap`. Values come back as plain Java objects ([[Event Model]]).

Sources: [logstash-core/src/main/java/co/elastic/logstash/api/Event.java:31-69](repo://logstash-core/src/main/java/co/elastic/logstash/api/Event.java#L31-L69), [logstash-core/src/main/java/org/logstash/Event.java:132-206](repo://logstash-core/src/main/java/org/logstash/Event.java#L132-L206)
