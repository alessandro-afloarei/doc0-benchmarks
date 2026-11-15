---
title: "Quickstart: Build and Run from Source"
---
## Overview

This page takes a fresh checkout to a running Logstash that reads from standard input and prints events, then runs the tests. Every command here is a Gradle task or a script in `bin/`; [[Build System]] explains what the tasks do, and [[Startup and the Runner]] explains the flags `bin/logstash` accepts.

Sources: [README.md:40-110](repo://README.md#L40-L110)

## Prerequisites

The README asks for a JDK with `JAVA_HOME` set, and a Ruby whose version matches `.ruby-version`, which names a JRuby release. The Gradle build downloads its own JRuby into `vendor/jruby`, so a system JRuby is only needed for running `rake` directly.

Sources: [README.md:40-68](repo://README.md#L40-L68), [.ruby-version:1-1](repo://.ruby-version#L1-L1)

The checkout holds the Elastic-licensed x-pack code. Setting `OSS=true` makes the runner treat the installation as OSS-only, which it also does when the `x-pack` folder is missing; x-pack's library folder is then left off the load path.

Sources: [README.md:69-82](repo://README.md#L69-L82), [logstash-core/lib/logstash/runner.rb:22-32](repo://logstash-core/lib/logstash/runner.rb#L22-L32)

## Build and install gems

1. Run `./gradlew installDevelopmentGems`. It depends on `bootstrap`, which assembles every subproject, downloads and installs JRuby, then runs the Rake task `plugin:install-development-dependencies`.
2. Run `./gradlew installDefaultGems` to install the default plugin set through `plugin:install-default`.
3. If you edit the config grammar, `./gradlew compileGrammar` runs `compile:grammar` to regenerate the Treetop parser.

Sources: [build.gradle:289-320](repo://build.gradle#L289-L320)

## Run a first pipeline

```sh
bin/logstash -e 'input { stdin { } } output { stdout {} }'
```

Sources: [README.md:97-110](repo://README.md#L97-L110)

Type a line and Logstash prints it back as an event. `-e` sets `config.string`; `-f` sets `path.config` to a file or glob. `config/logstash-sample.conf` is a starting point for a Beats-to-Elasticsearch pipeline, and `config/logstash.yml` lists every setting with its default commented out, for example `config.reload.automatic: false` and the API port range `9600-9700`.

Sources: [logstash-core/lib/logstash/runner.rb:77-86](repo://logstash-core/lib/logstash/runner.rb#L77-L86), [config/logstash-sample.conf:1-17](repo://config/logstash-sample.conf#L1-L17), [config/logstash.yml:85-140](repo://config/logstash.yml#L85-L140)

| Command | Effect |
| --- | --- |
| `bin/logstash -f my.conf -t` | Parse and compile the config, print `Configuration OK`, exit |
| `bin/logstash -f my.conf -r` | Reload the pipeline when the file changes |
| `bin/logstash -f my.conf --log.level debug --config.debug` | Log the compiled pipeline graph |
| `bin/logstash -w 4 -b 250 -f my.conf` | Four workers, batches of 250 events |

Sources: [logstash-core/lib/logstash/runner.rb:99-177](repo://logstash-core/lib/logstash/runner.rb#L99-L177), [logstash-core/lib/logstash/runner.rb:362-380](repo://logstash-core/lib/logstash/runner.rb#L362-L380)

> [!NOTE]
> Logstash refuses to run as root unless `allow_superuser` is set, and only one process may use a given `path.data` at a time: a second one fails with a locked data path error.

Sources: [logstash-core/lib/logstash/runner.rb:432-443](repo://logstash-core/lib/logstash/runner.rb#L432-L443), [logstash-core/lib/logstash/runner.rb:381-411](repo://logstash-core/lib/logstash/runner.rb#L381-L411)

## Run the tests

| Command | What it runs |
| --- | --- |
| `./gradlew test` | Core tests |
| `./gradlew javaTests` | `logstash-core` JUnit tests and the JVM options parser tests |
| `./gradlew bootstrap` then `bin/rspec` | RSpec suite, or one file with `bin/rspec path/to_spec.rb` |
| `./gradlew check` | Everything, integration tests included |
| `./gradlew integrationTests -PrubyIntegrationSpecs=specs/slowlog_spec.rb` | One integration spec |

Sources: [README.md:146-180](repo://README.md#L146-L180), [build.gradle:923-926](repo://build.gradle#L923-L926)

To debug a hanging test, set `LS_JAVA_OPTS="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005"` and attach a debugger. [[Testing]] describes each suite.

Sources: [README.md:181-184](repo://README.md#L181-L184)

## Build a distribution

`./gradlew assembleTarDistribution` and `./gradlew assembleZipDistribution` write snapshot archives to `build/`; the `Oss` variants leave out x-pack. `rake artifact:rpm` and `rake artifact:deb` build packages and need `fpm`. [[Packaging and Distribution]] covers the flavours and the Docker images.

Sources: [README.md:200-230](repo://README.md#L200-L230), [build.gradle:350-360](repo://build.gradle#L350-L360)
