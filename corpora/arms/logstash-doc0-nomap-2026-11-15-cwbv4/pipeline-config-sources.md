---
title: "Pipeline Configuration Sources"
---
## Overview

Before the agent can run a pipeline it needs a `PipelineConfig`: a pipeline id, the configuration text split into parts with their origin, and the settings for that pipeline. Config sources produce these objects. The runner registers two local sources: `Source::Local` for `-e` and `-f` (one pipeline), and `Source::MultiLocal` for `pipelines.yml` (any number). X-pack can add an Elasticsearch-backed source, covered in [[Centralized Pipeline Management]]. `SourceLoader` asks every matching source for its configs each time the agent converges, which is how [[Agent and Pipeline Convergence]] notices a changed file.

Sources: [logstash-core/lib/logstash/runner.rb:242-252](repo://logstash-core/lib/logstash/runner.rb#L242-L252), [logstash-core/lib/logstash/config/source_loader.rb:51-100](repo://logstash-core/lib/logstash/config/source_loader.rb#L51-L100)

## The source contract

A source subclasses `LogStash::Config::Source::Base` and implements three methods. `match?` says whether this source applies to the current settings. `config_conflict?` says whether the settings are contradictory and fills `conflict_messages`. `pipeline_configs` returns the list of `PipelineConfig` objects. The base class also offers helpers for the three settings every local source reads: `config.string`, `path.config` and `config.reload.automatic`.

Sources: [logstash-core/lib/logstash/config/source/base.rb:18-75](repo://logstash-core/lib/logstash/config/source/base.rb#L18-L75)

The runner checks `config_conflict?` on every source at startup. It prints the conflict messages and exits if any source with messages conflicts, and prints "missing configuration" if every source conflicts ([[Startup and the Runner]]).

Sources: [logstash-core/lib/logstash/runner.rb:337-360](repo://logstash-core/lib/logstash/runner.rb#L337-L360)

## SourceLoader

`SourceLoader` keeps a set of sources behind a mutex; `add_source`, `remove_source` and `configure_sources` let x-pack replace the local sources. `fetch` runs on every convergence.

Sources: [logstash-core/lib/logstash/config/source_loader.rb:102-129](repo://logstash-core/lib/logstash/config/source_loader.rb#L102-L129)

1. Collect the sources whose `match?` is true. None matching raises `InvalidSourceLoaderSettingError`.
2. Call `pipeline_configs` on each, then flatten and drop `nil`s.
3. Group by `pipeline_id`; any duplicate gives `FailedFetch("Found duplicate ids in your source: ...")`.
4. With `config.debug` and debug logging, call `display_debug_information` on each config.
5. Log an error if the list is empty, but still return `SuccessfulFetch`.

Sources: [logstash-core/lib/logstash/config/source_loader.rb:57-100](repo://logstash-core/lib/logstash/config/source_loader.rb#L57-L100), [logstash-core/lib/logstash/config/source_loader.rb:136-139](repo://logstash-core/lib/logstash/config/source_loader.rb#L136-L139)

Any exception inside a source becomes a `FailedFetch` holding its message. The agent treats that differently depending on reload mode: with automatic reload it logs and retries at the next interval, without it it raises.

Sources: [logstash-core/lib/logstash/config/source_loader.rb:94-98](repo://logstash-core/lib/logstash/config/source_loader.rb#L94-L98), [logstash-core/lib/logstash/agent.rb:221-231](repo://logstash-core/lib/logstash/agent.rb#L221-L231)

## Local source: -e and -f

`Source::Local` matches when `config.string` or `path.config` is set, unless automatic reload is combined with `-e` alone (there is nothing to watch). That combination, and setting both `-e` and `-f`, are reported as conflicts. It always produces at most one pipeline, named by `pipeline.id` (default `main`).

Sources: [logstash-core/lib/logstash/config/source/local.rb:170-216](repo://logstash-core/lib/logstash/config/source/local.rb#L170-L216)

| Loader | Used when | Parts produced |
| --- | --- | --- |
| `ConfigStringLoader` | `config.string` set | The string as protocol `string`, id `config_string`; plus a default input or output part if the text has no `input {` or `output {` block |
| `ConfigPathLoader` | `path.config` is a plain path or `file://` URI | One part per file, protocol `file`, id the path |
| `ConfigRemoteLoader` | `path.config` is `http://` or `https://` | One part from the response body |

Sources: [logstash-core/lib/logstash/config/source/local.rb:33-57](repo://logstash-core/lib/logstash/config/source/local.rb#L33-L57), [logstash-core/lib/logstash/config/source/local.rb:59-110](repo://logstash-core/lib/logstash/config/source/local.rb#L59-L110), [logstash-core/lib/logstash/config/source/local.rb:143-168](repo://logstash-core/lib/logstash/config/source/local.rb#L143-L168), [logstash-core/lib/logstash/config/source/local.rb:202-245](repo://logstash-core/lib/logstash/config/source/local.rb#L202-L245)

The default parts are `input { stdin { type => stdin } }` and `output { stdout { codec => rubydebug } }`, so `bin/logstash -e 'filter { ... }'` reads stdin and prints events.

Sources: [logstash-core/lib/logstash/config/defaults.rb:20-34](repo://logstash-core/lib/logstash/config/defaults.rb#L20-L34)

`ConfigPathLoader` strips a `file://` prefix and expands the path; a directory becomes `dir/*`. It globs and sorts the matches, skips directories and files ending in `~` (editor backups), and reads regular files and named pipes. Files that are not valid UTF-8 are collected and reported together in one `ConfigLoadingError`. An empty match only logs "No config files found in path".

Sources: [logstash-core/lib/logstash/config/source/local.rb:59-141](repo://logstash-core/lib/logstash/config/source/local.rb#L59-L141)

`ConfigRemoteLoader` does a single GET and does not follow redirects: 302, 403, 404 and 500 each raise a `ConfigLoadingError` with a specific message.

Sources: [logstash-core/lib/logstash/config/source/local.rb:143-168](repo://logstash-core/lib/logstash/config/source/local.rb#L143-L168)

## MultiLocal source: pipelines.yml

`Source::MultiLocal` extends `Local` and reads `pipelines.yml` from `path.settings`. It matches only when neither `-e` nor `-f` is given and the file parsed to an array. When flags are given it warns once that `pipelines.yml` is ignored.

Sources: [logstash-core/lib/logstash/config/source/multi_local.rb:50-80](repo://logstash-core/lib/logstash/config/source/multi_local.rb#L50-L80)

`detect_pipelines` records what the file held, and `config_conflict?` turns that into a message: unreadable, empty, a YAML value of the wrong type, or a parse error.

Sources: [logstash-core/lib/logstash/config/source/multi_local.rb:96-127](repo://logstash-core/lib/logstash/config/source/multi_local.rb#L96-L127)

For each entry, `pipeline_configs` substitutes `${VAR}` references with `deep_replace`, clones the global settings, and merges the entry with `merge_pipeline_settings`, so only per-pipeline keys are accepted ([[Settings and logstash.yml]]). Duplicate `pipeline.id` values raise a `ConfigurationError`. It then temporarily sets `@settings` to each clone and reuses `Local#local_pipeline_configs`, so each entry may use `config.string` or `path.config` exactly as on the command line.

Sources: [logstash-core/lib/logstash/config/source/multi_local.rb:32-48](repo://logstash-core/lib/logstash/config/source/multi_local.rb#L32-L48), [logstash-core/lib/logstash/config/source/multi_local.rb:105-110](repo://logstash-core/lib/logstash/config/source/multi_local.rb#L105-L110)

```yaml
- pipeline.id: test
  pipeline.workers: 1
  pipeline.batch.size: 1
  config.string: "input { generator {} } filter { sleep { time => 1 } } output { stdout { codec => dots } }"
- pipeline.id: another_test
  queue.type: persisted
  path.config: "/tmp/logstash/*.config"
```

Sources: [config/pipelines.yml:5-15](repo://config/pipelines.yml#L5-L15)

## PipelineConfig

`org.logstash.config.ir.PipelineConfig` is a Java class, imported into Ruby as `LogStash::Config::PipelineConfig`. Its constructor takes the source class, the pipeline id, the parts and the settings. It sorts the parts by protocol and then id, so files load in a stable order regardless of how the source listed them, and records `readAt`.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/PipelineConfig.java:44-92](repo://logstash-core/src/main/java/org/logstash/config/ir/PipelineConfig.java#L44-L92), [logstash-core/lib/logstash/config/pipeline_config.rb:18-20](repo://logstash-core/lib/logstash/config/pipeline_config.rb#L18-L20)

`configString` joins the parts' text, adding a newline between parts when one is missing. `configHash` is a digest of that string plus each part's metadata. Two configs are equal when the hash, the pipeline id and the settings are equal; the `StateResolver` uses this equality to decide whether a running pipeline must be reloaded.

Sources: [logstash-core/src/main/java/org/logstash/config/ir/PipelineConfig.java:114-172](repo://logstash-core/src/main/java/org/logstash/config/ir/PipelineConfig.java#L114-L172), [logstash-core/lib/logstash/state_resolver.rb:29-42](repo://logstash-core/lib/logstash/state_resolver.rb#L29-L42)

`lookupSource` maps a line number in the joined text back to the part and line it came from, using the line counts of the parts. The compiler uses it so that error messages and plugin ids name the original file and line rather than a position in the concatenated text ([[Configuration Language Parser]]).

Sources: [logstash-core/src/main/java/org/logstash/config/ir/PipelineConfig.java:186-212](repo://logstash-core/src/main/java/org/logstash/config/ir/PipelineConfig.java#L186-L212)

## SourceWithMetadata

Each part is a `SourceWithMetadata`: `protocol` (`file`, `string`, `http`), `id` (the path or a name), the starting `line` and `column`, the `text`, and optional `metadata`. The constructor rejects a part whose attributes are `null` or blank with `IncompleteSourceWithMetadataException`, then counts the lines used by `lookupSource`.

Sources: [logstash-core/src/main/java/org/logstash/common/SourceWithMetadata.java:32-98](repo://logstash-core/src/main/java/org/logstash/common/SourceWithMetadata.java#L32-L98)
