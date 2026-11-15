---
title: "Plugin Packs and Generator"
---
## Overview

Two `bin/logstash-plugin` features sit beside the normal install flow described on [[Plugin Manager CLI]]. Offline packs move plugins to machines without internet access: `prepare-offline-pack` zips installed plugins with all their dependencies on a connected machine, and `install` on the target accepts that zip as a local file or URL and installs it without contacting RubyGems. The `generate` command scaffolds a new plugin gem from templates, giving plugin authors a working starting point for the APIs described on [[Ruby Plugin Model]].

Sources: [lib/pluginmanager/main.rb:48-58](repo://lib/pluginmanager/main.rb#L48-L58)

## Creating an offline pack

`bin/logstash-plugin prepare-offline-pack [--output FILE] [--overwrite] PLUGIN...` requires at least one plugin name or wildcard pattern such as `logstash-filter-*`. The output defaults to `logstash-offline-plugins-<version>.zip` in the Logstash home, must end in `.zip`, must not be a directory, and is only replaced with `--overwrite`. On success it prints the `bin/logstash-plugin install file://...` command to use on the target.

Sources: [lib/pluginmanager/prepare_offline_pack.rb:21-91](repo://lib/pluginmanager/prepare_offline_pack.rb#L21-L91)

`OfflinePluginPackager` does the work in four steps.

Sources: [lib/pluginmanager/offline_plugin_packager.rb:26-134](repo://lib/pluginmanager/offline_plugin_packager.rb#L26-L134)

1. Refuse to pack `logstash-core`, `logstash-core-plugin-api`, `jar-dependencies` or any `mixin` gem explicitly; these come with Logstash or as dependencies.
2. Expand each pattern against installed gem specifications; a pattern matching nothing raises "Cannot find plugins matching ... Please install these before creating the offline pack".
3. Use the `paquet` library (in `tools/paquet`) to collect each plugin gem and its runtime dependencies from `vendor/cache` into a temporary directory, ignoring the core gems.
4. Sort the `.gem` files into `logstash/` (the plugins asked for) and `logstash/dependencies/` (everything else), and zip the result.

Sources: [lib/pluginmanager/offline_plugin_packager.rb:26-134](repo://lib/pluginmanager/offline_plugin_packager.rb#L26-L134)

## Installing a pack

`install` asks `InstallStrategyFactory` for an installer before doing anything else. The first argument is checked against two strategies in order, as the table below shows.

Sources: [lib/pluginmanager/install_strategy_factory.rb:23-46](repo://lib/pluginmanager/install_strategy_factory.rb#L23-L46), [lib/pluginmanager/install.rb:38-64](repo://lib/pluginmanager/install.rb#L38-L64)

| Strategy | Matches | Installer |
| --- | --- | --- |
| `PackFetchStrategy::Uri` | `file://...` | `PackInstaller::Local` on the path |
| `PackFetchStrategy::Uri` | `http://` or `https://` URL | `PackInstaller::Remote` |
| `PackFetchStrategy::Repository` | A plain name for which `<base>/<name>/<name>-<version>.zip` exists | `PackInstaller::Remote` |

Sources: [lib/pluginmanager/pack_fetch_strategy/uri.rb:25-60](repo://lib/pluginmanager/pack_fetch_strategy/uri.rb#L25-L60), [lib/pluginmanager/pack_fetch_strategy/repository.rb:27-64](repo://lib/pluginmanager/pack_fetch_strategy/repository.rb#L27-L64)

The repository strategy lets Elastic publish packs: the base URL is `https://artifacts.elastic.co/downloads/logstash-plugins`, or `LOGSTASH_PACK_URL` when set, and the version is the running Logstash version. Network errors make it step aside so the normal RubyGems install runs instead. When no strategy matches, `install` continues with the regular flow.

Sources: [lib/pluginmanager/pack_fetch_strategy/repository.rb:29-61](repo://lib/pluginmanager/pack_fetch_strategy/repository.rb#L29-L61), [lib/pluginmanager/install_strategy_factory.rb:30-44](repo://lib/pluginmanager/install_strategy_factory.rb#L30-L44)

`PackInstaller::Remote` downloads the file with a progress bar and hands it to the local installer, deleting the download afterwards.

Sources: [lib/pluginmanager/pack_installer/remote.rb:22-41](repo://lib/pluginmanager/pack_installer/remote.rb#L22-L41)

`PackInstaller::Local.execute` takes these steps.

Sources: [lib/pluginmanager/pack_installer/local.rb:25-83](repo://lib/pluginmanager/pack_installer/local.rb#L25-L83)

1. Check the file exists and has a `.zip` extension.
2. Extract only entries under `logstash/` into a temporary directory.
3. Build a `Pack` from the `.gem` files found there: name, version and platform parsed from each file name, and whether it is a dependency (it sits under a `dependencies` directory). A pack without at least one plugin is invalid.
4. Install each gem file into Logstash's gem home with `GemInstaller`, collecting post-install messages from plugins.
5. Update the `Gemfile` and lock file with `Bundler::LogstashInjector`.
6. Print the messages and "Install successful", then remove the temporary directory.

Sources: [lib/pluginmanager/pack_installer/local.rb:36-82](repo://lib/pluginmanager/pack_installer/local.rb#L36-L82), [lib/pluginmanager/pack_installer/pack.rb:38-96](repo://lib/pluginmanager/pack_installer/pack.rb#L38-L96)

`LogstashInjector` is a variant of Bundler's injector that resolves only locally. It pins each plugin in the `Gemfile` to the exact version from the pack, also updates dependencies that the `Gemfile` already names to the packed versions, re-locks with the `java` platform, and never contacts a remote source. This is why a pack installs on an offline host.

Sources: [lib/pluginmanager/bundler/logstash_injector.rb:40-110](repo://lib/pluginmanager/bundler/logstash_injector.rb#L40-L110)

Errors from Bundler surface as `InstallError`, a missing file as `FileNotFoundError`, and a bad archive as `InvalidPackError`; the install command reports each with its own message.

Sources: [lib/pluginmanager/pack_installer/local.rb:36-78](repo://lib/pluginmanager/pack_installer/local.rb#L36-L78), [lib/pluginmanager/install.rb:51-63](repo://lib/pluginmanager/install.rb#L51-L63)

## The deprecated pack and unpack commands

`pack` and `unpack` predate offline packs and print a deprecation warning. `pack` runs Bundler's package step for all installed gems into `vendor/cache` and archives that directory as `plugins_package.tar.gz` (or `.zip` on Windows). `unpack FILE` extracts such an archive back into `vendor/cache`, after which `install --local` installs from it.

Sources: [lib/pluginmanager/pack.rb:20-61](repo://lib/pluginmanager/pack.rb#L20-L61), [lib/pluginmanager/unpack.rb:20-53](repo://lib/pluginmanager/unpack.rb#L20-L53)

## Generating a new plugin

`bin/logstash-plugin generate --type TYPE --name NAME [--path DIR]` creates `logstash-<type>-<name>` in the given directory (default: current directory). `TYPE` must be `input`, `filter`, `output` or `codec`.

Sources: [lib/pluginmanager/generate.rb:25-53](repo://lib/pluginmanager/generate.rb#L25-L53)

The command copies `lib/pluginmanager/templates/<type>-plugin` recursively. Files ending in `.erb` are rendered and written without the extension, with `example` in their names replaced by the plugin name; other files are copied as they are. Rendering uses a `RenderContext` exposing `plugin_name`, `author` and `email` (from `git config`, with placeholders when git is unavailable), `min_version` and `logstash_path`, plus a `classify` helper that turns `my-plugin` into `MyPlugin` for class names.

Sources: [lib/pluginmanager/generate.rb:55-108](repo://lib/pluginmanager/generate.rb#L55-L108), [lib/pluginmanager/templates/render_context.rb:20-37](repo://lib/pluginmanager/templates/render_context.rb#L20-L37)

Each template is a complete gem: a `.gemspec` with the `logstash_plugin` metadata the registry looks for, a `Gemfile`, `Rakefile`, `README.md`, `CHANGELOG.md`, `DEVELOPER.md`, docs in AsciiDoc, an RSpec spec, and the plugin class under `lib/logstash/<type>s/`. The filter template, for instance, defines a class with `config_name`, a `message` option, and a `filter` method that sets the field and calls `filter_matched`.

Sources: [lib/pluginmanager/templates/filter-plugin/lib/logstash/filters/example.rb.erb:1-42](repo://lib/pluginmanager/templates/filter-plugin/lib/logstash/filters/example.rb.erb#L1-L42), [lib/pluginmanager/templates/filter-plugin/logstash-filter-example.gemspec.erb:1-23](repo://lib/pluginmanager/templates/filter-plugin/logstash-filter-example.gemspec.erb#L1-L23)
