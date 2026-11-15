---
title: "Monitoring API"
---
## Overview

Every Logstash process serves a JSON HTTP API, by default on `127.0.0.1` at the first free port in `9600-9700`. It reports node information, the statistics in the metric store, installed plugins, hot threads and the health report, and lets operators change log levels at runtime. The server is Puma running a Rack application built from Sinatra modules; each module asks command objects for data, and the commands read a snapshot of the metric store ([[Metrics System]]). The agent creates the server at construction and runs it on its own thread when `api.enabled` is true ([[Agent and Pipeline Convergence]]).

Sources: [logstash-core/lib/logstash/webserver.rb:25-90](repo://logstash-core/lib/logstash/webserver.rb#L25-L90), [logstash-core/lib/logstash/webserver.rb:130-158](repo://logstash-core/lib/logstash/webserver.rb#L130-L158), [logstash-core/lib/logstash/agent.rb:482-509](repo://logstash-core/lib/logstash/agent.rb#L482-L509)

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| `api.enabled` | `true` | Start the server at all |
| `api.http.host` | `127.0.0.1` | Bind address; becomes `0.0.0.0` when unset and both TLS and basic auth are on |
| `api.http.port` | `9600-9700` | Single port or range to try in order |
| `api.environment` | `production` | Sinatra environment; `test` disables the error handler |
| `api.ssl.enabled` | `false` | Serve HTTPS |
| `api.ssl.keystore.path`, `api.ssl.keystore.password` | none | Required with TLS; the keystore must open as JKS |
| `api.ssl.supported_protocols` | none | Restrict TLS protocol versions |
| `api.auth.type` | `none` | `basic` enables HTTP basic auth |
| `api.auth.basic.username`, `api.auth.basic.password` | none | Required with basic auth |
| `api.auth.basic.password_policy.*` | see below | Strength rules for the password |

Sources: [logstash-core/lib/logstash/environment.rb:68-84](repo://logstash-core/lib/logstash/environment.rb#L68-L84), [logstash-core/lib/logstash/webserver.rb:35-90](repo://logstash-core/lib/logstash/webserver.rb#L35-L90)

`WebServer.from_settings` fails with "Setting ... is required when ... is set to ..." for each missing companion setting, and warns about `api.ssl.*` or `api.auth.basic.*` settings that are set but ignored because their feature is off. The password policy (minimum length between 8 and 1024, required upper, lower, digit and symbol classes) is checked by `Setting::ValidatedPassword` when the server is built; its `mode` defaults to `WARN`, which only logs, and a deprecation notice says it will become `ERROR`, which refuses a weak password ([[Secret Store and Variable Substitution]]).

Sources: [logstash-core/lib/logstash/webserver.rb:51-115](repo://logstash-core/lib/logstash/webserver.rb#L51-L115), [logstash-core/lib/logstash/webserver.rb:149-155](repo://logstash-core/lib/logstash/webserver.rb#L149-L155)

## Server lifecycle

`run` marks the server running and calls `create_server_thread`, which creates a `Puma::Server` and tries each port of the range in turn, adding a TCP listener or, with TLS, an SSL listener built from the keystore. On the first successful bind it starts Puma, logs "Successfully started Logstash API endpoint", and records `host:port` as the `http_address` gauge. A busy port moves on to the next; failure on the last raises `EADDRINUSE` with a message naming the port or range. `stop` stops Puma; the agent kills the thread if it has not ended after 5 seconds.

Sources: [logstash-core/lib/logstash/webserver.rb:160-247](repo://logstash-core/lib/logstash/webserver.rb#L160-L247), [logstash-core/lib/logstash/agent.rb:499-509](repo://logstash-core/lib/logstash/agent.rb#L499-L509)

Several Logstash processes on one host each take the next free port in the range, which is why the default is a range rather than a single port.

Sources: [logstash-core/lib/logstash/webserver.rb:31-33](repo://logstash-core/lib/logstash/webserver.rb#L31-L33), [logstash-core/lib/logstash/webserver.rb:205-220](repo://logstash-core/lib/logstash/webserver.rb#L205-L220)

## The Rack application

`RackApp.app` stacks two middlewares in front of the routes. `ApiLogger` logs every request at debug level, or at error level for 5xx responses. `ApiErrorHandler` turns any uncaught exception into a 500 JSON body with the class, message and backtrace. Basic auth, when configured, wraps the whole app with `Rack::Auth::Basic` and the realm `logstash-api`.

Sources: [logstash-core/lib/logstash/api/rack_app.rb:29-123](repo://logstash-core/lib/logstash/api/rack_app.rb#L29-L123), [logstash-core/lib/logstash/webserver.rb:147-157](repo://logstash-core/lib/logstash/webserver.rb#L147-L157)

| Mount | Module | Main routes |
| --- | --- | --- |
| `/` | `Root` | `GET /`: node identity and version |
| `/_node` | `Node` | `GET /`, `/pipelines`, `/pipelines/:id`, `/hot_threads`, `/:filter` (`pipelines`, `os`, `jvm`) |
| `/_node/stats` | `NodeStats` | `GET /`, `/pipelines`, `/pipelines/:id`, `/:filter` |
| `/_node/plugins` | `Plugins` | `GET /`: installed plugins with versions |
| `/_node/logging` | `Logging` | `GET /`, `PUT /`, `PUT /reset` |
| `/_stats` | `Stats` | `GET /`, `/jvm/hot_threads`, `/jvm/memory` |
| `/_health_report` | `HealthReport` | `GET /` ([[Health Report]]) |

Sources: [logstash-core/lib/logstash/api/rack_app.rb:125-134](repo://logstash-core/lib/logstash/api/rack_app.rb#L125-L134), [logstash-core/lib/logstash/api/modules/node.rb:24-72](repo://logstash-core/lib/logstash/api/modules/node.rb#L24-L72), [logstash-core/lib/logstash/api/modules/node_stats.rb:21-90](repo://logstash-core/lib/logstash/api/modules/node_stats.rb#L21-L90), [logstash-core/lib/logstash/api/modules/root.rb:21-26](repo://logstash-core/lib/logstash/api/modules/root.rb#L21-L26)

## Modules, commands and responses

Every module extends `Modules::Base`, a Sinatra app that holds the agent and a `CommandFactory` wrapping an `Api::Service`. `factory.build(:stats)` and friends instantiate one of six commands: `system_basic_info`, `plugins_command`, `stats`, `node`, `health_report` and `default_metadata`. The service gives commands `snapshot` (a copy of the metric store), `get_shallow(*path)` and `extract_metrics(path, *keys)`.

Sources: [logstash-core/lib/logstash/api/modules/base.rb:25-60](repo://logstash-core/lib/logstash/api/modules/base.rb#L25-L60), [logstash-core/lib/logstash/api/command_factory.rb:26-55](repo://logstash-core/lib/logstash/api/command_factory.rb#L26-L55), [logstash-core/lib/logstash/api/service.rb:20-49](repo://logstash-core/lib/logstash/api/service.rb#L20-L49)

`respond_with` produces every response. It sets the status from an error's `status_code` (500 for `ApiError`, 404 for `NotFoundError`), filters top-level keys when a comma-separated filter is given (a filter matching nothing is a 404), merges the default metadata, turns symbols into strings, and pretty-prints JSON when the `pretty` parameter is present. Unknown routes answer 404 through the same path.

Sources: [logstash-core/lib/logstash/api/app_helpers.rb:22-105](repo://logstash-core/lib/logstash/api/app_helpers.rb#L22-L105), [logstash-core/lib/logstash/api/errors.rb:18-44](repo://logstash-core/lib/logstash/api/errors.rb#L18-L44)

The default metadata on every response is `host`, `version`, `http_address`, the persistent `id`, `name`, `ephemeral_id`, `snapshot`, the overall health `status`, the global `pipeline` workers, batch size and delay, and, when legacy monitoring or `monitoring.cluster_uuid` is configured, a `monitoring` block.

Sources: [logstash-core/lib/logstash/api/commands/default_metadata.rb:24-79](repo://logstash-core/lib/logstash/api/commands/default_metadata.rb#L24-L79)

## Node info

`GET /_node/pipelines` lists, for each pipeline in `stats.pipelines`, its config gauges: `ephemeral_id`, `hash`, `workers`, `batch_size`, `batch_delay`, reload settings and DLQ settings. With `?graph=true` it adds the serialized pipeline graph from [[Pipeline Intermediate Representation]], with each vertex decorated with the Elasticsearch cluster UUIDs that output plugins recorded, which is what Kibana's pipeline viewer draws.

Sources: [logstash-core/lib/logstash/api/commands/node.rb:26-70](repo://logstash-core/lib/logstash/api/commands/node.rb#L26-L70), [logstash-core/lib/logstash/api/modules/node.rb:46-60](repo://logstash-core/lib/logstash/api/modules/node.rb#L46-L60)

`GET /_node/hot_threads` accepts `threads`, `ordered_by`, `stacktrace_size` and `ignore_idle_threads`, returns JSON or, with `?human`, plain text, and answers 400 for invalid options ([[Periodic Pollers and System Monitors]]).

Sources: [logstash-core/lib/logstash/api/modules/node.rb:29-44](repo://logstash-core/lib/logstash/api/modules/node.rb#L29-L44), [logstash-core/lib/logstash/api/commands/hot_threads_reporter.rb:18-30](repo://logstash-core/lib/logstash/api/commands/hot_threads_reporter.rb#L18-L30)

## Node stats

`GET /_node/stats` combines `jvm`, `process`, `events`, `flow`, `pipelines`, `reloads`, `os` and `queue` sections, plus `geoip_download_manager` when the x-pack GeoIP manager has reported a status ([[GeoIP Database Management]]). `?filter=jvm,events` keeps only those sections, and `/_node/stats/pipelines/:id` returns a single pipeline.

Sources: [logstash-core/lib/logstash/api/modules/node_stats.rb:21-90](repo://logstash-core/lib/logstash/api/modules/node_stats.rb#L21-L90)

Per-pipeline stats come from `PipelinesInfo.format_pipelines_info` (events, flow, queue and reload figures) merged with per-plugin reports for inputs, filters, outputs and codecs. `?vertices=true` adds vertex-level detail. A pipeline id that is not found returns an empty result, which the module turns into a 404.

Sources: [logstash-core/lib/logstash/api/commands/stats.rb:94-116](repo://logstash-core/lib/logstash/api/commands/stats.rb#L94-L116), [logstash-core/lib/logstash/api/commands/stats.rb:157-214](repo://logstash-core/lib/logstash/api/commands/stats.rb#L157-L214)

## Logging control

`GET /_node/logging` lists every Log4j logger with its level. `PUT /_node/logging` takes a JSON body such as `{"logger.logstash.outputs.elasticsearch": "DEBUG"}` and sets each named logger; any key that does not start with `logger.` is a 400 "unrecognized option". `PUT /_node/logging/reset` reloads the Log4j configuration, restoring the levels from `log4j2.properties` ([[Logging]]).

Sources: [logstash-core/lib/logstash/api/modules/logging.rb:24-80](repo://logstash-core/lib/logstash/api/modules/logging.rb#L24-L80)
