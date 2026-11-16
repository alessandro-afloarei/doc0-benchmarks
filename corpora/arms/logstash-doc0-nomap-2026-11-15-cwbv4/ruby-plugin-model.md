---
title: "Ruby Plugin Model"
---
## Overview

Almost every Logstash plugin is a Ruby class, shipped as a gem, that subclasses one of four base classes: `LogStash::Inputs::Base`, `LogStash::Filters::Base`, `LogStash::Outputs::Base` or `LogStash::Codecs::Base`. They all descend from `LogStash::Plugin`, which gives every plugin an id, metrics, an execution context and the `config` DSL from `LogStash::Config::Mixin`. A plugin declares its options with `config`, implements `register` and one processing method, and Logstash takes care of parsing, validating and assigning the options. How a plugin name in a config file is turned into one of these classes, and how filters and outputs are wrapped for execution, is on [[Plugin Registry and Factory]]; the Java alternative is on [[Java Plugin API]].

Sources: [logstash-core/lib/logstash/plugin.rb:27-81](repo://logstash-core/lib/logstash/plugin.rb#L27-L81), [logstash-core/lib/logstash/config/mixin.rb:49-60](repo://logstash-core/lib/logstash/config/mixin.rb#L49-L60)

## A minimal plugin

```ruby
class LogStash::Filters::Example < LogStash::Filters::Base
  config_name "example"
  config :message, :validate => :string, :default => "Hello World!"

  def register; end

  def filter(event)
    event.set("message", @message)
    filter_matched(event)
  end
end
```

Sources: [lib/pluginmanager/templates/filter-plugin/lib/logstash/filters/example.rb.erb:1-42](repo://lib/pluginmanager/templates/filter-plugin/lib/logstash/filters/example.rb.erb#L1-L42), [logstash-core/lib/logstash/filters/base.rb:138-153](repo://logstash-core/lib/logstash/filters/base.rb#L138-L153)

## LogStash::Plugin

Every plugin gets two options from the base class: `id` (a string) and `enable_metric` (default true). The constructor deep-clones the params, sets up a slow logger from the `slowlog.threshold.*` settings, and generates `id` as `<config_name>_<uuid>` when none was given; in a running pipeline the factory always passes the vertex id from the graph ([[Pipeline Intermediate Representation]]).

Sources: [logstash-core/lib/logstash/plugin.rb:38-91](repo://logstash-core/lib/logstash/plugin.rb#L38-L91)

| Method | Purpose |
| --- | --- |
| `id` | Plugin id from params |
| `metric` | The plugin's namespaced metric, or a null metric when `enable_metric => false` |
| `execution_context` | Pipeline, agent and DLQ writer for this plugin ([[Dead Letter Queue]]) |
| `do_close` / `close` | Called at shutdown; `do_close` also deletes the plugin's metadata store |
| `reloadable?` | Class-level, true by default; a non-reloadable plugin blocks pipeline reloads |
| `plugin_metadata` | Per-plugin key/value store that outlives restarts of the plugin within the process |
| `debug_info` | Class name and original params, used in stall reports |

Sources: [logstash-core/lib/logstash/plugin.rb:93-194](repo://logstash-core/lib/logstash/plugin.rb#L93-L194)

## The config DSL

### Declaring options

`include LogStash::Config::Mixin` extends the class with `DSL`. `config_name "grok"` sets the name used in configs. `config :name, opts` records the option and defines a reader and writer for `@name` unless `:attr_accessor => false`. Options are inherited: `inherited` copies the parent's option table into each subclass, which is how every input gets `codec`, `tags` and `add_field` from `Inputs::Base`. A config name may also be a `Regexp`, matching any parameter name.

Sources: [logstash-core/lib/logstash/config/mixin.rb:167-255](repo://logstash-core/lib/logstash/config/mixin.rb#L167-L255)

| Option key | Effect |
| --- | --- |
| `:validate` | Type or list of allowed values, see below |
| `:default` | Value used when the option is absent |
| `:required` | Missing (or empty `:list`) is an error |
| `:list` | Accept a scalar or array, validate each element |
| `:deprecated` | Log a deprecation when used; a string adds a hint (`%PLUGIN%` is replaced) |
| `:obsolete` | Using it is a `ConfigurationError`; the option is then removed from params |

Sources: [logstash-core/lib/logstash/config/mixin.rb:119-153](repo://logstash-core/lib/logstash/config/mixin.rb#L119-L153), [logstash-core/lib/logstash/config/mixin.rb:299-339](repo://logstash-core/lib/logstash/config/mixin.rb#L299-L339)

### Validators

`validate_value` resolves `${VAR}` references first ([[Secret Store and Variable Substitution]]), then applies the validator. An array validator means "one of these values". Symbol validators convert as well as check.

Sources: [logstash-core/lib/logstash/config/mixin.rb:413-505](repo://logstash-core/lib/logstash/config/mixin.rb#L413-L505), [logstash-core/lib/logstash/config/mixin.rb:521-606](repo://logstash-core/lib/logstash/config/mixin.rb#L521-L606)

| Validator | Accepts and produces |
| --- | --- |
| `:string`, `:number`, `:boolean` | Single value of that type (strings `"true"`/`"false"` become booleans) |
| `:array`, `:hash` | Arrays; hashes |
| `:codec` | A codec name or instance |
| `:password` | Wrapped in `LogStash::Util::Password` so it is masked in logs |
| `:uri`, `:uri_list` | `SafeURI` objects that hide credentials |
| `:path` | Existing file paths |
| `:bytes` | `"10MiB"` and similar, converted to a number |
| `:ipaddr` | IPv4 or IPv6 address |
| `:field_reference` | A valid field reference |
| `:sha_256_hex` | A SHA-256 fingerprint, normalised to upper-case hex |

Sources: [logstash-core/lib/logstash/config/mixin.rb:413-505](repo://logstash-core/lib/logstash/config/mixin.rb#L413-L505), [logstash-core/lib/logstash/config/mixin.rb:521-606](repo://logstash-core/lib/logstash/config/mixin.rb#L521-L606)

### What config_init does

Each base class calls `config_init(@params)` from its constructor, which runs seven steps.

Sources: [logstash-core/lib/logstash/config/mixin.rb:62-165](repo://logstash-core/lib/logstash/config/mixin.rb#L62-L165), [logstash-core/lib/logstash/config/mixin.rb:257-375](repo://logstash-core/lib/logstash/config/mixin.rb#L257-L375)

1. Fill in defaults for absent options (cloning non-scalar defaults so instances never share them).
2. Replace `${VAR}` references in all values.
3. Turn codec names into codec instances wrapped in `LogStash::Codecs::Delegator`.
4. Run `validate`: unknown option names, missing required options, and invalid values are logged one by one, then a single `ConfigurationError` is raised.
5. Mask password and URI values in the stored `original_params`.
6. Log deprecations and raise for obsolete options.
7. Assign each param to an instance variable (`@message`) and keep the hash as `@config`.

Sources: [logstash-core/lib/logstash/config/mixin.rb:62-165](repo://logstash-core/lib/logstash/config/mixin.rb#L62-L165), [logstash-core/lib/logstash/config/mixin.rb:257-375](repo://logstash-core/lib/logstash/config/mixin.rb#L257-L375)

## Inputs

`LogStash::Inputs::Base` adds `type`, `tags`, `add_field` and `codec` (default `plain`). An input implements `register` and `run(queue)`, pushing events with `queue << event` until `stop?` is true; the pipeline calls `do_stop`, which sets the flag and calls the plugin's `stop`. `decorate(event)` sets `type` when not already present and applies `add_field` and `tags`; inputs call it on each event they create. `LogStash::Inputs::Threadable` adds a `threads` option, and the pipeline clones such inputs once per extra thread ([[Pipeline Lifecycle]]).

Sources: [logstash-core/lib/logstash/inputs/base.rb:24-141](repo://logstash-core/lib/logstash/inputs/base.rb#L24-L141), [logstash-core/lib/logstash/inputs/threadable.rb:18-33](repo://logstash-core/lib/logstash/inputs/threadable.rb#L18-L33)

Old options `debug`, `format`, `charset` and `message_format` are obsolete. `fix_streaming_codecs` lets a stream-oriented input replace `plain` with `line` and `json` with `json_lines`.

Sources: [logstash-core/lib/logstash/inputs/base.rb:42-61](repo://logstash-core/lib/logstash/inputs/base.rb#L42-L61), [logstash-core/lib/logstash/inputs/base.rb:143-158](repo://logstash-core/lib/logstash/inputs/base.rb#L143-L158)

## Filters

`LogStash::Filters::Base` adds the common decorations `add_tag`, `remove_tag`, `add_field`, `remove_field`, and `periodic_flush`; `type`, `tags` and `exclude_tags` are obsolete in favour of conditionals. A filter implements `filter(event)` and may `yield` new events. The compiled pipeline calls `multi_filter(events)`, which skips cancelled events, runs `do_filter` on each (timing it for the slow log) and collects the original events plus any yielded ones.

Sources: [logstash-core/lib/logstash/filters/base.rb:22-55](repo://logstash-core/lib/logstash/filters/base.rb#L22-L55), [logstash-core/lib/logstash/filters/base.rb:106-186](repo://logstash-core/lib/logstash/filters/base.rb#L106-L186)

`filter_matched(event)` is what a filter calls on success to apply the decorations, in the order `add_field`, `remove_field`, `add_tag`, `remove_tag`. Field names, values and tags are expanded with `sprintf`, so `add_field => { "from_%{host}" => "%{message}" }` works ([[Field References and String Interpolation]]). Adding to a field that exists turns it into an array.

Sources: [logstash-core/lib/logstash/filters/base.rb:194-226](repo://logstash-core/lib/logstash/filters/base.rb#L194-L226), [logstash-core/lib/logstash/util/decorators.rb:28-64](repo://logstash-core/lib/logstash/util/decorators.rb#L28-L64)

Filters are thread-safe by default (`@threadsafe = true`). A filter that sets it to false makes the pipeline default to a single worker. A filter that defines `flush` is flushed at shutdown, and every 5 seconds as well when it sets `periodic_flush` ([[Worker Loop and Batches]]).

Sources: [logstash-core/lib/logstash/filters/base.rb:132-143](repo://logstash-core/lib/logstash/filters/base.rb#L132-L143), [logstash-core/lib/logstash/filters/base.rb:187-190](repo://logstash-core/lib/logstash/filters/base.rb#L187-L190), [logstash-core/lib/logstash/java_pipeline.rb:105-127](repo://logstash-core/lib/logstash/java_pipeline.rb#L105-L127)

## Outputs

`LogStash::Outputs::Base` adds `codec`. An output implements `receive(event)`, or overrides `multi_receive(events)` to handle a batch, or defines `multi_receive_encoded(pairs)` to receive `[event, encoded]` pairs produced by its codec's `multi_encode`. The `workers` option is legacy: any value other than 1 raises a `ConfigurationError`.

Sources: [logstash-core/lib/logstash/outputs/base.rb:22-114](repo://logstash-core/lib/logstash/outputs/base.rb#L22-L114)

The class method `concurrency` tells Logstash how to share an output across workers.

Sources: [logstash-core/lib/logstash/outputs/base.rb:42-64](repo://logstash-core/lib/logstash/outputs/base.rb#L42-L64)

| Concurrency | Declared by | Meaning |
| --- | --- | --- |
| `:legacy` | default | Treated as not thread-safe |
| `:single` | `concurrency :single` or `declare_workers_not_supported!` | One instance, one worker at a time |
| `:shared` | `concurrency :shared` or `declare_threadsafe!` | One instance, called concurrently by all workers |

Sources: [logstash-core/lib/logstash/outputs/base.rb:42-64](repo://logstash-core/lib/logstash/outputs/base.rb#L42-L64)

The output delegator chooses a strategy from this value ([[Plugin Registry and Factory]]). `pipeline_shutdown_requested?` lets a long-retrying output check whether its pipeline is stopping.

Sources: [logstash-core/lib/logstash/outputs/base.rb:116-139](repo://logstash-core/lib/logstash/outputs/base.rb#L116-L139)

## Codecs

`LogStash::Codecs::Base` is the parent of codecs used inside inputs and outputs. Its constructor calls `register` itself. A codec implements `decode(data) { |event| ... }` for inputs and `encode(event)` for outputs, emitting through the block set by `on_event`. `multi_encode(events)` returns `[event, data]` pairs: directly from `encode_sync` when the codec defines it, otherwise by collecting what `encode` emits into a thread-local batch. `clone` builds a new, contextualised instance with the same params, which is how cloned inputs and per-worker outputs get their own codec.

Sources: [logstash-core/lib/logstash/codecs/base.rb:21-98](repo://logstash-core/lib/logstash/codecs/base.rb#L21-L98)

## Mixed-in support modules

`ECSCompatibilitySupport` adds an `ecs_compatibility` option to every plugin, accepting `disabled` or `v1`, `v8` and so on. When a plugin does not set it, the reader falls back to the pipeline's `pipeline.ecs_compatibility` setting (default `v8`), so one setting switches all plugins of a pipeline between legacy and ECS field names.

Sources: [logstash-core/lib/logstash/plugins/ecs_compatibility_support.rb:1-46](repo://logstash-core/lib/logstash/plugins/ecs_compatibility_support.rb#L1-L46)

`EventFactorySupport` gives `event_factory`, whose `new_event(hash)` builds a `LogStash::Event`, and `targeted_event_factory`, which nests the payload under the plugin's `target` option when one is set. Inputs and codecs that decode data use these instead of `LogStash::Event.new` so that `target` behaves the same everywhere.

Sources: [logstash-core/lib/logstash/plugins/event_factory_support.rb:1-66](repo://logstash-core/lib/logstash/plugins/event_factory_support.rb#L1-L66)
