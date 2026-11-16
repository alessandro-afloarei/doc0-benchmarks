---
title: "Plugin Manager CLI"
---
## Overview

Logstash plugins are Ruby gems, and the set installed in a Logstash home is described by its `Gemfile` and `Gemfile.lock` and stored under `vendor/bundle`. `bin/logstash-plugin` manages that set: it edits the `Gemfile`, runs Bundler inside the Logstash environment, and cleans up gems that are no longer referenced. This page covers listing, installing, updating and removing plugins; offline packs and the `generate` scaffolder are on [[Plugin Packs and Generator]]. Once installed, plugins are found at startup by the registry described on [[Plugin Registry and Factory]].

Sources: [bin/logstash-plugin:1-10](repo://bin/logstash-plugin#L1-L10), [lib/pluginmanager/main.rb:18-69](repo://lib/pluginmanager/main.rb#L18-L69)

## Entry point

`bin/logstash-plugin` sources the launcher library to find Java and the vendored JRuby, sets `JRUBY_OPTS=--dev` for faster startup, and runs `lib/pluginmanager/main.rb`. That script points `GEM_HOME` and `GEM_PATH` at Logstash's own gem directory, configures proxies, and dispatches to a Clamp subcommand. A `PluginManager::Error` prints its message and exits 1.

Sources: [bin/logstash-plugin:1-10](repo://bin/logstash-plugin#L1-L10), [lib/pluginmanager/main.rb:18-69](repo://lib/pluginmanager/main.rb#L18-L69)

| Subcommand | Purpose |
| --- | --- |
| `list [PATTERN]` | List installed plugins |
| `install PLUGIN...` | Install from RubyGems, a `.gem` file, or an offline pack |
| `update [PLUGIN...]` | Update named plugins, or all |
| `remove PLUGIN...` | Remove plugins (`uninstall` is a deprecated alias) |
| `generate` | Scaffold a new plugin |
| `prepare-offline-pack` | Build a zip of plugins for offline install |
| `pack`, `unpack` | Deprecated predecessors of `prepare-offline-pack` |

Sources: [lib/pluginmanager/main.rb:44-60](repo://lib/pluginmanager/main.rb#L44-L60)

## Shared machinery

Every command extends `PluginManager::Command`, which loads the `Gemfile` through `LogStash::Gemfile` and provides cleanup helpers. `LogStash::Gemfile` parses the file with a small DSL into a `Gemset` (sources, gems with requirements and options, gemspec), supports `find`, `add`, `update` (merge requirements and options), `overwrite` and `remove`, keeps a backup taken at load, and on `save` rewrites the whole file with a "generated Gemfile" header. Manual edits to formatting or comments are therefore lost on the next command.

Sources: [lib/pluginmanager/command.rb:19-39](repo://lib/pluginmanager/command.rb#L19-L39), [lib/pluginmanager/gemfile.rb:21-105](repo://lib/pluginmanager/gemfile.rb#L21-L105)

`LogStash::Bundler.invoke!` runs Bundler's CLI in-process with `BUNDLE_GEMFILE`, `BUNDLE_PATH` set to `vendor/bundle`, and the configured groups excluded (`development` by default). It creates the `Gemfile` from `Gemfile.template` and the lock file from `Gemfile.jruby-3.1.lock.release` when missing. Network and other transient errors are retried up to 10 times with a short sleep; a version conflict (`SolveFailure`) or missing gem (`GemNotFound`) aborts at once. Output is captured and shown only with `DEBUG=1`, which also makes commands raise full stack traces.

Sources: [lib/bootstrap/bundler.rb:125-220](repo://lib/bootstrap/bundler.rb#L125-L220), [lib/pluginmanager/command.rb:24-39](repo://lib/pluginmanager/command.rb#L24-L39)

After installing, updating or removing, two cleanups run. `remove_unused_locally_installed_gems!` deletes unpacked local gem directories under `vendor/local_gems` that the `Gemfile` no longer references. `remove_orphan_dependencies!` compares installed gem specs with the lock file and uninstalls every gem not in it: inactive plugins first, then orphaned dependencies, skipping JRuby's default gems.

Sources: [lib/pluginmanager/command.rb:41-74](repo://lib/pluginmanager/command.rb#L41-L74)

## Aliases

Some plugins are known under two names. `LogStash::PluginManager::ALIASES` is loaded from `plugin_aliases.yml` next to the plugin manager, a file generated at build time whose first line is `#CHECKSUM: <sha256>` of the YAML body; a mismatch raises `ValidationError`. Each entry maps `logstash-<type>-<alias>` to `logstash-<type>-<original>`.

Sources: [lib/pluginmanager/util.rb:21-58](repo://lib/pluginmanager/util.rb#L21-L58), [build.gradle:280-287](repo://build.gradle#L280-L287)

## list

`list` loads the bundle and selects installed gems that are Logstash plugins. `--installed` keeps only those named in the `Gemfile`, a positional pattern filters names case-insensitively, `--group` filters by the gem's `logstash_group` metadata (`input`, `filter`, `output`, `codec`, `integration`), and `--verbose` adds versions. With `--expand` (the default), aliases and the plugins bundled inside integration plugins are printed as a tree under their parent.

Sources: [lib/pluginmanager/list.rb:21-82](repo://lib/pluginmanager/list.rb#L21-L82)

## install

`install` first asks `InstallStrategyFactory` whether the argument is an offline pack (a URI or a file path to a zip); if so, the pack installer handles it ([[Plugin Packs and Generator]]). Otherwise:

Sources: [lib/pluginmanager/install.rb:38-64](repo://lib/pluginmanager/install.rb#L38-L64)

1. Validate options: `--development` takes no plugin names, `--version` allows one plugin, and the `Gemfile` must be writable.
2. Build the list: local `.gem` files (copied to `vendor/cache` and unpacked into `vendor/local_gems`, with a `:path` option); with `--development`, the development dependencies of every installed plugin; otherwise the named plugins.
3. With `--verify` (default) and not `--local`, query RubyGems for each name; the newest version's gemspec must carry `logstash_plugin` metadata. A name that fails but is an alias is remapped to the original plugin.
4. Refuse a plugin already provided by an installed integration plugin.
5. Unless `--preserve`, `--local` or a local file is involved, unlock shared `logstash-mixin-*` dependencies so they can move to versions the new plugin needs.
6. Write each plugin into the `Gemfile` (`overwrite`, or `update` with `--preserve` to keep existing options), save, and run Bundler install.
7. Remove plugins made redundant by a newly installed integration plugin, then run the cleanups.

Sources: [lib/pluginmanager/install.rb:66-153](repo://lib/pluginmanager/install.rb#L66-L153), [lib/pluginmanager/install.rb:177-286](repo://lib/pluginmanager/install.rb#L177-L286), [lib/pluginmanager/util.rb:69-98](repo://lib/pluginmanager/util.rb#L69-L98)

If Bundler fails, the `Gemfile` is restored from the backup and the error is reported as "Installation Aborted", so a failed install leaves the previous plugin set intact. `--local` sets `JARS_SKIP` and installs only from gems already in `vendor/cache`. Mixing `.gem` files and remote names in one command is rejected.

Sources: [lib/pluginmanager/install.rb:207-244](repo://lib/pluginmanager/install.rb#L207-L244), [lib/pluginmanager/install.rb:272-282](repo://lib/pluginmanager/install.rb#L272-L282)

## update

`update` with no names updates every installed plugin; with names, each must be installed (an alias of an installed plugin is remapped). `--level` restricts Bundler to `major`, `minor` (default) or `patch` changes, and `--[no-]conservative` controls whether shared dependencies may move. Plugins installed from a local `.gem` or defined with `:path`, `:git` or `:github` in the `Gemfile` are skipped with a warning. On success it prints the plugins whose version changed; on failure it restores the `Gemfile`.

Sources: [lib/pluginmanager/update.rb:22-134](repo://lib/pluginmanager/update.rb#L22-L134)

## remove

`remove` refuses an alias whose original is installed (remove the original instead), refuses `x-pack` with an explanation, refuses a plugin provided by an integration plugin, and checks that each name is installed. `Bundler::LogstashUninstall` then checks whether any remaining gem depends on the ones being removed; if so it prints which ones and removes nothing. Otherwise it deletes them from the `Gemfile`, re-locks without upgrading anything else, and saves. Cleanups follow.

Sources: [lib/pluginmanager/remove.rb:22-74](repo://lib/pluginmanager/remove.rb#L22-L74), [lib/pluginmanager/bundler/logstash_uninstall.rb:37-74](repo://lib/pluginmanager/bundler/logstash_uninstall.rb#L37-L74)

`XPackInterceptor` exists because x-pack used to be a plugin. Installing `x-pack` prints that it is already bundled (or that the OSS distribution cannot have it), and removing it explains that only the OSS distribution excludes it.

Sources: [lib/pluginmanager/x_pack_interceptor.rb:18-60](repo://lib/pluginmanager/x_pack_interceptor.rb#L18-L60)

## Proxies

`configure_proxy` reads `http_proxy` and `https_proxy` (either case) from the environment, applies them to the JVM proxy properties, and writes a Maven `settings.xml` in `~/.m2` from a template so that jar dependencies downloaded during install go through the same proxy. An existing `settings.xml` with different content is left alone with a warning.

Sources: [lib/pluginmanager/proxy_support.rb:18-125](repo://lib/pluginmanager/proxy_support.rb#L18-L125)
