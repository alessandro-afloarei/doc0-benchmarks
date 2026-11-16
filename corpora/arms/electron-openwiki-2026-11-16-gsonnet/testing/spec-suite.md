---
type: testing
title: "Testing: Spec Suite, Runners and Native Tests"
description: How Electron's tests are organized and run - the mocha spec suite that executes inside a built Electron binary, the script/spec-runner.js orchestration, spec helpers and fixtures, disabled-test lists, the Node.js and nan compatibility runners, and platform and CI behaviors.
tags: [testing, mocha, spec-runner, node-spec-runner, nan, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-0ac207f83d59c73dbe96c965
    resource: repo://docs/development/testing.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-1e59d294433f0c981874804a
    resource: repo://script/lib/utils.js
  - id: openwiki-source-fec3721ebe805949f5d6595c
    resource: repo://script/nan-spec-runner.js
  - id: openwiki-source-80cbb8057bb5abbe844aaae7
    resource: repo://script/node-spec-runner.js
  - id: openwiki-source-b63413b6df1236d7411a0cbc
    resource: repo://script/spec-runner.js
  - id: openwiki-source-4887ddc44d36e3e7b410c7ee
    resource: repo://spec/disabled-tests.json
  - id: openwiki-source-141ce8f9fd4f733f5b609f8e
    resource: repo://spec/index.js
  - id: openwiki-source-9d4d848abdc8012a9dc521d3
    resource: repo://spec/lib/spec-helpers.ts
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Testing: Spec Suite, Runners and Native Tests

Most Electron tests are **integration tests that run inside a built Electron binary**: a small Electron app (the `spec/` folder) loads mocha, finds `*-spec.ts` files, and drives real windows, sessions and processes. There are no mock-based unit tests of native code at this level; C++ unit tests exist only in narrow places (for example `accelerator_util_unittests.cc` under `shell/browser/ui`). Other runners exercise Node.js and nan compatibility against Electron's patched Node.

## Entry points

- `npm test` is `node ./script/spec-runner.js`. Extra arguments pass through to the spec app, e.g. `npm run test -- -g ipc` (grep), `--files <path>` or the `npm_config_match` environment variable to select spec files.
- `node script/node-spec-runner.js [test-path]` runs Node.js's own test-suite against Electron ([below](#nodejs-and-nan-compatibility-runners)).
- `node script/nan-spec-runner.js` builds and runs nan's native-addon tests.
<!-- openwiki: broken internal link [/openwiki/build/build-system.md] link "/openwiki/build/build-system.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Prerequisites: the output directory must be `Testing`, `Release` or `Default`, or `ELECTRON_OUT_DIR` must name one; `script/lib/utils.js` (`getOutDir`, `getElectronExec`) otherwise throws "No valid out directory found" ([build system](/openwiki/build/build-system.md)).

## script/spec-runner.js: orchestration

The runner is a thin driver:

1. Parses `--runners`, `--target`, `--electronVersion`. Only one runner id, `main` ("Main process specs"), exists. With `--electronVersion` (`latest`, `latest@<major>` or an explicit version) it downloads a released Electron with `@electron/fiddle-core`'s `Installer` and runs the specs against it instead of a local build.
2. Decides whether to reinstall `spec/` dependencies by hashing `spec/package.json`, `spec/yarn.lock`, the runner itself, and the contents of `spec/node_modules` (cached in `spec/.hash`). When something changed it deletes `spec/node_modules` and runs `yarn install --frozen-lockfile`. For a local build native modules compile against `out/<dir>/gen/node_headers`; for a downloaded Electron they build for that runtime via node-gyp headers. Native fixture add-ons (`@electron-ci/echo`, `is-valid-window`, `uv-dlopen`, `osr-gpu`, `external-ab`) are installed this way, and `nan` is resolved to `third_party/nan`.
3. Generates `electron.d.ts` if missing (`npm run create-typescript-definitions`).
4. Spawns the Electron binary with `electron/spec` as the app (on Linux wrapped in `python3 script/dbus_mock.py <exe>` so DBus-dependent features like notifications can be tested), pipes output, and fails the whole run if the exit status is non-zero. `ELECTRON_TEST_RESULTS_DIR` sets a per-runner `MOCHA_FILE` for JUnit output; `ELECTRON_TEST_PID_DUMP_PATH` records the child PID; `ELECTRON_FORCE_TEST_SUITE_EXIT` makes the runner trust an `Electron_Spec_Runner_Failures: N` line instead of the process status (used when the process is killed on exit).

## The spec app: spec/index.js

`spec/index.js` is the main script of the test app (`spec/package.json` names it "Electron Test Main"):

- Sets up the environment: `uncaughtException` exits with failure, `TS_NODE_PROJECT=tsconfig.spec.json`, `ELECTRON_DISABLE_SECURITY_WARNINGS`, `--expose_gc` (tests use `gc()`), fake media devices, `host-resolver-rules` mapping `localhost2` hostnames, an enabled Blink feature for web-frame tests, and an optional hardware-acceleration disable.
<!-- openwiki: broken internal link [/openwiki/architecture/sessions-protocols-and-network.md] link "/openwiki/architecture/sessions-protocols-and-network.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Registers privileged custom schemes used by tests (`app`, `zoom`, `sw`, `http-like`, `cors`, `no-cors`, `stream`, ...) with `protocol.registerSchemesAsPrivileged`, **before** `ready`, since the registry is locked after startup ([sessions and protocols](/openwiki/architecture/sessions-protocols-and-network.md)).
- After `ready` it loads `ts-node/register` so specs can be TypeScript, builds a `Mocha` instance (`bdd` UI, TAP reporter unless `MOCHA_REPORTER` is set, 30 s timeout overridable by `MOCHA_TIMEOUT`, `forbidOnly` and 3 retries in CI, and grep/invert from CLI or `MOCHA_GREP`/`MOCHA_INVERT` for sharding), wires chai with `chai-as-promised` and `dirty-chai`, and adds every file matching `-spec.[tj]s` found by `spec/get-files.ts`.
- **Disabled tests**: a root `beforeEach` skips any test whose full title appears in `spec/disabled-tests.json` (the first entry is a comment). Only individual tests, not suites, can be disabled this way.
- Keeps the app alive when windows close (`window-all-closed` is a no-op) and exits with the number of failures.
- Cleanup hooks registered through `defer()` run *before* regular `afterEach` hooks, in reverse registration order.

## Helpers and fixtures

- `spec/lib/spec-helpers.ts`: `ifit`/`ifdescribe` (conditional tests by platform), `defer`/`runCleanupFunctions`, `waitUntil`, `repeatedly`, `listen` (bind a server to an ephemeral loopback port), `startRemoteControlApp` (spawns `fixtures/apps/remote-control`, a child Electron process driven by `remoteEval`/`remotely` over HTTP with V8-serialized results), and `itremote`/`useRemoteContext`, which run a test body inside a renderer (`executeJavaScript` in a window with `nodeIntegration`) and re-throw failures as chai assertion errors.
- `spec/lib/window-helpers.ts` (`closeWindow` waits for `closed` and asserts no windows linger), plus `events-helpers`, `net-helpers`, `screen-helpers`, `codesign-helpers`, `fs-helpers`, `artifacts` and others.
- `spec/fixtures/` holds HTML pages, apps (e.g. for packaging and fuses tests), ASAR files, crash cases, extensions, ESM modules, native add-ons and certificates. Test files follow a naming convention: `api-*-spec.ts` for public modules (`api-browser-window-spec.ts`, `api-ipc-spec.ts`, `api-session-spec.ts`, ...), plus themed specs such as `asar-spec.ts`, `asar-integrity-spec.ts`, `chromium-spec.ts`, `crash-spec.ts`, `extensions-spec.ts`, `fuses-spec.ts`, `modules-spec.ts`, `node-spec.ts`, `esm-spec.ts` and `webview-spec.ts`. `spec/ts-smoke/` type-checks the generated `electron.d.ts` as part of `create-typescript-definitions`.

## Node.js and nan compatibility runners

<!-- openwiki: broken internal link [/openwiki/architecture/node-chromium-integration.md] link "/openwiki/architecture/node-chromium-integration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/build/upstream-patches.md] link "/openwiki/build/upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- `script/node-spec-runner.js` runs `tools/test.py` from `third_party/electron_node` with `ELECTRON_RUN_AS_NODE=true` and `ELECTRON_EAGER_ASAR_HOOK_FOR_TESTING=true`, using the Electron binary as `--shell`. `--default` runs the standard suite (TAP output, `--skip-tests` from `script/node-disabled-tests.json`, flaky tests tolerated); passing a test path runs just that test. `--validateDisabled` verifies that each disabled test still exists in the Node tree. `--jUnitDir` converts TAP to JUnit. Use it when changing how Node is embedded ([Node and Chromium integration](/openwiki/architecture/node-chromium-integration.md)) or after Node upgrades ([patches](/openwiki/build/upstream-patches.md)).
- `script/nan-spec-runner.js` rebuilds nan's `test` directory with `node-gyp`, using Electron's node headers, Chromium's libc++ include paths, flags such as `-fno-exceptions -fno-rtti`, and `lld`, and then runs the nan tests, ensuring that native modules built with nan still compile and load against Electron's toolchain.

## Platform and CI notes

- Linux needs a DBus mock and often a virtual display; `docs/development/testing.md` and `docs/tutorial/testing-on-headless-ci.md` cover headless setups. Windows needs Visual Studio, `electron:node_headers` and `node.lib` copies; missing fonts cause some failures.
- Many specs are gated by `ifit(process.platform === ...)` and feature checks so one suite runs on macOS, Windows and Linux (and MAS builds).
- Disabled lists (`spec/disabled-tests.json`, `script/node-disabled-tests.json`) are the sanctioned way to quarantine a flaky or platform-broken test; keep entries accurate with the validate option.
<!-- openwiki: broken internal link [/openwiki/workflows/docs-api-and-release.md] link "/openwiki/workflows/docs-api-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- CI (`.github/workflows/`) invokes these runners with `ELECTRON_TEST_RESULTS_DIR`, `MOCHA_REPORTER` and sharding variables; see [API docs, linting and release tooling](/openwiki/workflows/docs-api-and-release.md) for lint gating.

## Writing a test

Add a `*-spec.ts` in `spec/`, use `describe`/`it` with chai `expect`, create windows through `new BrowserWindow(...)` and close them with `closeWindow` in `afterEach`, use `defer()` for temporary resources, and use `itremote` when logic must run in a renderer. Prefer fixtures over network access (a local `http.createServer` and `listen()`), and gate platform-specific cases with `ifit`.
