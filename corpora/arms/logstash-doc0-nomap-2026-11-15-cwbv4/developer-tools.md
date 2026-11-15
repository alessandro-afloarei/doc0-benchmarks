---
title: "Developer Tools"
---
## Overview

Besides the engine, the repository holds tools for measuring, auditing, documenting and releasing Logstash. Two measure performance: the benchmark CLI runs whole Logstash installations against fixed workloads, and the JMH suite measures single core components. The dependency report checks the licences of everything Logstash ships, the doc generator renders plugin reference docs, `paquet` vendors gem dependencies, and the release scripts update plugin version locks and draft release notes. The JVM options parser in `tools/` belongs to the launcher and is described on [[Startup and the Runner]]; how the tools are built as Gradle projects is on [[Build System]].

Sources: [settings.gradle:1-25](repo://settings.gradle#L1-L25), [tools/benchmark-cli/README.md:1-12](repo://tools/benchmark-cli/README.md#L1-L12), [tools/dependencies-report/README.md:1-20](repo://tools/dependencies-report/README.md#L1-L20)

| Tool | Location | Use it to |
| --- | --- | --- |
| Benchmark CLI | `tools/benchmark-cli` | Compare throughput of Logstash versions or a local build |
| JMH microbenchmarks | `logstash-core/benchmarks` | Measure queues, event serialization, `sprintf`, the tokenizer |
| Dependency report | `tools/dependencies-report`, `bin/dependencies-report` | Check licences and notices for every shipped dependency |
| Plugin doc generator | `tools/logstash-docgen`, `rake docs:generate-plugins` | Render plugin reference docs |
| Paquet | `tools/paquet` | Bundle a gem's dependencies into a directory for offline install |
| Release scripts | `tools/release` | Bump plugin versions in the release lock file; draft release notes |

Sources: [tools/benchmark-cli/README.md:1-84](repo://tools/benchmark-cli/README.md#L1-L84), [logstash-core/benchmarks/Readme.md:1-8](repo://logstash-core/benchmarks/Readme.md#L1-L8), [tools/logstash-docgen/README.md:1-20](repo://tools/logstash-docgen/README.md#L1-L20), [tools/paquet/README.md:1-10](repo://tools/paquet/README.md#L1-L10), [tools/release/bump_plugin_versions.rb:26-39](repo://tools/release/bump_plugin_versions.rb#L26-L39)

## Benchmark CLI

### Choosing what to run

`gradle clean assemble` in `tools/benchmark-cli` builds a self-contained `benchmark-cli.jar`, run with `java -cp 'benchmark-cli.jar:*' org.logstash.benchmark.cli.Main`. Exactly one of three options picks the Logstash to test: `--distribution-version` downloads a release from elastic.co, `--git-hash` builds a git tree (optionally `user#ref` for a fork, bootstrapping its own JRuby), and `--local-path` uses an existing installation. Downloads and checkouts are cached in `--workdir` (default `~/.logstash-benchmarks`).

Sources: [tools/benchmark-cli/README.md:1-50](repo://tools/benchmark-cli/README.md#L1-L50), [tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java:65-133](repo://tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java#L65-L133), [tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java:204-214](repo://tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java#L204-L214)

| Test case | Workload |
| --- | --- |
| `baseline` (default) | `generator` input with one thread to `stdout` |
| `apache` | Apache access logs from stdin through GeoIP and UserAgent filters, `dots` codec output |
| `custom` | Your `--config`, with optional `--data`; config and data are refused for other cases |

Sources: [tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java:139-155](repo://tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java#L139-L155), [tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java:231-247](repo://tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java#L231-L247), [tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/cases/GeneratorToStdout.java:44-70](repo://tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/cases/GeneratorToStdout.java#L44-L70), [tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/cases/ApacheLogsComplex.java:44-60](repo://tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/cases/ApacheLogsComplex.java#L44-L60)

### Measuring

`--ls-workers` (default 2) and `--ls-batch-size` (default 128) become Logstash's `-w` and `-b`, and `--repeat-data` repeats the dataset. While the case runs, `LsMetricsMonitor` polls Logstash's node stats every second, computes events per second from the change in the `filtered` event count, and records CPU percentage and heap used ([[Monitoring API]]). At the end the CLI prints the elapsed time and the minimum, maximum, mean, standard deviation and variance of throughput plus mean CPU use; with `--elasticsearch-export` the results are also stored in Elasticsearch.

Sources: [tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java:177-229](repo://tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java#L177-L229), [tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java:249-259](repo://tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/Main.java#L249-L259), [tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/LsMetricsMonitor.java:56-150](repo://tools/benchmark-cli/src/main/java/org/logstash/benchmark/cli/LsMetricsMonitor.java#L56-L150)

The scheduled CI benchmark on [[Continuous Integration]] is a separate, Docker-based script; this CLI is for comparisons on one machine.

Sources: [.buildkite/scripts/benchmark/main.sh:1-20](repo://.buildkite/scripts/benchmark/main.sh#L1-L20)

## JMH microbenchmarks

`./gradlew jmh` cleans and builds a shaded `logstash-core-benchmarks-all.jar` from `logstash-core/benchmarks` and runs it with a 2 GB heap and heap dumps on out-of-memory. `-Pinclude=<regex>` restricts the run to matching benchmarks. The suite covers persistent queue reads and writes (`QueueRWBenchmark`, `QueueWriteBenchmark`, see [[Persistent Queue]]), event serialization, `Event#sprintf` ([[Field References and String Interpolation]]), the buffered tokenizer, and per-pipeline logging.

Sources: [logstash-core/benchmarks/build.gradle:66-90](repo://logstash-core/benchmarks/build.gradle#L66-L90), [logstash-core/benchmarks/Readme.md:1-8](repo://logstash-core/benchmarks/Readme.md#L1-L8)

## Dependency report

The report enforces three rules for every Ruby and Java dependency, direct or transitive, of Logstash core and the default plugins: it is listed in `licenseMapping.csv` with a URL and SPDX licence, its licence is in `acceptableLicenses.csv`, and a notice file for it exists under `notices/`. Run it as `bin/dependencies-report --csv report.csv`; it exits non-zero and prints how to fix each failing dependency.

Sources: [tools/dependencies-report/README.md:1-20](repo://tools/dependencies-report/README.md#L1-L20)

`bin/dependencies-report` runs `dependency_report_runner.rb`, which sets up Bundler without the build and development groups and calls `LogStash::DependencyReport`. That writes a CSV of the installed gems, of jars embedded in gems, and of a few extra dependencies, then runs `./gradlew generateLicenseReport` with it as input. The Java `Main` of `tools/dependencies-report` merges the Ruby CSV with the Gradle licence reports, checks them against the mapping and acceptable licences, writes the output CSV and the combined `NOTICE.txt`, and exits 1 if anything is unknown. CI runs it as the licence check, and the release build stores its CSV with the artifacts ([[Packaging and Distribution]]).

Sources: [bin/dependencies-report:1-33](repo://bin/dependencies-report#L1-L33), [logstash-core/lib/logstash/dependency_report_runner.rb:18-33](repo://logstash-core/lib/logstash/dependency_report_runner.rb#L18-L33), [logstash-core/lib/logstash/dependency_report.rb:29-66](repo://logstash-core/lib/logstash/dependency_report.rb#L29-L66), [tools/dependencies-report/src/main/java/org/logstash/dependencies/Main.java:38-70](repo://tools/dependencies-report/src/main/java/org/logstash/dependencies/Main.java#L38-L70), [ci/license_check.sh:1-12](repo://ci/license_check.sh#L1-L12)

## Plugin documentation generator

`rake docs:generate-plugins[<dir>]` generates reference docs for every plugin installed in this Logstash (default output `build/docs`); it needs the plugins and development gems installed, keeps going when one plugin fails, and reports the errors at the end. From `tools/logstash-docgen`, `bin/logstash-docgen --all` or `bin/logstash-docgen <plugin>...` generates docs from the `main` branch of plugins in the logstash-plugins organisation, skipping those listed in `logstash-docgen.yml`. Plugin authors can add the gem as a development dependency to get `rake doc:asciidoc` and `rake doc:html`.

Sources: [rakelib/docs.rake:18-40](repo://rakelib/docs.rake#L18-L40), [tools/logstash-docgen/README.md:1-86](repo://tools/logstash-docgen/README.md#L1-L86)

## Paquet

`paquet` builds an "uber gem" directory: a Rakefile declares `Paquet::Task.new(target)` with `pack` for each gem to download along with its dependencies and `ignore` for gems the target Logstash already provides, and `bundle exec rake paquet:vendor` downloads them. Nothing is bundled unless packed. The Logstash `Gemfile.template` depends on it, and `bin/logstash-plugin prepare-offline-pack` uses it to collect plugins and their dependencies into an offline pack ([[Plugin Manager CLI]]).

Sources: [tools/paquet/README.md:1-46](repo://tools/paquet/README.md#L1-L46), [Gemfile.template:1-10](repo://Gemfile.template#L1-L10), [lib/pluginmanager/prepare_offline_pack.rb:30-40](repo://lib/pluginmanager/prepare_offline_pack.rb#L30-L40)

## Release scripts

`bump_plugin_versions.rb <base_branch> <last_release> <major|minor|patch> [--no-pr]` refreshes the plugin versions shipped in a release. It reads `Gemfile.jruby-3.1.lock.release` from the `v<last_release>` tag on GitHub (or the local file when `last_release` is `LOCAL`), rewrites each plugin's requirement in `Gemfile.template` to `~> major`, `~> major.minor` or `~> major.minor.patch` of its released version, runs `./gradlew clean installDefaultGems` to resolve a new lock, strips the injected requirements, saves it as the new release lock, restores the template, and by default commits, pushes and opens a pull request.

Sources: [tools/release/bump_plugin_versions.rb:26-104](repo://tools/release/bump_plugin_versions.rb#L26-L104), [tools/release/bump_plugin_versions.rb:106-145](repo://tools/release/bump_plugin_versions.rb#L106-L145)

`generate_release_notes_md.rb <release_branch> <previous_tag> [user token]` drafts the release notes in `docs/release-notes/index.md`: closed pull requests labelled with the version, the commit log since the previous tag, and, for each plugin whose version changed in the `*.release` lock file, the plugin's CHANGELOG entries between the old and new versions. With a token it commits and pushes the draft. The `gen_release_notes.yml` workflow runs it, or the AsciiDoc `generate_release_notes.rb` for 8.x and older branches.

Sources: [tools/release/generate_release_notes_md.rb:19-70](repo://tools/release/generate_release_notes_md.rb#L19-L70), [tools/release/generate_release_notes_md.rb:70-128](repo://tools/release/generate_release_notes_md.rb#L70-L128), [.github/workflows/gen_release_notes.yml:34-43](repo://.github/workflows/gen_release_notes.yml#L34-L43)
