---
title: "Centralized Pipeline Management"
---
## Overview

With centralized pipeline management, pipeline definitions live in Elasticsearch (managed from Kibana) instead of local files. Logstash polls Elasticsearch for the pipeline ids it is configured to run, builds `PipelineConfig` objects from the stored documents, and lets the agent's normal convergence create, reload and remove pipelines as the documents change. The feature is an x-pack universal plugin: it adds `xpack.management.*` settings, replaces the bootstrap checks and the local config sources through runner hooks, and is gated by the license checker ([[X-Pack Extensions and License Checking]]). Local sources and the `PipelineConfig` model are described on [[Pipeline Configuration Sources]].

Sources: [x-pack/lib/config_management/extension.rb:10-51](repo://x-pack/lib/config_management/extension.rb#L10-L51), [x-pack/lib/config_management/hooks.rb:11-49](repo://x-pack/lib/config_management/hooks.rb#L11-L49)

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `xpack.management.enabled` | `false` | Use Elasticsearch as the config store |
| `xpack.management.pipeline.id` | `["main"]` | Pipeline ids to run; `*` wildcards allowed |
| `xpack.management.logstash.poll_interval` | `5s` | How often to fetch |
| `xpack.management.elasticsearch.hosts` | `["https://localhost:9200"]` | Cluster holding the pipelines |
| `xpack.management.elasticsearch.username` | `logstash_system` | Plus `password`, `api_key`, `cloud_id`, `cloud_auth`, `proxy` |
| `xpack.management.elasticsearch.ssl.*` | none | CA, fingerprint, truststore, keystore, client cert, cipher suites, `verification_mode` (`full`) |
| `xpack.management.elasticsearch.sniffing` | `false` | Discover other nodes |

Sources: [x-pack/lib/config_management/extension.rb:20-48](repo://x-pack/lib/config_management/extension.rb#L20-L48)

## Startup takeover

The extension registers `ConfigManagement::Hooks` on `LogStash::Runner`. When `xpack.management.enabled` is true, two hooks change the startup described on [[Startup and the Runner]].

Sources: [x-pack/lib/config_management/extension.rb:15-18](repo://x-pack/lib/config_management/extension.rb#L15-L18), [x-pack/lib/config_management/hooks.rb:16-46](repo://x-pack/lib/config_management/hooks.rb#L16-L46)

1. `before_bootstrap_checks` replaces the default bootstrap check with `ConfigManagement::BootstrapCheck`.
2. `after_bootstrap_checks` removes the `Local` and `MultiLocal` sources from the runner's source loader and adds an `ElasticsearchSource`.

Sources: [x-pack/lib/config_management/hooks.rb:16-41](repo://x-pack/lib/config_management/hooks.rb#L16-L41)

The bootstrap check enforces the new mode with the checks in the table.

Sources: [x-pack/lib/config_management/bootstrap_check.rb:14-80](repo://x-pack/lib/config_management/bootstrap_check.rb#L14-L80)

| Check | Error |
| --- | --- |
| `path.config` matches existing files | Configs cannot come from `-f` or `path.config` |
| `config.string` set | You cannot use `-e` |
| `config.test_and_exit` set | You cannot use `-t` |
| Empty pipeline id list | Specify `xpack.management.pipeline.id` |
| Id not matching `[a-z_*][a-z_\-0-9*]*` (case-insensitive) | Lists the invalid ids |
| Duplicate ids (case-insensitive) | Lists the duplicates |

Sources: [x-pack/lib/config_management/bootstrap_check.rb:14-80](repo://x-pack/lib/config_management/bootstrap_check.rb#L14-L80)

It also forces `config.reload.automatic` to true and sets `config.reload.interval` to the poll interval, so the agent's reload loop becomes the polling loop ([[Agent and Pipeline Convergence]]).

Sources: [x-pack/lib/config_management/bootstrap_check.rb:32-36](repo://x-pack/lib/config_management/bootstrap_check.rb#L32-L36), [logstash-core/lib/logstash/agent.rb:137-151](repo://logstash-core/lib/logstash/agent.rb#L137-L151)

## The Elasticsearch source

### Source and fetch cycle

`ElasticsearchSource` is a config source whose `match?` is the `enabled` flag and which never reports a conflict. On construction it computes connection options from the `management` settings, starts the license checker, and fails immediately if the license check fails. The client is an Elasticsearch output plugin client with the product-origin header.

Sources: [x-pack/lib/config_management/elasticsearch_source.rb:13-53](repo://x-pack/lib/config_management/elasticsearch_source.rb#L13-L53), [x-pack/lib/config_management/elasticsearch_source.rb:127-132](repo://x-pack/lib/config_management/elasticsearch_source.rb#L127-L132)

On every convergence, `pipeline_configs` takes these steps.

Sources: [x-pack/lib/config_management/elasticsearch_source.rb:59-77](repo://x-pack/lib/config_management/elasticsearch_source.rb#L59-L77)

1. Check the license again, raising if it is no longer valid.
2. `GET /` (retried up to 10 times) to learn the Elasticsearch version.
3. Pick a fetcher: `SystemIndicesFetcher` for Elasticsearch 7.10 and later, `LegacyHiddenIndicesFetcher` before that.
4. Fetch the configured ids; a 404 means no pipelines and returns an empty list.
5. Build one `PipelineConfig` per returned id.

Sources: [x-pack/lib/config_management/elasticsearch_source.rb:55-92](repo://x-pack/lib/config_management/elasticsearch_source.rb#L55-L92)

### Fetchers

`SystemIndicesFetcher` reads the `_logstash/pipeline` API. On Elasticsearch 8.3 and later it passes the ids, wildcards included, as `?id=a,b*` and lets Elasticsearch match. On earlier versions it fetches every pipeline and filters locally: exact ids first, then `File.fnmatch?` against each wildcard pattern. Ids and patterns that matched nothing are logged at debug level.

Sources: [x-pack/lib/config_management/elasticsearch_source.rb:207-265](repo://x-pack/lib/config_management/elasticsearch_source.rb#L207-L265)

`LegacyHiddenIndicesFetcher` issues `_mget` on the `.logstash` index with one document per id, does not support wildcards (and logs that), and reads each pipeline from the document's `_source`. Both fetchers raise `RemoteConfigError` when Elasticsearch returns an error.

Sources: [x-pack/lib/config_management/elasticsearch_source.rb:268-299](repo://x-pack/lib/config_management/elasticsearch_source.rb#L268-L299)

### Building pipeline configs

`get_pipeline` reads `pipeline` (the config text) and `pipeline_metadata` from the stored document and raises "Empty configuration for pipeline_id" if the text is empty. It wraps the text in a `SourceWithMetadata` with protocol `x-pack-config-management`, the pipeline id, and the metadata string; because the metadata is part of the config hash, a change to the document's metadata also triggers a reload ([[Pipeline Configuration Sources]]).

Sources: [x-pack/lib/config_management/elasticsearch_source.rb:94-101](repo://x-pack/lib/config_management/elasticsearch_source.rb#L94-L101), [logstash-core/src/main/java/org/logstash/config/ir/PipelineConfig.java:114-119](repo://logstash-core/src/main/java/org/logstash/config/ir/PipelineConfig.java#L114-L119)

Settings come from a clone of the global settings with `pipeline.id` set, plus the document's `pipeline_settings` restricted to `pipeline.workers`, `pipeline.batch.size`, `pipeline.batch.delay`, `pipeline.ecs_compatibility`, `pipeline.ordered`, `queue.type`, `queue.max_bytes` and `queue.checkpoint.writes`. Unknown settings are ignored with a warning.

Sources: [x-pack/lib/config_management/elasticsearch_source.rb:22-34](repo://x-pack/lib/config_management/elasticsearch_source.rb#L22-L34), [x-pack/lib/config_management/elasticsearch_source.rb:103-119](repo://x-pack/lib/config_management/elasticsearch_source.rb#L103-L119)

## Licensing

Central management needs a `trial`, `standard`, `gold`, `platinum` or `enterprise` license (not `basic`) and Elasticsearch security enabled. Failure to reach Elasticsearch, x-pack missing in Elasticsearch, security disabled, no license information, or a license type outside that list are errors that stop the fetch. An inactive license logs a warning and keeps working. A valid license where the `logstash` feature is not enabled in Elasticsearch logs a warning.

Sources: [x-pack/lib/config_management/elasticsearch_source.rb:134-178](repo://x-pack/lib/config_management/elasticsearch_source.rb#L134-L178)

## Failure behaviour

Any exception inside `pipeline_configs` turns into a failed fetch in the `SourceLoader`. Because the bootstrap check forced automatic reload, the agent logs the failure at debug level and tries again at the next poll interval, leaving the running pipelines untouched. If Elasticsearch becomes unreachable, Logstash keeps running the last pipelines it fetched.

Sources: [logstash-core/lib/logstash/config/source_loader.rb:94-98](repo://logstash-core/lib/logstash/config/source_loader.rb#L94-L98), [logstash-core/lib/logstash/agent.rb:221-231](repo://logstash-core/lib/logstash/agent.rb#L221-L231)
