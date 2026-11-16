---
title: "Testing"
---
## Overview

Electron's main test suite is an Electron app. `script/spec-runner.js` installs the app's dependencies, starts the built `electron` binary on the `spec/` directory, and that app's `spec/index.js` boots Mocha inside the main process and runs every `*-spec.ts` file. Two further runners exercise the embedded Node.js: one runs Node's own test suite with Electron as the Node binary, the other runs the NAN native-module tests. There is also a runner for native C++ test binaries. This page covers each runner, how to run a subset, and the helpers specs share. Building the binary under test is described in [[Quickstart: Building and Running Electron]].

Sources: [script/spec-runner.js:42-44](repo://script/spec-runner.js#L42-L44), [spec/index.js:61-71](repo://spec/index.js#L61-L71), [docs/development/testing.md:30-33](repo://docs/development/testing.md#L30-L33)

## The spec runner

`npm test` is `node ./script/spec-runner.js`, and `pretest` first regenerates the TypeScript definitions. The runner has a table of runners with one entry, `main`, described as "Main process specs"; `--runners` can select a subset of the known names and an unknown name exits with an error. With `--electronVersion` it runs the suite against a released Electron instead of a local build; only the `main` runner is allowed then, and `latest` or `latest@<major>` are resolved through `@electron/fiddle-core`.

Sources: [package.json:87-92](repo://package.json#L87-L92), [script/spec-runner.js:42-67](repo://script/spec-runner.js#L42-L67), [script/spec-runner.js:69-90](repo://script/spec-runner.js#L69-L90)

Before running, it checks whether the spec's dependencies are current. A hash is computed from `spec/package.json`, `spec/yarn.lock` and the runner script, plus a hash of `spec/node_modules`, and compared with `spec/.hash`. If anything changed, it deletes `node_modules` and runs `yarn install --frozen-lockfile` in `spec/`. For a local build it points `npm_config_nodedir` at the build's `gen/node_headers`, so native test addons compile against that Electron's headers (the `node_headers` target from [[Build System]]); for a released version it sets the Electron runtime and header URL. It also generates `electron.d.ts` if it is missing.

Sources: [script/spec-runner.js:92-119](repo://script/spec-runner.js#L92-L119), [script/spec-runner.js:224-263](repo://script/spec-runner.js#L224-L263), [script/spec-runner.js:265-287](repo://script/spec-runner.js#L265-L287)

`runTestUsingElectron` then resolves the executable (`utils.getElectronExec()`, i.e. the `Testing`/`Release`/`Default`/`Debug` output directory or `ELECTRON_OUT_DIR`, see [[Quickstart: Building and Running Electron]]) and spawns it with `electron/spec` followed by any unrecognised command-line flags, so mocha-style options pass through. On Linux it is started under `script/dbus_mock.py`. A non-zero exit prints the code or kill signal and fails the run. With `ELECTRON_FORCE_TEST_SUITE_EXIT` set, the exit status is taken from the `Electron_Spec_Runner_Failures: N` line the suite prints rather than from the process status.

Sources: [script/spec-runner.js:161-222](repo://script/spec-runner.js#L161-L222)

## Inside the spec app

`spec/index.js` is the app's main script. Before ready it prepares the process for deterministic tests: it turns off security warnings, exposes `gc`, keeps the app alive when windows close, uses a fake media device, maps `localhost2` host names to fixed addresses and enables a Blink feature a spec needs. It registers a set of privileged custom schemes (`app`, `zoom`, `sw`, `http-like`, `cors`, `no-cors`, `stream`, ...) with different privilege combinations so protocol specs can use them; see [[Sessions, Protocols and Networking]].

Sources: [spec/index.js:9-59](repo://spec/index.js#L9-L59)

After `app.whenReady()` it registers `ts-node` (so specs are TypeScript, using `tsconfig.spec.json`), parses `--grep`, `--invert` and `--files` with yargs, and builds a Mocha instance. On CI it forbids `.only` and retries failures up to three times; reporter, grep and invert can also come from `MOCHA_*` environment variables, which some vendor builds use for sharding. The default timeout is 30 s (`MOCHA_TIMEOUT` overrides) and the default reporter is TAP.

Sources: [spec/index.js:61-94](repo://spec/index.js#L61-L94), [spec/index.js:123-130](repo://spec/index.js#L123-L130)

A root hook skips any test whose full title appears in `spec/disabled-tests.json`, and another attaches a cleanup `afterEach` to every suite so functions registered with `defer()` run first, in reverse order, before ordinary `afterEach` hooks. Files are selected by a filter that keeps only names matching `-spec.js` or `-spec.ts`, optionally narrowed by `npm_config_match` or `--files`; passing files that match nothing is an error. Chai is set up with `chai-as-promised` and `dirty-chai` and full object diffs. When the Mocha run ends, the process exits with the number of failures, or prints the failure marker and kills itself when `ELECTRON_FORCE_TEST_SUITE_EXIT` is `true`.

Sources: [spec/index.js:96-121](repo://spec/index.js#L96-L121), [spec/index.js:132-190](repo://spec/index.js#L132-L190)

> [!TIP]
> To run a subset, pass a pattern through the npm script: `npm run test -- -g ipc` runs tests whose titles match "ipc".

Sources: [docs/development/testing.md:35-38](repo://docs/development/testing.md#L35-L38)

## Layout and helpers

Spec files live flat in `spec/`. Files named `api-<module>-spec.ts` test a public module; other specs cover cross-cutting areas such as `asar-spec.ts`, `asar-integrity-spec.ts`, `fuses-spec.ts`, `security-warnings-spec.ts` and `webview-spec.ts`. `spec/lib/` contains shared helpers and `spec/fixtures/` the pages, apps, certificates and native addons the specs load. The spec app has its own `package.json` (name `electron-test-main`) with its own dependencies, including native test addons installed from `fixtures/native-addon`.

Sources: [docs/development/testing.md:30-33](repo://docs/development/testing.md#L30-L33), [spec/package.json:1-30](repo://spec/package.json#L1-L30), [spec/get-files.ts:1-11](repo://spec/get-files.ts#L1-L11)

`spec/lib/spec-helpers.ts` exports conditional-test wrappers `ifit(condition)` and `ifdescribe(condition)` (which fall back to `it.skip` or `describe.skip`), `defer` and `runCleanupFunctions`, `waitUntil`, `repeatedly`, `listen` for HTTP servers, and remote-control helpers (`startRemoteControlApp`, `getRemoteContext`, `itremote`) that run test code in a separate process or page. `window-helpers.ts` provides `closeWindow`, which destroys a window and, for a `BrowserWindow` with live web contents, waits for its `closed` event; it then asserts no windows are left, so a leaked window fails a later test, not silently.

Sources: [spec/lib/spec-helpers.ts:25-40](repo://spec/lib/spec-helpers.ts#L25-L40), [spec/lib/spec-helpers.ts:79-100](repo://spec/lib/spec-helpers.ts#L79-L100), [spec/lib/spec-helpers.ts:166-225](repo://spec/lib/spec-helpers.ts#L166-L225), [spec/lib/window-helpers.ts:7-45](repo://spec/lib/window-helpers.ts#L7-L45)

The `spec/ts-smoke` folder has its own runner and `main.ts`: the `create-typescript-definitions` script ends by running `spec/ts-smoke/runner.js`, which runs `tsc` on `ts-smoke/tsconfig.json` to type-check the sample usage in `main.ts` (see [[API Documentation Pipeline]]).

Sources: [package.json:80](repo://package.json#L80), [spec/ts-smoke/runner.js:1-18](repo://spec/ts-smoke/runner.js#L1-L18)

## Node.js and NAN suites

Changes that touch how Node is embedded are checked by running Node's own tests with Electron as the Node binary. `script/node-spec-runner.js` runs Node's `tools/test.py` from `third_party/electron_node` with `--shell` set to the built Electron and the environment variables `ELECTRON_RUN_AS_NODE` and `ELECTRON_EAGER_ASAR_HOOK_FOR_TESTING` (see [[Node.js Integration and the Event Loop]]). `--default` uses a fixed option set that skips the tests listed in `script/node-disabled-tests.json`; otherwise the arguments you give are forwarded, for example a single test path. `--validateDisabled` checks that every disabled test still exists in the Node tree, and `--jUnitDir` converts the TAP log to JUnit XML.

Sources: [script/node-spec-runner.js:10-57](repo://script/node-spec-runner.js#L10-L57), [script/node-spec-runner.js:59-104](repo://script/node-spec-runner.js#L59-L104), [docs/development/testing.md:40-59](repo://docs/development/testing.md#L40-L59)

`script/nan-spec-runner.js` rebuilds NAN's native test modules in `third_party/nan` with `node-gyp`, using the build's Node headers and the bundled clang and libc++ flags (plus the newest SDK found on macOS), installs its JavaScript dependencies and runs the test files with `tap` under the Electron binary in run-as-node mode. A small set of tests is disabled in the script with reasons given in comments (one has CRLF line endings that cannot be patched, two conflict with a Chromium change), and `--only` selects tests.

Sources: [script/nan-spec-runner.js:18-44](repo://script/nan-spec-runner.js#L18-L44), [script/nan-spec-runner.js:68-156](repo://script/nan-spec-runner.js#L68-L156)

## Native C++ tests

`script/lib/native_tests.py` runs compiled gtest binaries. A `TestsList` is loaded from a YAML config and exposes the binaries supported on the current platform; running a name that is not in the config, or not valid on this platform, raises an error, and results are summed into a return code. Each `TestBinary` runs the executable with a `--gtest_filter` assembled from included and excluded tests and a `--gtest_output` path. The GN arguments for building them are in `build/args/native_tests.gn`, which adds `//electron/spec-chromium:spec` as an extra root dependency.

Sources: [build/args/native_tests.gn:1-7](repo://build/args/native_tests.gn#L1-L7), [script/lib/native_tests.py:79-122](repo://script/lib/native_tests.py#L79-L122), [script/lib/native_tests.py:236-280](repo://script/lib/native_tests.py#L236-L280)
