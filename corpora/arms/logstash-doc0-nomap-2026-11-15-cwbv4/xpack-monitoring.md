---
title: "X-Pack Monitoring"
---
## Overview

Legacy internal monitoring makes Logstash ship its own statistics to Elasticsearch, where the Stack Monitoring UI in Kibana shows them. It works by adding a hidden system pipeline, `.monitoring-logstash`, built from a template: a `metrics` input reads the metric store every few seconds and emits `logstash_stats` and `logstash_state` events, and an `elasticsearch_monitoring` output sends them to the monitoring cluster. The feature is deprecated in favour of Elastic Agent, is off by default, and since version 9 must be explicitly allowed. It plugs into Logstash through the mechanisms on [[X-Pack Extensions and License Checking]] and reads the data described on [[Metrics System]].

Sources: [x-pack/lib/monitoring/monitoring.rb:127-153](repo://x-pack/lib/monitoring/monitoring.rb#L127-L153), [x-pack/lib/template.cfg.erb:5-72](repo://x-pack/lib/template.cfg.erb#L5-L72)

## Enabling

The `MonitoringExtension` universal plugin registers two parallel families of settings: `xpack.monitoring.*` (legacy, through Elasticsearch's monitoring bulk endpoint) and `monitoring.*` (direct shipping into `.monitoring-logstash-*` indices), plus `xpack.monitoring.allow_legacy_collection` and `node.uuid`.

Sources: [x-pack/lib/monitoring/monitoring.rb:254-300](repo://x-pack/lib/monitoring/monitoring.rb#L254-L300)

| Setting (either prefix) | Default |
| --- | --- |
| `monitoring.enabled` | `false` |
| `monitoring.elasticsearch.hosts` | `["http://localhost:9200"]` |
| `monitoring.elasticsearch.username` | `logstash_system` |
| `monitoring.collection.interval` | `10s` |
| `monitoring.collection.timeout_interval` | `10m` |
| `monitoring.collection.pipeline.details.enabled` | `true` |
| `monitoring.collection.config.enabled` | `true` |

Sources: [x-pack/lib/monitoring/monitoring.rb:273-300](repo://x-pack/lib/monitoring/monitoring.rb#L273-L300)

`PipelineRegisterHook#monitoring_enabled?` decides in four steps, taking the first that applies.

Sources: [x-pack/lib/monitoring/monitoring.rb:159-182](repo://x-pack/lib/monitoring/monitoring.rb#L159-L182)

1. If `xpack.monitoring.allow_legacy_collection` is false, monitoring is off (with a warning when monitoring was requested).
2. Otherwise `monitoring.enabled` or `xpack.monitoring.enabled`, whichever is set.
3. If neither is set but monitoring hosts or a cloud id are, it is on, with a warning to set the flag explicitly.
4. Otherwise the default, false.

Sources: [x-pack/lib/monitoring/monitoring.rb:159-182](repo://x-pack/lib/monitoring/monitoring.rb#L159-L182)

Setting both `xpack.monitoring.enabled` and `monitoring.enabled`, or mixing other `xpack.monitoring.*` and `monitoring.*` settings, raises an `ArgumentError`. `monitoring.enabled` selects direct shipping.

Sources: [x-pack/lib/monitoring/monitoring.rb:204-218](repo://x-pack/lib/monitoring/monitoring.rb#L204-L218), [x-pack/lib/monitoring/monitoring.rb:245-247](repo://x-pack/lib/monitoring/monitoring.rb#L245-L247)

## Building the monitoring pipeline

The extension registers `PipelineRegisterHook` on `LogStash::Runner`. Its `after_agent` hook runs once the agent exists: it logs a deprecation pointing to Elastic Agent, sets `node.uuid` to the agent's persistent id, builds the pipeline config, and adds an `InternalPipelineSource` to the runner's source loader.

Sources: [x-pack/lib/monitoring/monitoring.rb:137-153](repo://x-pack/lib/monitoring/monitoring.rb#L137-L153), [x-pack/lib/monitoring/monitoring.rb:254-257](repo://x-pack/lib/monitoring/monitoring.rb#L254-L257)

`setup_metrics_pipeline` clones the settings and makes a small, isolated pipeline: id `.monitoring-logstash`, no `path.config`, no reload, `metric.collect` false (so it does not measure itself), memory queue, 1 worker, batch size 2, and `pipeline.system` true. `generate_pipeline_config` computes Elasticsearch options with the shared helper and renders `template.cfg.erb`; the result becomes a `PipelineConfig` with a `SourceWithMetadata` of protocol `x-pack-metrics`.

Sources: [x-pack/lib/monitoring/monitoring.rb:184-243](repo://x-pack/lib/monitoring/monitoring.rb#L184-L243)

The template's input is `metrics` with the collection settings. The output is `elasticsearch_monitoring` with credentials, `hosts` or `cloud_id`, TLS options, `data_stream => false`, `manage_template => false`, the product-origin header, and a bulk path that depends on the mode: `/_monitoring/bulk?system_id=logstash&system_api_version=7&interval=1s` for legacy collection, or `/_bulk/` into `.monitoring-logstash-7-<date>` for direct shipping.

Sources: [x-pack/lib/template.cfg.erb:5-72](repo://x-pack/lib/template.cfg.erb#L5-L72), [x-pack/lib/monitoring/monitoring.rb:110-124](repo://x-pack/lib/monitoring/monitoring.rb#L110-L124)

Because it is a system pipeline, the agent creates it before user pipelines, the agent keeps running only while user pipelines exist, and the periodic pollers and the metrics input skip it ([[Agent and Pipeline Convergence]]).

Sources: [logstash-core/lib/logstash/pipeline_action/create.rb:38-44](repo://logstash-core/lib/logstash/pipeline_action/create.rb#L38-L44), [logstash-core/lib/logstash/agent.rb:156-164](repo://logstash-core/lib/logstash/agent.rb#L156-L164)

## License gate

`InternalPipelineSource` is a config source whose `match?` returns true only when the license check passes, so the monitoring pipeline exists only with a usable license. It connects to the monitoring cluster with the license checker. Its states: failure to reach Elasticsearch, x-pack missing, no license, an unknown license type, or a serverless cluster without the monitoring feature are errors; an inactive license is allowed with a warning. When the license becomes valid later, `update_license_state` triggers `agent.converge_state_and_update_if_running`, so monitoring starts without a restart.

Sources: [x-pack/lib/monitoring/internal_pipeline_source.rb:9-100](repo://x-pack/lib/monitoring/internal_pipeline_source.rb#L9-L100)

## The metrics input

`LogStash::Inputs::Metrics` takes `collection_interval` (10 s), `collection_timeout_interval` (10 min), `extended_performance_collection` and `config_collection`. `run` stores the queue, registers the input itself as a hook on `LogStash::Agent` (to receive `pipeline_started`), and starts a timer task that calls `update` with a fresh metric snapshot each interval. `stop` removes the hook and shuts the timer down.

Sources: [x-pack/lib/monitoring/inputs/metrics.rb:17-105](repo://x-pack/lib/monitoring/inputs/metrics.rb#L17-L105)

Each `update` emits one `logstash_stats` event and then refreshes state events.

Sources: [x-pack/lib/monitoring/inputs/metrics.rb:107-165](repo://x-pack/lib/monitoring/inputs/metrics.rb#L107-L165)

- `StatsEventFactory` builds a document with `timestamp`, `logstash` (node stats), `events`, `process`, `pipelines` (from `PipelinesInfo.format_pipelines_info`, which skips system pipelines), `reloads`, `jvm`, `os` and `queue`. In direct-shipping mode the document is wrapped with `type`, `cluster_uuid`, `interval_ms` and `timestamp`.
- `StateEventFactory` builds, for one pipeline, its id, hash, ephemeral id, workers, batch size and the serialized graph from [[Pipeline Intermediate Representation]]. State events are sent when a pipeline starts, when its hash changes, and at least every 10 minutes; system pipelines and `config_collection => false` skip them.

Sources: [x-pack/lib/monitoring/inputs/metrics/stats_event_factory.rb:5-81](repo://x-pack/lib/monitoring/inputs/metrics/stats_event_factory.rb#L5-L81), [x-pack/lib/monitoring/inputs/metrics/state_event_factory.rb:5-54](repo://x-pack/lib/monitoring/inputs/metrics/state_event_factory.rb#L5-L54), [logstash-core/lib/logstash/config/pipelines_info.rb:25-28](repo://logstash-core/lib/logstash/config/pipelines_info.rb#L25-L28)

Both kinds carry `[@metadata][document_type]`, which the output uses as the document type in legacy mode. In direct-shipping mode, the input resolves the Elasticsearch cluster UUIDs that user pipelines' outputs connect to and emits one copy of each event per cluster, so each cluster's monitoring shows the Logstash nodes feeding it.

Sources: [x-pack/lib/monitoring/inputs/metrics.rb:107-124](repo://x-pack/lib/monitoring/inputs/metrics.rb#L107-L124), [x-pack/lib/monitoring/inputs/metrics.rb:175-218](repo://x-pack/lib/monitoring/inputs/metrics.rb#L175-L218), [logstash-core/lib/logstash/java_pipeline.rb:347-353](repo://logstash-core/lib/logstash/java_pipeline.rb#L347-L353)

## The elasticsearch_monitoring output

`ElasticSearchMonitoring` is a thin subclass of the Elasticsearch output plugin with the name `elasticsearch_monitoring`. It accepts a `document_type` option and uses event types only in legacy mode.

Sources: [x-pack/lib/monitoring/outputs/elasticsearch_monitoring.rb:5-16](repo://x-pack/lib/monitoring/outputs/elasticsearch_monitoring.rb#L5-L16)
