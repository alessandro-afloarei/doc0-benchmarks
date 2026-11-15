---
title: "Settings and logstash.yml"
---
## Overview

Every option Logstash reads, from `pipeline.workers` to `api.http.port`, is a registered setting object in the global `LogStash::SETTINGS` registry. A setting knows its name, its type, its default, an optional validator and whether a user changed it. Values arrive from three places only, in this order: the defaults registered in code, `logstash.yml`, and command-line flags. [[Startup and the Runner]] shows when each step runs; this page covers the registry, the setting types and the rules each step applies. Per-pipeline overrides from `pipelines.yml` are applied by [[Pipeline Configuration Sources]] using the same objects.

Sources: [logstash-core/lib/logstash/util/settings_helper.rb:22-43](repo://logstash-core/lib/logstash/util/settings_helper.rb#L22-L43), [logstash-core/lib/logstash/patches/clamp.rb:22-33](repo://logstash-core/lib/logstash/patches/clamp.rb#L22-L33)

## The settings registry

`LogStash::Settings` holds a hash of name to setting. `register` refuses a second setting with the same name and flattens the arrays (Ruby) or lists (Java) returned when a setting is registered with a deprecated alias. `get_setting` raises "doesn't exist. Please check if you haven't made a typo" for unknown names, so `get`, `set`, `set?` and `get_default` all fail loudly on a misspelt key.

Sources: [logstash-core/lib/logstash/settings.rb:79-152](repo://logstash-core/lib/logstash/settings.rb#L79-L152)

`set_value` takes a `graceful` flag. When a YAML key names a setting that is not registered yet, a graceful set stores it in `@transient_settings` instead of failing. `validate_all` merges those transient values again, this time strictly, and then validates every setting. The delay exists because universal plugins (the x-pack extensions among them) register their settings after `logstash.yml` is read, as described in [[X-Pack Extensions and License Checking]].

Sources: [logstash-core/lib/logstash/settings.rb:79-86](repo://logstash-core/lib/logstash/settings.rb#L79-L86), [logstash-core/lib/logstash/settings.rb:143-152](repo://logstash-core/lib/logstash/settings.rb#L143-L152), [logstash-core/lib/logstash/settings.rb:217-224](repo://logstash-core/lib/logstash/settings.rb#L217-L224)

| Method | Use |
| --- | --- |
| `get_subset(regexp)` / `clone` | New registry holding clones of matching settings; each pipeline gets a clone |
| `to_hash` | Name to value, skipping deprecated aliases |
| `merge_pipeline_settings(hash)` | Merge only keys in `PIPELINE_SETTINGS_WHITE_LIST`, raising for others |
| `format_settings` | Lines for the debug log, `*` marks a modified value |
| `post_process` / `on_post_process` | Run registered callbacks after YAML and flags are applied |
| `==` | Equal when `to_hash` is equal; used to compare pipeline configs |

Sources: [logstash-core/lib/logstash/settings.rb:111-189](repo://logstash-core/lib/logstash/settings.rb#L111-L189), [logstash-core/lib/logstash/settings.rb:197-229](repo://logstash-core/lib/logstash/settings.rb#L197-L229)

## Loading logstash.yml

`from_yaml` reads `logstash.yml` with `YAML.safe_load`, flattens nested keys into dotted names (`pipeline: { workers: 4 }` becomes `pipeline.workers`), runs `deep_replace` to resolve `${VAR}` references, and merges the result gracefully. [[Secret Store and Variable Substitution]] explains how `${VAR}` is looked up in the keystore and the environment.

Sources: [logstash-core/lib/logstash/settings.rb:191-195](repo://logstash-core/lib/logstash/settings.rb#L191-L195), [logstash-core/lib/logstash/settings.rb:232-244](repo://logstash-core/lib/logstash/settings.rb#L232-L244)

`SettingsHelper.from_yaml` chooses the directory: `--path.settings DIR`, `--path.settings=DIR`, then the `LS_SETTINGS_DIR` environment variable. It also points `keystore.file` at `logstash.keystore` in that directory. The shipped `config/logstash.yml` lists every setting commented out with its default.

Sources: [logstash-core/lib/logstash/util/settings_helper.rb:45-88](repo://logstash-core/lib/logstash/util/settings_helper.rb#L45-L88), [config/logstash.yml:85-140](repo://config/logstash.yml#L85-L140)

## Defaults

| Setting | Type | Default |
| --- | --- | --- |
| `node.name` | `SettingString` | host name |
| `path.data` | `WritableDirectory` | `LOGSTASH_HOME/data` |
| `pipeline.id` | `SettingString` | `main` |
| `pipeline.workers` | `SettingPositiveInteger` | `CpuCoreStrategy.maximum` |
| `pipeline.batch.size` | `SettingPositiveInteger` | `125` |
| `pipeline.batch.delay` | `SettingNumeric` | `50` (ms) |
| `pipeline.ordered` | `CoercibleString` | `auto` (`auto`, `true`, `false`) |
| `pipeline.ecs_compatibility` | `CoercibleString` | `v8` (`disabled`, `v1`, `v8`) |
| `config.reload.interval` | `TimeValue` | `3s` |
| `config.field_reference.escape_style` | `SettingString` | `none` (`none`, `percent`, `ampersand`) |
| `api.http.port` | `PortRange` | `9600..9700` |
| `queue.type` | `SettingString` | `memory` (`persisted`, `memory`) |
| `queue.page_capacity` / `queue.max_bytes` | `Bytes` | `64mb` / `1024mb` |
| `dead_letter_queue.storage_policy` | `SettingString` | `drop_newer` (`drop_older`) |
| `keystore.classname` | `SettingString` | `org.logstash.secret.store.backend.JavaKeyStore` |
| `pipeline.buffer.type` | `SettingString` | `heap` (`direct`) |

Sources: [logstash-core/lib/logstash/environment.rb:36-108](repo://logstash-core/lib/logstash/environment.rb#L36-L108)

`path.queue` and `path.dead_letter_queue` default to `queue` and `dead_letter_queue` under `path.data`. Because their defaults are computed before flags are parsed, a post-process callback recomputes them when the user changed `path.data` but not the derived path. Another callback copies `path.logs`, `log.format`, `log.level` and `pipeline.separate_logs` into `ls.*` system properties, reconfigures Log4j from `log4j2.properties` in `path.settings` unless `log4j.configurationFile` is set, and applies `log.level` ([[Logging]]).

Sources: [logstash-core/lib/logstash/environment.rb:110-148](repo://logstash-core/lib/logstash/environment.rb#L110-L148)

## Setting types

### Java core

The value logic lives in Java. `BaseSetting<T>` stores the name, default, current value, a `valueIsSet` flag, a `strict` flag and a `Predicate` validator. `value()` returns the default until something is set; a strict setting validates its default on construction and every value in `setSafely`; `reset` clears the value. `format` prints `*name: value (default: d)` for changed settings.

Sources: [logstash-core/src/main/java/org/logstash/settings/BaseSetting.java:29-108](repo://logstash-core/src/main/java/org/logstash/settings/BaseSetting.java#L29-L108), [logstash-core/src/main/java/org/logstash/settings/BaseSetting.java:129-193](repo://logstash-core/src/main/java/org/logstash/settings/BaseSetting.java#L129-L193)

`Coercible<T>` adds a `coerce(Object)` step before validation, so a string from YAML or a flag becomes the right type. Ruby imports the Java `Boolean`, `SettingNumeric`, `SettingInteger`, `SettingPositiveInteger`, `SettingString` and `SettingNullableString` classes under `LogStash::Setting`.

Sources: [logstash-core/src/main/java/org/logstash/settings/Coercible.java:24-52](repo://logstash-core/src/main/java/org/logstash/settings/Coercible.java#L24-L52), [logstash-core/lib/logstash/settings.rb:413-484](repo://logstash-core/lib/logstash/settings.rb#L413-L484)

### Ruby wrappers

`LogStash::Setting` wraps a `BaseSetting` built with the same name, default and validator, and adds a Ruby class check: `set` raises "must be a ..." when the value is not an instance of the declared class, and "Failed to validate setting" when the validator block returns false. `Setting::Coercible` coerces the default before building the wrapper.

Sources: [logstash-core/lib/logstash/settings.rb:247-366](repo://logstash-core/lib/logstash/settings.rb#L247-L366), [logstash-core/lib/logstash/settings.rb:368-411](repo://logstash-core/lib/logstash/settings.rb#L368-L411)

| Type | Accepts |
| --- | --- |
| `Port` | Integer 1–65535 |
| `PortRange` | `9600`, `"9600-9700"` or a Range within 1–65535 |
| `Password` | String wrapped in `LogStash::Util::Password` so it is not logged |
| `ValidatedPassword` | Password checked against a policy |
| `CoercibleString` | String from a fixed list |
| `ExistingFilePath` | Path that must exist |
| `WritableDirectory` | Writable directory; not a symlink; created on first read |
| `Bytes` | `"64mb"` and similar, coerced to a byte count |
| `TimeValue` | `"3s"`, `"500ms"`; a bare number is nanoseconds |
| `StringArray` / `SplittableStringArray` | Arrays, optionally split from a comma string |
| `Nullable` | Any of the above, also allowing `nil` |

Sources: [logstash-core/lib/logstash/settings.rb:422-529](repo://logstash-core/lib/logstash/settings.rb#L422-L529), [logstash-core/lib/logstash/settings.rb:553-660](repo://logstash-core/lib/logstash/settings.rb#L553-L660), [logstash-core/lib/logstash/settings.rb:675-745](repo://logstash-core/lib/logstash/settings.rb#L675-L745)

`WritableDirectory` validates without creating anything: an existing path must be a writable directory, and a missing path needs a writable parent. Its `value` reader creates the directory with `mkdir_p` the first time it is read.

Sources: [logstash-core/lib/logstash/settings.rb:583-626](repo://logstash-core/lib/logstash/settings.rb#L583-L626)

## Deprecated aliases

`with_deprecated_alias(old_name, obsoleted_version)` returns two settings: the canonical setting wrapped in `SettingWithDeprecatedAlias`, and a `DeprecatedAlias` that is a clone renamed with `BaseSetting#deprecate`. Setting the alias logs a deprecation (again after post-processing, once logging is configured). Reading the alias logs a warning and returns the canonical value. Validation fails when both names are set.

Sources: [logstash-core/lib/logstash/settings.rb:763-830](repo://logstash-core/lib/logstash/settings.rb#L763-L830), [logstash-core/src/main/java/org/logstash/settings/BaseSetting.java:110-123](repo://logstash-core/src/main/java/org/logstash/settings/BaseSetting.java#L110-L123)

## Per-pipeline settings

Only the keys in `PIPELINE_SETTINGS_WHITE_LIST` may differ between pipelines: `pipeline.*` (id, workers, batch size and delay, ordered, ecs_compatibility, reloadable, system, plugin_classloaders), `queue.*`, `dead_letter_queue.*`, `path.config`, `path.queue`, `path.dead_letter_queue`, `config.*` and `metric.collect`. A pipeline starts from a clone of the global settings and merges its overrides through `merge_pipeline_settings`, which rejects any other key.

Sources: [logstash-core/lib/logstash/settings.rb:43-77](repo://logstash-core/lib/logstash/settings.rb#L43-L77), [logstash-core/lib/logstash/settings.rb:168-175](repo://logstash-core/lib/logstash/settings.rb#L168-L175)
