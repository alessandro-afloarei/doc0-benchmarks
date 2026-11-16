---
title: "X-Pack Extensions and License Checking"
---
## Overview

The `x-pack` directory holds Elastic-licensed features that ship in the default distribution: legacy internal monitoring, centralized pipeline management, and GeoIP database management. None of them is wired into `logstash-core` directly. Instead x-pack registers ordinary plugins and universal plugins with the plugin registry at startup, adds its settings through the universal-plugin hooks, and gates licensed behaviour through a shared license checker that asks the connected Elasticsearch cluster which license it has. This page covers that integration layer; each feature has its own page: [[X-Pack Monitoring]], [[Centralized Pipeline Management]] and [[GeoIP Database Management]].

Sources: [x-pack/lib/x-pack/logstash_registry.rb:5-19](repo://x-pack/lib/x-pack/logstash_registry.rb#L5-L19)

## Loading x-pack

When `runner.rb` loads, it sets `LogStash::OSS` to true if the `OSS` environment variable is `true` or the `x-pack` directory is missing; otherwise it puts `x-pack/lib` first on the Ruby load path. `PLUGIN_REGISTRY.setup!` then requires `x-pack/logstash_registry` unless running OSS, before any gem plugin is loaded ([[Plugin Registry and Factory]]).

Sources: [logstash-core/lib/logstash/runner.rb:22-32](repo://logstash-core/lib/logstash/runner.rb#L22-L32), [logstash-core/lib/logstash/plugins/registry.rb:128-147](repo://logstash-core/lib/logstash/plugins/registry.rb#L128-L147)

`logstash_registry.rb` registers two plugins and three universal plugins.

Sources: [x-pack/lib/x-pack/logstash_registry.rb:5-19](repo://x-pack/lib/x-pack/logstash_registry.rb#L5-L19)

| Type | Name | Class | Purpose |
| --- | --- | --- | --- |
| input | `metrics` | `LogStash::Inputs::Metrics` | Turns the metric store into monitoring events |
| output | `elasticsearch_monitoring` | `LogStash::Outputs::ElasticSearchMonitoring` | Ships them to Elasticsearch |
| universal | `monitoring` | `LogStash::MonitoringExtension` | Monitoring settings and hooks |
| universal | `config_management` | `LogStash::ConfigManagement::Extension` | Central management settings and hooks |
| universal | `geoip_database_management` | `LogStash::GeoipDatabaseManagement::Extension` | GeoIP downloader settings |

Sources: [x-pack/lib/x-pack/logstash_registry.rb:5-19](repo://x-pack/lib/x-pack/logstash_registry.rb#L5-L19)

## Universal plugins

A universal plugin subclasses `LogStash::UniversalPlugin` (Java `UniversalPluginExt`) and overrides `additionals_settings(settings)` and `register_hooks(hooks)`. The registry calls both during `setup!`, while the runner class is loading and before `logstash.yml` values are validated. Settings registered here therefore exist by the time `validate_all` merges the YAML values that were parked as transient settings ([[Settings and logstash.yml]]).

Sources: [logstash-core/src/main/java/org/logstash/plugins/UniversalPluginExt.java:32-54](repo://logstash-core/src/main/java/org/logstash/plugins/UniversalPluginExt.java#L32-L54), [logstash-core/lib/logstash/plugins/registry.rb:101-111](repo://logstash-core/lib/logstash/plugins/registry.rb#L101-L111), [logstash-core/lib/logstash/settings.rb:217-224](repo://logstash-core/lib/logstash/settings.rb#L217-L224)

For example, the config management extension registers `xpack.management.enabled`, `poll_interval`, `pipeline.id` and the whole `xpack.management.elasticsearch.*` family, and attaches a `Hooks` object to `LogStash::Runner`; the GeoIP extension only registers its downloader settings. A failure while registering settings is logged and re-raised, which stops startup.

Sources: [x-pack/lib/config_management/extension.rb:10-51](repo://x-pack/lib/config_management/extension.rb#L10-L51), [x-pack/lib/geoip_database_management/extension.rb:7-23](repo://x-pack/lib/geoip_database_management/extension.rb#L7-L23)

Hooks are objects with methods named after runner and agent events (`before_bootstrap_checks`, `after_bootstrap_checks`, `before_agent`, `after_agent`, `pipeline_started` and so on). The `EventDispatcher` calls a hook's method when the event fires and passes the emitter first, which is how x-pack replaces config sources or adds bootstrap checks without changes in core.

Sources: [logstash-core/src/main/java/org/logstash/execution/EventDispatcherExt.java:88-100](repo://logstash-core/src/main/java/org/logstash/execution/EventDispatcherExt.java#L88-L100), [logstash-core/lib/logstash/runner.rb:304-329](repo://logstash-core/lib/logstash/runner.rb#L304-L329)

## Elasticsearch connection options

Each feature connects to Elasticsearch with settings named `xpack.<feature>.elasticsearch.*` (or `<feature>.elasticsearch.*` for monitoring in direct-shipping mode). `ElasticsearchOptions.es_options_from_settings(feature, settings)` turns them into options for the Elasticsearch output plugin's client in five steps.

Sources: [x-pack/lib/helpers/elasticsearch_options.rb:5-92](repo://x-pack/lib/helpers/elasticsearch_options.rb#L5-L92)

- It maps `username`, `password`, `api_key`, `cloud_id`, `cloud_auth`, `proxy`, `sniffing` and the `ssl.*` settings to the plugin's option names.
- It uses `hosts` unless `cloud_id` is set.
- It sets `ssl_verification_mode` to `none` only when asked, otherwise `full`.
- It enables SSL when every host is `https://`, when `cloud_id` is set, or when any CA, fingerprint, truststore, keystore or client certificate is configured.
- It drops the user when `cloud_auth` or `api_key` is used or no credentials are given.

Sources: [x-pack/lib/helpers/elasticsearch_options.rb:45-121](repo://x-pack/lib/helpers/elasticsearch_options.rb#L45-L121)

`validate_authentication!` rejects contradictory combinations before any connection is made: `cloud_auth` with a username or password, a username without a password, `cloud_id` together with `hosts`, more than one authentication method, and `api_key` without TLS. `es_options_with_product_origin_header` adds `x-elastic-product-origin: logstash` to every request. `feature_configured?` reports whether any `xpack.<feature>.elasticsearch.*` connection setting was set.

Sources: [x-pack/lib/helpers/elasticsearch_options.rb:97-181](repo://x-pack/lib/helpers/elasticsearch_options.rb#L97-L181)

## License checking

### Fetching the license

`LicenseReader` builds an Elasticsearch output client from the feature's options (with a 30-second resurrect delay) and calls `GET /` for cluster info and `GET /_xpack` for license and features, each retried up to 10 times on unreachable hosts by `LoggableTry`, which logs a warning per failed attempt. A 400 or 404 from `_xpack` means x-pack is not installed in Elasticsearch; any other error logs "Unable to retrieve license information from license server" and returns a "failed to fetch" result.

Sources: [x-pack/lib/license_checker/license_reader.rb:8-92](repo://x-pack/lib/license_checker/license_reader.rb#L8-L92), [x-pack/lib/helpers/loggable_try.rb:5-18](repo://x-pack/lib/helpers/loggable_try.rb#L5-L18)

`XPackInfo` wraps the response: `installed?`, `failed?`, `license_available?`, `license_active?` (status `active`), `license_one_of?(types)`, `feature_enabled?(name)`, and `license_<field>` accessors. The valid types are `trial`, `basic`, `standard`, `gold`, `platinum` and `enterprise`. Against a serverless cluster (cluster info `build_flavor` is `serverless`), a fixed enterprise response is used instead of calling `_xpack`.

Sources: [x-pack/lib/license_checker/x_pack_info.rb:10-104](repo://x-pack/lib/license_checker/x_pack_info.rb#L10-L104), [x-pack/lib/license_checker/license_manager.rb:42-61](repo://x-pack/lib/license_checker/license_manager.rb#L42-L61)

### Refreshing and observing

`LicenseManager` fetches once at creation and then every 30 seconds on a daemon thread named `<feature>-license-manager`. When the result differs from the previous one, it notifies its observers with the new info and the serverless flag.

Sources: [x-pack/lib/license_checker/license_manager.rb:15-80](repo://x-pack/lib/license_checker/license_manager.rb#L15-L80)

### The Licensed mixin

A feature includes `LogStash::LicenseChecker::Licensed`, calls `setup_license_checker(feature)` to create a reader and manager and subscribe to updates, and implements `populate_license_state(xpack_info, is_serverless)`, returning a hash with `state` (`:ok` or `:error`), `log_level` and `log_message`. `with_license_check(raise_on_error)` (alias `license_check`) logs the message when it changes, runs the given block or returns true when the state is ok, and otherwise returns false or raises `LicenseError`.

Sources: [x-pack/lib/license_checker/licensed.rb:11-90](repo://x-pack/lib/license_checker/licensed.rb#L11-L90)

Central management's checks show the pattern: failure to reach Elasticsearch, x-pack missing, security disabled, no license, or a license type outside the valid list are errors; an inactive license is allowed with a warning; otherwise "Configuration Management License OK" ([[Centralized Pipeline Management]]).

Sources: [x-pack/lib/config_management/elasticsearch_source.rb:134-178](repo://x-pack/lib/config_management/elasticsearch_source.rb#L134-L178)
