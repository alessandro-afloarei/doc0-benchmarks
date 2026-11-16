---
title: "Build System"
---
## Overview

Logstash is built by Gradle and Rake together. Gradle compiles the Java code, downloads JRuby and the bundled JDK, runs tests, and is the entry point developers use (`./gradlew bootstrap`, `installDefaultGems`, `assembleTarDistribution`). Ruby-side work (installing gems with Bundler, installing default plugins, building packages) lives in Rake tasks under `rakelib/`, which Gradle runs inside an embedded JRuby. Versions of Logstash, JRuby, the JDK and key libraries are pinned in `versions.yml`. Packaging is on [[Packaging and Distribution]], test tasks on [[Testing]], and the developer workflow on [[Quickstart: Build and Run from Source]].

Sources: [build.gradle:289-320](repo://build.gradle#L289-L320), [rubyUtils.gradle:150-211](repo://rubyUtils.gradle#L150-L211), [versions.yml:1-29](repo://versions.yml#L1-L29)

## Projects

`settings.gradle` declares the Gradle projects and loads `versions.yml` into `gradle.ext.versions` for all of them.

Sources: [settings.gradle:1-25](repo://settings.gradle#L1-L25)

| Project | Directory | Content |
| --- | --- | --- |
| root | `.` | Distribution, JRuby, JDK, integration-test orchestration |
| `:logstash-core` | `logstash-core` | The Java engine, packaged into the `logstash-core` gem |
| `:logstash-core-benchmarks` | `logstash-core/benchmarks` | JMH benchmarks |
| `:benchmark-cli` | `tools/benchmark-cli` | Benchmark runner ([[Developer Tools]]) |
| `:jvm-options-parser` | `tools/jvm-options-parser` | Launcher helper ([[Startup and the Runner]]) |
| `:dependencies-report` | `tools/dependencies-report` | License report generator |
| `:logstash-integration-tests` | `qa/integration` | Integration test suite |
| `:logstash-xpack` | `x-pack` | Only when `OSS` is not `true` |

Sources: [settings.gradle:1-25](repo://settings.gradle#L1-L25)

Every project compiles Java 17 with `-Xlint:all -Werror`, so a compiler warning fails the build; Javadoc is also built with warnings as errors. Test JVMs get the `--add-exports`/`--add-opens` flags the compiler API needs and a 2 GB heap.

Sources: [build.gradle:51-131](repo://build.gradle#L51-L131)

## versions.yml

`versions.yml` is the single source of version numbers: `logstash`, `logstash-core` and `logstash-core-plugin-api`; the bundled JDK vendor, revision and build; the JRuby version and its SHA-256; and library versions such as `jrjackson` and `jackson`. The `rake version:set` family of tasks rewrites it. The version qualifier (alpha, beta) comes from the `VERSION_QUALIFIER` environment variable rather than the file.

Sources: [versions.yml:1-29](repo://versions.yml#L1-L29), [rakelib/version.rake:74-120](repo://rakelib/version.rake#L74-L120)

## JRuby

`rubyUtils.gradle` downloads `jruby-dist-<version>-bin.tar.gz` from Maven Central into `vendor/_`, verifies its SHA-256, and unpacks it into `vendor/jruby`. With `-Pcustom.jruby.path=<dir>` it instead builds JRuby from that source checkout with Maven and installs the result, skipping download and checksum.

Sources: [rubyUtils.gradle:217-300](repo://rubyUtils.gradle#L217-L300)

The same file provides two helpers used throughout the build. `executeJruby` runs a closure in a fresh embedded JRuby `ScriptingContainer` with `GEM_HOME` and `GEM_PATH` set to `vendor/bundle/jruby/3.1.0`, and tears the runtime down afterwards. `rake(projectDir, buildDir, task, args...)` uses it to load the `Rakefile` and invoke one task, printing the error and backtrace on failure. `setupJruby` loads `lib/bootstrap/environment` and runs `LogStash::Bundler.invoke!` to install the gems in the `Gemfile`.

Sources: [rubyUtils.gradle:150-211](repo://rubyUtils.gradle#L150-L211)

## Bootstrap and gems

| Gradle task | Does |
| --- | --- |
| `bootstrap` | Install JRuby, assemble every subproject (which copies the core jars into `logstash-core/lib/jars`), then `setupJruby` |
| `installDefaultGems` | `bootstrap`, then `rake plugin:install-default` |
| `installDevelopmentGems` | `bootstrap`, then `rake plugin:install-development-dependencies` |
| `compileGrammar` | `rake compile:grammar` ([[Configuration Language Parser]]) |
| `generatePluginsVersion` | `rake generate_plugins_version` after installing default gems |

Sources: [build.gradle:289-320](repo://build.gradle#L289-L320), [build.gradle:646-653](repo://build.gradle#L646-L653)

The plugin Rake tasks drive the [[Plugin Manager CLI]]: `plugin:install-default` deletes the lock file so the release lock is used and installs `DEFAULT_PLUGINS` with `--no-verify --preserve`; `plugin:install-development-dependencies` installs development dependencies and `CORE_SPECS_PLUGINS`. Other tasks remove non-OSS plugins, trim the plugin set for the observabilitySRE distribution, and build its FIPS validation plugin.

Sources: [rakelib/plugin.rake:24-100](repo://rakelib/plugin.rake#L24-L100), [rakelib/plugin.rake:102-145](repo://rakelib/plugin.rake#L102-L145)

The plugin lists come from `rakelib/plugins-metadata.json`, which marks each plugin gem with flags; `default_plugins.rb` turns them into `DEFAULT_PLUGINS` (`default-plugins`), `CORE_SPECS_PLUGINS` (`core-specs`), `ALL_PLUGINS_SKIP_LIST` (`skip-list`) and `OSS_EXCLUDED_PLUGINS` (default plugins flagged `skip-oss`).

Sources: [rakelib/default_plugins.rb:18-58](repo://rakelib/default_plugins.rb#L18-L58), [rakelib/plugins-metadata.json:1-20](repo://rakelib/plugins-metadata.json#L1-L20)

Running `rake bootstrap` directly does `vendor:all` (Bundler install unless a lock file already exists) and `compile:all` (grammar and `./gradlew assemble`); `vendor:jruby` calls `./gradlew bootstrap` when `vendor/jruby` is missing.

Sources: [rakelib/bootstrap.rake:18-18](repo://rakelib/bootstrap.rake#L18-L18), [rakelib/vendor.rake:18-45](repo://rakelib/vendor.rake#L18-L45), [rakelib/compile.rake:18-41](repo://rakelib/compile.rake#L18-L41)

## logstash-core artifacts

The `:logstash-core` build writes `version-info.properties` with the core version (read by `org.logstash.Logstash` at startup), copies runtime dependency jars except `jruby.jar` into `logstash-core/lib/jars`, and copies its own jar there without the version in the name, so the Ruby gem and `bin/logstash` find it on a fixed path.

Sources: [logstash-core/build.gradle:72-95](repo://logstash-core/build.gradle#L72-L95), [logstash-core/build.gradle:181-196](repo://logstash-core/build.gradle#L181-L196), [logstash-core/src/main/java/org/logstash/Logstash.java:48-75](repo://logstash-core/src/main/java/org/logstash/Logstash.java#L48-L75)

## Plugin alias definitions

`markAliasDefinitions` (the `SignAliasDefinitions` task in `buildSrc`) reads `AliasRegistry.yml`, prepends a `#CHECKSUM: <sha256>` line and a "do not edit" note, and writes `plugin_aliases_hashed.yml`. Copy tasks place it as `plugin_aliases.yml` in `lib/pluginmanager/` and in the core's Java resources; `:logstash-core:processResources` depends on this. Test variants do the same for the test definitions, and `clean` removes the copies ([[Plugin Registry and Factory]]).

Sources: [buildSrc/src/main/groovy/org/logstash/gradle/tooling/SignAliasDefinitions.groovy:9-50](repo://buildSrc/src/main/groovy/org/logstash/gradle/tooling/SignAliasDefinitions.groovy#L9-L50), [build.gradle:196-287](repo://build.gradle#L196-L287)

## Bundled JDK

`downloadJdk` computes the download URL for the JDK in `versions.yml` for the target OS and architecture (overridable with `-Pjdk_bundle_os`, `-Pjdk_arch` or the `JDK_URL` environment variable), and `untarJdk`, `unzipJdk`, `decompressJdk` and `copyJdk` unpack it into `jdk/` (or `jdk.app` on macOS) for packaging. `checkNewJdkVersion` fails when a newer build than the pinned one is available, and `extractBundledJdkVersion` writes the `JDK_VERSION` file the launcher reads.

Sources: [build.gradle:821-921](repo://build.gradle#L821-L921), [bin/logstash.lib.sh:102-109](repo://bin/logstash.lib.sh#L102-L109)

## Other tasks

| Task | Purpose |
| --- | --- |
| `lint` | RuboCop through `rake lint:report` |
| `generateLicenseReport` | Third-party license inventory through `:dependencies-report` |
| `downloadEs`, `downloadFilebeat` | Fetch matching Elasticsearch and Filebeat builds for integration tests |
| `rake docs:generate-plugins` | Generate plugin documentation |

Sources: [build.gradle:450-494](repo://build.gradle#L450-L494), [build.gradle:532-578](repo://build.gradle#L532-L578), [build.gradle:601-645](repo://build.gradle#L601-L645), [build.gradle:807-820](repo://build.gradle#L807-L820), [rakelib/docs.rake:23-35](repo://rakelib/docs.rake#L23-L35)
