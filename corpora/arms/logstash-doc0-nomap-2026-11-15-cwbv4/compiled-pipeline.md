---
title: "Compiled Pipeline Execution"
---
## Overview

`CompiledPipeline` turns a [[Pipeline Intermediate Representation]] into something a worker thread can call once per batch. It does two jobs. At construction it instantiates every input, filter and output plugin named in the graph, through the plugin factory described on [[Plugin Registry and Factory]]. Then, for each worker, it compiles the part of the graph after the queue into a tree of `Dataset` objects: generated Java classes, compiled at runtime with Janino, in which each filter, output and `if` branch is one node. A worker hands a batch to the root of that tree and the events flow through the plugins and conditions without interpreting the graph again.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:62-139](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L62-L139)

## Building the plugins

The constructor opens a `ConfigVariableExpander` and calls `setupInputs`, `setupFilters` and `setupOutputs`. Each walks the plugin vertices of its type, expands `${VAR}` references in the arguments, converts them to a Ruby hash and asks the factory for an instance, passing the vertex's source metadata. Filters and outputs are stored by vertex id so the compiler can find the plugin for each vertex later; inputs are a plain collection. Any exception becomes `IllegalStateException("Unable to configure plugins: ...")`.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:121-139](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L121-L139), [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:176-237](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L176-L237)

`expandArguments` also builds codecs: an argument whose value is a `PluginStatement` (a nested `codec => json { ... }` block) is replaced by a codec instance built the same way, recursively.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:240-260](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L240-L260)

The `filters` and `outputs` collections it exposes are delegators (`AbstractFilterDelegatorExt`, `AbstractOutputDelegatorExt`) wrapping the plugins with metrics; `AbstractPipelineExt` copies them into the Ruby `inputs`, `filters` and `outputs` arrays that [[Pipeline Lifecycle]] registers and closes.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:141-151](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L141-L151), [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:220-249](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L220-L249)

## One execution per worker

`buildExecution(ordered)` returns a new `CompiledOrderedExecution` or `CompiledUnorderedExecution`. Each `CompiledExecution` holds per-thread state (the datasets buffer events), so every worker thread gets its own, built in parallel threads by `JavaPipeline#init_worker_loop` through `WorkerLoop`'s constructor ([[Worker Loop and Batches]]).

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:153-174](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L153-L174), [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:381-407](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L381-L407), [logstash-core/lib/logstash/java_pipeline.rb:588-615](repo://logstash-core/lib/logstash/java_pipeline.rb#L588-L615)

The constructor compiles two roots.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:409-437](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L409-L437), [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:171-242](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L171-L242)

- `compileFilters` finds the `SeparatorVertex` and compiles everything leading into it, ending in `DatasetCompiler.terminalFilterDataset`, which merges several parents into one result (or returns the single parent, or `Dataset.IDENTITY` when there are no filters).
- `compileOutputs` takes every leaf vertex that is an output, compiles each output's ancestry, and joins them with `terminalOutputDataset`. With no outputs it is `Dataset.IDENTITY`.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:409-437](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L409-L437), [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:171-242](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L171-L242)

## Walking the graph backwards

Compilation starts at a terminal vertex and recurses toward the queue. `flatten(datasets, start)` looks at the incoming vertices of `start` that are filters, outputs or ifs and compiles each with `compileDependencies`; when there are none (the vertex follows the queue directly), it returns the datasets passed in, which at the top are empty, meaning "read from the batch".

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:518-578](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L518-L578)

| Incoming vertex | Dataset built | Cache |
| --- | --- | --- |
| Filter | `DatasetCompiler.filterDataset(parents, filter)` | `plugins` map by vertex id |
| Output | `DatasetCompiler.outputDataset(parents, output, outputs.size() == 1)` | `plugins` map by vertex id |
| If | `DatasetCompiler.splitDataset(parents, condition, listener)`; the `true` side or `right()` (the `false` side) depending on which edge leads to `start` | `iffs` map by vertex id |

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:439-516](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L439-L516), [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:546-578](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L546-L578)

The caches make shared ancestry compile once: when two outputs follow the same filter, both output datasets get the same filter dataset as parent, and an `if` reached through both branches yields one `SplitDataset` whose two halves are reused.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:386-397](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L386-L397), [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:494-516](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L494-L516)

## The Dataset contract

A `Dataset` has two methods. `compute(batch, flush, shutdown)` returns the events after this step, computing them from its parents on the first call and returning the cached buffer on later calls in the same cycle. `clear()` empties the buffers of this node and its parents so the next batch starts fresh. `Dataset.IDENTITY` returns the batch unchanged.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/Dataset.java:27-75](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/Dataset.java#L27-L75)

The generated classes extend `BaseDataset`, which keeps a `done` flag. `withOutputBuffering` wraps every compute body as "if done return the buffer; run the body; set done; return the buffer", and every clear body as "if done, clear parents and buffer and reset done". This is what lets several children call `compute` on a shared parent without running its plugin twice.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:376-406](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L376-L406)

## What each generated node does

### Filters

A filter dataset first gathers its input: `withInputBuffering` calls `compute` on each parent and copies the non-cancelled events into an input buffer (or uses the batch when it has no parents). It then sets `plugin.id` in the Log4j `ThreadContext`, calls `plugin.multiFilter(input)` and appends the result to its output buffer. If the filter has a `flush` method, the generated code calls `flush` when `flushArg` is true; a filter that does not want periodic flushes is flushed only when both `flushArg` and `shutdownArg` are true, with `final => true` on shutdown.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:121-150](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L121-L150), [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:308-324](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L308-L324), [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:363-374](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L363-L374), [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:408-455](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L408-L455)

### Conditionals

A split dataset runs `Utils.filterEvents(input, condition, ifData, elseData)`, which puts each event in one of two lists. Its `compute` returns `ifData`; `right()` returns a `Complement` dataset reading `elseData`.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:58-119](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L58-L119), [logstash-core/src/main/java/org/logstash/config/ir/compiler/Utils.java:46-64](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/Utils.java#L46-L64)

### Outputs

An output dataset gathers its input the same way, sets `plugin.id`, and calls `outputDelegator.multiReceive(events)`. Its `compute` returns nothing. When the pipeline has a single output, the dataset is terminal and clears its parents right after sending, so filter buffers are released before the next batch instead of at the next `clear`.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:244-306](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L244-L306)

## Conditions

`EventCondition.Compiler.buildCondition` turns a `BooleanExpression` into an `EventCondition` with a single `fulfilled(event)` method. It handles `Eq`, `Neq` (as `not(eq)`), `RegexEq`, `In`, `And`, `Or`, `Not`, `Truthy` and the four comparisons, choosing specialised classes by operand shape (field vs constant, constant string vs list): for example `FieldInConstantList`, `ConstantStringInField`, `FieldMatches`. A comparison with the constant on the left uses the converse predicate. Compiled conditions are cached by their Ruby-string form under a global lock, so identical conditions share one object.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/EventCondition.java:67-171](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/EventCondition.java#L67-L171), [logstash-core/src/main/java/org/logstash/config/ir/compiler/EventCondition.java:252-310](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/EventCondition.java#L252-L310)

## When a condition fails to evaluate

If evaluating a condition throws a Ruby `TypeError` or `ArgumentError`, or an `IllegalArgumentException` (comparing a string field with a number, for instance), `filterEvents` cancels the event and throws `ConditionalEvaluationError`. The generated split code catches it, marks itself done, notifies the pipeline's `ConditionalEvaluationListener` and returns what it has so far.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/Utils.java:46-64](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/Utils.java#L46-L64), [logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java:84-106](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/DatasetCompiler.java#L84-L106)

The pipeline's `LogErrorEvaluationListener` logs a warning, logs the event at debug level, and writes the event to the [[Dead Letter Queue]] with plugin type and id `if-statement` when the DLQ is enabled; otherwise the event is dropped.

Sources: [logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java:177-208](repo://logstash-core/src/main/java/org/logstash/execution/AbstractPipelineExt.java#L177-L208)

## Ordered and unordered runs

`CompiledUnorderedExecution.compute` sends the whole batch to the filter root, copies the non-cancelled results to an output batch, clears the filters and sends the batch to the outputs. `CompiledOrderedExecution.compute` sends events through the filters one at a time as single-element batches, appending each result to the output batch, then calls the outputs once. When the batch is empty but `flush` or `shutdown` is set, it still runs the filters once with an empty batch so flushable filters can emit. Both return the number of events sent to outputs, which can differ from the batch size when filters drop or clone events.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java:317-379](repo://logstash-core/src/main/java/org/logstash/config/ir/CompiledPipeline.java#L317-L379)

## Code generation and the class cache

`ComputeStepSyntaxElement` is the source code of one dataset class, built from `SyntaxFactory` elements and fields declared in `ClassFields` (plugins, buffers, parents and conditions are passed into the constructor as a map). Its source is generated with a placeholder class name and formatted, and that normalised source is its `equals`/`hashCode` key. `instantiate` looks the source up in a static `CLASS_CACHE`; only a miss compiles the code with a thread-local Janino `SimpleCompiler` into `org.logstash.generated.CompiledDatasetN`. Since every worker generates identical source, a pipeline with eight workers compiles each class once.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/ComputeStepSyntaxElement.java:48-129](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/ComputeStepSyntaxElement.java#L48-L129), [logstash-core/src/main/java/org/logstash/config/ir/compiler/ComputeStepSyntaxElement.java:139-191](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/ComputeStepSyntaxElement.java#L139-L191)

> [!TIP]
> Setting the Janino source-debugging system property (the one named by `Scanner.SYSTEM_PROPERTY_SOURCE_DEBUGGING_DIR`) makes `ComputeStepSyntaxElement` write each generated class to `org/logstash/generated/` under that directory before compiling it, which lets a debugger step through the generated code.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/compiler/ComputeStepSyntaxElement.java:145-151](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/ComputeStepSyntaxElement.java#L145-L151), [logstash-core/src/main/java/org/logstash/config/ir/compiler/ComputeStepSyntaxElement.java:193-200](repo://logstash-core/src/main/java/org/logstash/config/ir/compiler/ComputeStepSyntaxElement.java#L193-L200)

Deep configurations produce deep recursion while compiling; a `StackOverflowError` during worker initialisation is logged with the advice to raise the thread stack size with `-Xss`.

Sources: [logstash-core/lib/logstash/java_pipeline.rb:604-614](repo://logstash-core/lib/logstash/java_pipeline.rb#L604-L614)
