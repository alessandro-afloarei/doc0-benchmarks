---
title: "Testing"
---
## Overview

Logstash has five layers of tests, each run by its own Gradle or Rake task: Java unit tests for `logstash-core`, RSpec unit specs for the Ruby side of the core and x-pack, integration tests that start a built Logstash against real services, acceptance tests that install the `.deb` or `.rpm` packages, and Docker tests that start the published image flavours. Ruby specs normally run inside JUnit, so Gradle runs both languages with one mechanism. This page covers the harnesses and tasks; how CI schedules them is on [[Continuous Integration]], and the build tasks they depend on are on [[Build System]].

Sources: [logstash-core/build.gradle:104-158](repo://logstash-core/build.gradle#L104-L158), [build.gradle:592-597](repo://build.gradle#L592-L597), [qa/README.md:1-31](repo://qa/README.md#L1-L31)

## Tasks at a glance

| Command | Runs |
| --- | --- |
| `./gradlew javaTests` | `:logstash-core:javaTests` and the `:jvm-options-parser` tests |
| `./gradlew rubyTests` (`:logstash-core:rubyTests`) | Core RSpec suites and the Java tests that need Ruby |
| `./gradlew test` | Both of the above |
| `./gradlew runIntegrationTests` | `qa/integration` specs against a built tarball, Elasticsearch and Filebeat |
| `./gradlew runXPackUnitTests`, `runXPackIntegrationTests` | x-pack specs and x-pack integration specs |
| `rake qa:acceptance:all` (in `qa/`) | Package acceptance specs |
| `bin/rspec <files>` | Any spec file directly |

Sources: [build.gradle:923-926](repo://build.gradle#L923-L926), [build.gradle:943-950](repo://build.gradle#L943-L950), [logstash-core/build.gradle:104-158](repo://logstash-core/build.gradle#L104-L158), [qa/Rakefile:26-33](repo://qa/Rakefile#L26-L33)

The `rake test:*` tasks wrap the same commands: `test:core-java` runs `./gradlew clean javaTests`, `test:core` (and plain `rake test`) runs `./gradlew clean test`, `test:core-fast` runs the core specs through `bin/rspec` excluding `stress_test`-tagged examples, and `test:plugins` runs the input, filter, codec and output specs of every installed plugin gem in random order, skipping those named in `EXCLUDE_PLUGIN`.

Sources: [rakelib/test.rake:23-87](repo://rakelib/test.rake#L23-L87)

## Java unit tests

`javaTests` runs every JUnit class in `logstash-core/src/test/java` except eleven classes that need a working Ruby side of Logstash (`RSpecTests`, `ConfigCompilerTest`, `CompiledPipelineTest`, `PluginFactoryExtTest` and others); those run in `rubyTests` instead. It needs `:bootstrap`, gets a 10 GB heap for one tokenizer overflow test, and records JaCoCo coverage, with the XML and HTML report produced afterwards.

Sources: [logstash-core/build.gradle:104-153](repo://logstash-core/build.gradle#L104-L153)

Logstash keeps one global JRuby runtime in `RubyUtil.RUBY`. Tests touching the JRuby API extend `RubyTestBase`, whose static initializer finds the Logstash root (from the `logstash.root.dir` property, or by walking up from `logstash-core`), checks for `versions.yml`, and creates that runtime with `Logstash.initRubyConfig`; a second initialisation fails with an assertion.

Sources: [logstash-core/src/test/java/org/logstash/RubyTestBase.java:28-63](repo://logstash-core/src/test/java/org/logstash/RubyTestBase.java#L28-L63)

## Ruby specs

### Running RSpec through JUnit

`RSpecTests` is a parameterized JUnit test with two cases: `compliance` (`spec/compliance/**/*_spec.rb`) and `core tests` (`spec/unit/**/*_spec.rb` and `logstash-core/spec/**/*_spec.rb`). For each, it sets `IS_JUNIT_RUN`, puts the RSpec arguments in the global `$JUNIT_ARGV`, and executes `lib/bootstrap/rspec.rb` in the shared runtime; a non-zero result fails the case.

Sources: [logstash-core/src/test/java/org/logstash/RSpecTests.java:36-75](repo://logstash-core/src/test/java/org/logstash/RSpecTests.java#L36-L75)

`lib/bootstrap/rspec.rb` is also what `bin/rspec` runs (with `JRUBY_OPTS=--dev` for faster start). It sets up Bundler without the `build` group, loads `logstash-core`, adds both `spec/` and `logstash-core/spec/` to the load path, clears any previous RSpec state, and runs RSpec with the command-line arguments, `$JUNIT_ARGV`, or `spec`. Under JUnit it returns the status; from the shell it exits with it.

Sources: [lib/bootstrap/rspec.rb:18-40](repo://lib/bootstrap/rspec.rb#L18-L40), [bin/rspec:1-10](repo://bin/rspec#L1-L10)

### The spec helper

`spec/spec_helper.rb` builds on `logstash-devutils`' helper and loads the shared support files. With `COVERAGE` set it starts SimpleCov with a JSON formatter. Each example runs with `LogStash::SETTINGS` reset, `queue.type` set to `memory`, `path.data` pointing at a fresh temporary directory, and the thread named after the example, so specs cannot leak settings or on-disk state into each other ([[Settings and logstash.yml]]). When the JVM runs in BouncyCastle FIPS approved-only mode, examples tagged `skip_fips` are excluded.

Sources: [spec/spec_helper.rb:18-88](repo://spec/spec_helper.rb#L18-L88)

### Support code

`logstash-core/spec/support` holds the test doubles. `mock_settings` clones the global settings with overrides; `make_test_agent` builds an agent with a source loader; `TestPipelineConfigSource` lets a spec add and remove pipeline config strings to drive convergence ([[Agent and Pipeline Convergence]]); `mock_pipeline_config` and `mock_java_pipeline_from_string` build pipelines from strings. `mocks_classes.rb` defines dummy plugins (`dummyinput`, `dummyblockinginput`, `dummyfilter`, several outputs) and test source loaders.

Sources: [logstash-core/spec/support/helpers.rb:42-150](repo://logstash-core/spec/support/helpers.rb#L42-L150), [logstash-core/spec/support/mocks_classes.rb:20-60](repo://logstash-core/spec/support/mocks_classes.rb#L20-L60), [logstash-core/spec/support/mocks_classes.rb:158-200](repo://logstash-core/spec/support/mocks_classes.rb#L158-L200)

## Integration tests

### Layout and fixtures

`qa/integration` ("RATS") starts Logstash from a built binary and runs it against external services. `services/` holds, per service, a `<name>_setup.sh`, a `<name>_teardown.sh` and a Ruby class; `fixtures/` holds one YAML file per spec naming the services, the Logstash configs and an optional setup script; `specs/` holds the RSpec files.

Sources: [qa/integration/README.md:1-20](repo://qa/integration/README.md#L1-L20)

A spec creates a `Fixture` for its own file. `TestSettings` reads `fixtures/<spec name>.yml` and the suite-wide `suite.yml` (test values win), flattening config strings to one line. `Fixture` then runs `setup` on each listed service (unless the run targets serverless) and the optional setup script; `config(node, options)` returns a named config, rendering it as ERB when options are given, and `teardown` stops the services.

Sources: [qa/integration/framework/settings.rb:21-70](repo://qa/integration/framework/settings.rb#L21-L70), [qa/integration/framework/fixture.rb:21-90](repo://qa/integration/framework/fixture.rb#L21-L90)

```yaml
---
services:
  - logstash
  - elasticsearch
config:
  default: |-
    input {
      stdin { }
    }
```

Sources: [qa/integration/fixtures/es_output_how_spec.yml:1-9](repo://qa/integration/fixtures/es_output_how_spec.yml#L1-L9)

### Services

The base `Service` shells out to the setup and teardown scripts and raises if they fail. `LogstashService` finds Logstash either at `ls_home_abs_path` or by expanding the `build/logstash-<version>[-SNAPSHOT].tar.gz` tarball into a clean `build/qa-fixture` directory, so the tests run the packaged product rather than the source tree ([[Packaging and Distribution]]). It can start Logstash with `-e`, a config file or stdin, wait for the process and the REST API, reload configs, and drive the plugin manager.

Sources: [qa/integration/services/service.rb:20-53](repo://qa/integration/services/service.rb#L20-L53), [qa/integration/services/logstash_service.rb:30-135](repo://qa/integration/services/logstash_service.rb#L30-L135)

### Running them

`runIntegrationTests` depends on `:logstash-integration-tests:integrationTests`, `copyEs` and `copyFilebeat`. The `integrationTests` task installs the suite's gems, prepares plugin fixture gems, and runs a JUnit `RSpecTests` wrapper that executes `qa/integration/rspec.rb` with the pattern from `-PrubyIntegrationSpecs` (default `specs/**/*_spec.rb`); that script points `GEM_HOME` at `build/qa/integration/vendor`. The task is up to date unless `-PintegrationTests.rerun` is set.

Sources: [build.gradle:579-597](repo://build.gradle#L579-L597), [qa/integration/build.gradle:75-98](repo://qa/integration/build.gradle#L75-L98), [qa/integration/src/test/java/org/logstash/integration/RSpecTests.java:66-80](repo://qa/integration/src/test/java/org/logstash/integration/RSpecTests.java#L66-L80), [qa/integration/rspec.rb:18-40](repo://qa/integration/rspec.rb#L18-L40)

`ci/integration_tests.sh` is the usual entry: no argument runs everything, spec paths run those specs, `split <index> <count>` runs one partition of the spec files, and `setup` prepares without testing so specs can be run by hand with `bundle exec rspec` in `qa/integration`.

Sources: [ci/integration_tests.sh:1-42](repo://ci/integration_tests.sh#L1-L42), [qa/integration/README.md:36-52](repo://qa/integration/README.md#L36-L52)

## Package and Docker acceptance tests

The acceptance framework in `qa/acceptance` tests installing, running and upgrading the `.deb` and `.rpm` packages on the target machine, through per-OS command helpers in `qa/rspec` and shared examples. `ci/acceptance_tests.sh` detects whether the OS uses deb or rpm, builds that package (or downloads it in Buildkite and sets `LS_ARTIFACTS_PATH`), installs the `qa` bundle, and runs `rake qa:acceptance:all`.

Sources: [qa/README.md:1-80](repo://qa/README.md#L1-L80), [ci/acceptance_tests.sh:1-58](repo://ci/acceptance_tests.sh#L1-L58)

`qa/docker` tests the images: `ci/docker_acceptance_tests.sh [oss|full|wolfi]` builds the chosen flavour (or all) and runs `qa/docker/spec/<flavor>/*_spec.rb`. The spec helper finds the image `docker.elastic.co/logstash/logstash-<flavor>:<version>`, starts containers with the `docker-api` gem, waits for Logstash and its pipelines, and queries the monitoring API inside the container.

Sources: [ci/docker_acceptance_tests.sh:15-79](repo://ci/docker_acceptance_tests.sh#L15-L79), [qa/docker/spec/spec_helper.rb:1-60](repo://qa/docker/spec/spec_helper.rb#L1-L60)

## X-Pack tests

`:logstash-xpack:rubyTests` unpacks GeoLite2 test databases and runs `x-pack/spec/**/*_spec.rb` through the same `lib/bootstrap/rspec.rb` path. `rubyIntegrationTests` needs a copied Elasticsearch, the assembled build and the FIPS validation gem, and runs `x-pack/qa/integration`, which covers [[X-Pack Monitoring]] and [[Centralized Pipeline Management]] against a real cluster. Separate `observabilitySREsmokeTests` and `observabilitySREacceptanceTests` tasks test the observabilitySRE image.

Sources: [x-pack/build.gradle:48-117](repo://x-pack/build.gradle#L48-L117), [x-pack/src/test/java/org/logstash/xpack/test/RSpecTests.java:55-72](repo://x-pack/src/test/java/org/logstash/xpack/test/RSpecTests.java#L55-L72), [x-pack/src/test/java/org/logstash/xpack/test/RSpecIntegrationTests.java:18-24](repo://x-pack/src/test/java/org/logstash/xpack/test/RSpecIntegrationTests.java#L18-L24)
