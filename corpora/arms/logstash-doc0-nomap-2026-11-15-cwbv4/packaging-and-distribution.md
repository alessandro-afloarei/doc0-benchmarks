---
title: "Packaging and Distribution"
---
## Overview

Logstash ships as archives (`.tar.gz`, `.zip`), system packages (`.deb`, `.rpm`) and Docker images, each in a default flavour that includes x-pack under the Elastic License and an OSS flavour under Apache 2.0, with or without a bundled JDK. All of them are produced by the `artifact:` Rake tasks in `rakelib/artifacts.rake`, usually invoked through Gradle tasks such as `assembleTarDistribution` ([[Build System]]). The packages install Logstash under `/usr/share/logstash` with configuration in `/etc/logstash` and a systemd service; the images run Logstash in a container configured through environment variables.

Sources: [rakelib/artifacts.rake:20-31](repo://rakelib/artifacts.rake#L20-L31), [rakelib/artifacts.rake:170-197](repo://rakelib/artifacts.rake#L170-L197)

## What goes into an artifact

`package_files` lists the files: `bin`, `config`, `data`, the bootstrap, plugin manager, system-install and secret store libraries under `lib`, the `logstash-core` and `logstash-core-plugin-api` gems, `vendor` (JRuby and installed gems), `Gemfile` and `Gemfile.lock`, `x-pack`, and, when bundling a JDK, `JDK_VERSION`, `jdk/` and `jdk.app/`. `default_exclude_paths` removes `.gem` files, specs and tests inside vendored gems, development launchers (`bin/rspec`, `bin/bundle`) and a few known-unwanted gems; the OSS exclusion list adds `x-pack/**/*`.

Sources: [rakelib/artifacts.rake:33-126](repo://rakelib/artifacts.rake#L33-L126)

Environment variables shape the build: `RELEASE=1` drops the `-SNAPSHOT` suffix, `VERSION_QUALIFIER` adds an alpha or beta qualifier, and `ARCH=x86_64` selects x86-64 (anything else means arm64).

Sources: [rakelib/artifacts.rake:20-31](repo://rakelib/artifacts.rake#L20-L31)

## Archives

| Task | Output |
| --- | --- |
| `artifact:archives` | JDK-bundled `.tar.gz` for Linux and macOS and `.zip` for Windows (x86-64) or Linux and macOS (arm64), plus `-no-jdk` tar and zip |
| `artifact:archives_oss` | The same without x-pack |
| `artifact:bundle_jdk_tar`, `artifact:no_bundle_jdk_tar` | One tar for the current machine |
| `artifact:archives_docker` | JDK-bundled Linux tar used to build images |
| `artifact:tar-all-plugins`, `artifact:zip-all-plugins` | Variants with every released plugin |

Sources: [rakelib/artifacts.rake:174-260](repo://rakelib/artifacts.rake#L174-L260), [rakelib/artifacts.rake:345-358](repo://rakelib/artifacts.rake#L345-L358)

For each OS and architecture, `create_single_archive_pack` runs `./gradlew copyJdk -Pjdk_bundle_os=<os> -Pjdk_arch=<arch>` to place the right JDK in `jdk/`, builds the archive, then deletes the JDK so the next platform starts clean.

Sources: [rakelib/artifacts.rake:199-228](repo://rakelib/artifacts.rake#L199-L228)

## Debian and RPM packages

`artifact:deb`, `artifact:rpm` and their `_oss` variants call `package(platform, variant, bundle_jdk, arch)`, which uses fpm in five steps.

Sources: [rakelib/artifacts.rake:286-337](repo://rakelib/artifacts.rake#L286-L337), [rakelib/artifacts.rake:718-800](repo://rakelib/artifacts.rake#L718-L800), [rakelib/artifacts.rake:801-901](repo://rakelib/artifacts.rake#L801-L901)

1. Map every packaged file to `/usr/share/logstash/<path>`, except `config/`, and include a generated `build.rb` with build metadata.
2. Add `LICENSE.txt` (Elastic or Apache), and empty directories `/var/log/logstash`, `/var/lib/logstash`, `/etc/logstash/conf.d` and others.
3. Install `log4j2.properties`, `startup.options`, `jvm.options`, `logstash.yml`, `logstash-sample.conf` and `pkg/pipelines.yml` into `/etc/logstash`, the systemd unit into `/lib/systemd/system`, and `/etc/default/logstash`; all are marked as configuration files so upgrades keep local changes.
4. Attach `before-install`, `after-install` and `before-remove` scripts from `pkg/<platform>/`.
5. Name the package `logstash` or `logstash-oss`, epoch 1, replacing versions before 7.10.0.

Sources: [rakelib/artifacts.rake:286-337](repo://rakelib/artifacts.rake#L286-L337), [rakelib/artifacts.rake:718-800](repo://rakelib/artifacts.rake#L718-L800), [rakelib/artifacts.rake:801-901](repo://rakelib/artifacts.rake#L801-L901)

The packages do not depend on a Java package, because distributions name their Java packages inconsistently; JDK-bundled packages do not need one.

Sources: [rakelib/artifacts.rake:878-890](repo://rakelib/artifacts.rake#L878-L890)

The Debian scripts create the `logstash` system user and group before install. After install they set ownership (root for `/usr/share/logstash`, `logstash` for log and data directories), set `path.logs: /var/log/logstash` and `path.data: /var/lib/logstash` in `logstash.yml`, restrict `startup.options` and `/etc/default/logstash` to mode 600, and adjust `TimeoutStopSec` for systemd versions older than 229.

Sources: [pkg/debian/after-install.sh:1-29](repo://pkg/debian/after-install.sh#L1-L29), [pkg/debian/before-install.sh:1-20](repo://pkg/debian/before-install.sh#L1-L20)

## The service

The systemd unit runs `/usr/share/logstash/bin/logstash --path.settings /etc/logstash` as user `logstash`, loads environment from `/etc/default/logstash` and `/etc/sysconfig/logstash` when present, restarts always, raises the open-file limit to 16384, and waits indefinitely on stop (`TimeoutStopSec=infinity`), because killing Logstash mid-shutdown can lose in-flight events ([[Shutdown Watcher and Pipeline Reporter]]).

Sources: [pkg/service_templates/systemd/lib/systemd/system/logstash.service:1-24](repo://pkg/service_templates/systemd/lib/systemd/system/logstash.service#L1-L24)

`bin/system-install [OPTIONSFILE] [STARTUPTYPE] [VERSION]` generates a service definition for a chosen init system (sysv, upstart, systemd and so on) with the pleaserun library, reading `startup.options` from `/etc/logstash` or `config/` by default.

Sources: [bin/system-install:1-60](repo://bin/system-install#L1-L60), [lib/systeminstall/pleasewrap.rb:20-28](repo://lib/systeminstall/pleasewrap.rb#L20-L28)

## Docker images

### Building images

`artifact:docker`, `docker_oss`, `docker_wolfi` and `docker_observabilitySRE` build the matching archive, then run `make build-from-local-<flavor>-artifacts` in `docker/` with the artifacts directory and version information. `dockerfiles` and related tasks only render Dockerfiles and build contexts, for example for Iron Bank.

Sources: [rakelib/artifacts.rake:360-452](repo://rakelib/artifacts.rake#L360-L452), [rakelib/artifacts.rake:923-960](repo://rakelib/artifacts.rake#L923-L960)

`docker/templates/Dockerfile.erb` renders one Dockerfile per flavour (`full`, `oss`, `wolfi`, `observability-sre`). A first stage compiles the `env2yaml` Go tool; the final stage unpacks Logstash into `/usr/share/logstash`, creates user and group 1000, copies `pipelines.yml`, the Log4j configurations, a flavour-specific `logstash.yml` and a default `pipeline/logstash.conf`, exposes ports 9600 and 5044, runs as user 1000, and uses `docker-entrypoint` as the entry point.

Sources: [docker/templates/Dockerfile.erb:1-60](repo://docker/templates/Dockerfile.erb#L1-L60), [docker/templates/Dockerfile.erb:95-174](repo://docker/templates/Dockerfile.erb#L95-L174)

The image defaults to one pipeline reading `/usr/share/logstash/pipeline`, whose default config is a Beats input on 5044 printing to stdout. The full image's `logstash.yml` binds the API to `0.0.0.0` and points legacy monitoring at `http://elasticsearch:9200`.

Sources: [docker/data/logstash/config/pipelines.yml:1-6](repo://docker/data/logstash/config/pipelines.yml#L1-L6), [docker/data/logstash/pipeline/default.conf:1-12](repo://docker/data/logstash/pipeline/default.conf#L1-L12), [docker/data/logstash/config/logstash-full.yml:1-2](repo://docker/data/logstash/config/logstash-full.yml#L1-L2)

### docker-entrypoint and env2yaml

On start, `docker-entrypoint` runs `env2yaml` on `logstash.yml`. `env2yaml` matches each environment variable against a fixed list of setting names, ignoring case, dots and underscores, so `PIPELINE_WORKERS=6` and `pipeline.workers=6` both match `pipeline.workers`. Each match is written to `logstash.yml` as `pipeline.workers: ${PIPELINE_WORKERS}`, a reference rather than the value, so Logstash resolves it from the keystore or the environment at startup ([[Secret Store and Variable Substitution]]). The file is rewritten in place only when something matched.

Sources: [docker/data/logstash/bin/docker-entrypoint:1-8](repo://docker/data/logstash/bin/docker-entrypoint#L1-L8), [docker/data/logstash/env2yaml/env2yaml.go:1-30](repo://docker/data/logstash/env2yaml/env2yaml.go#L1-L30), [docker/data/logstash/env2yaml/env2yaml.go:131-198](repo://docker/data/logstash/env2yaml/env2yaml.go#L131-L198)

The entrypoint then switches Log4j to file logging when `LOG_STYLE=file` (console is the default), prepends `-Dls.cgroup.cpuacct.path.override=/ -Dls.cgroup.cpu.path.override=/` to `LS_JAVA_OPTS` so cgroup metrics work inside the container ([[Periodic Pollers and System Monitors]]), and runs `logstash` with the given flags, or the given command if the first argument is not a flag.

Sources: [docker/data/logstash/bin/docker-entrypoint:9-31](repo://docker/data/logstash/bin/docker-entrypoint#L9-L31)

## The observabilitySRE distribution

The `observability-sre` image flavour is an internal, FIPS-oriented build: its Dockerfile appends FIPS JVM options to `jvm.options`, installs a `java.security` configuration, and converts the truststore to BCFKS. It is built with `./gradlew artifactDockerObservabilitySRE -PfedrampHighMode=true`; the task aborts without that flag, then runs `rake artifact:docker_observabilitySRE`. Smoke and acceptance test helpers live in `ci/`.

Sources: [x-pack/distributions/internal/observabilitySRE/README.md:1-26](repo://x-pack/distributions/internal/observabilitySRE/README.md#L1-L26), [build.gradle:322-348](repo://build.gradle#L322-L348), [docker/templates/Dockerfile.erb:109-135](repo://docker/templates/Dockerfile.erb#L109-L135)
