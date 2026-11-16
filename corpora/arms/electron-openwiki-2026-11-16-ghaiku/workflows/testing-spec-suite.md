---
type: workflow
title: Test Suite (spec/) and Test Runners
description: How Electron's Mocha-based spec suite in spec/ is organized and run. Covers the spec/index.js bootstrap that runs the suite inside an Electron process, file discovery for *-spec.ts files, the disabled-test lists, fixtures and spec helpers, and the three runners (main spec runner, Node.js test runner, and nan native-module runner) driven by script/spec-runner.js and its siblings.
tags: [testing, spec, mocha, spec-runner, node-tests, nan, disabled-tests, fixtures]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-fec3721ebe805949f5d6595c
    resource: repo://script/nan-spec-runner.js
  - id: openwiki-source-80cbb8057bb5abbe844aaae7
    resource: repo://script/node-spec-runner.js
  - id: openwiki-source-b63413b6df1236d7411a0cbc
    resource: repo://script/spec-runner.js
  - id: openwiki-source-141ce8f9fd4f733f5b609f8e
    resource: repo://spec/index.js
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Test Suite (spec/) and Test Runners

Electron's own tests are an Electron application. The `spec/` directory is a standalone app with its own `package.json`, so its dependencies are not part of the root `package.json`. The suite runs Mocha inside a built Electron binary, so tests can create real windows, sessions, and IPC channels. Two other suites check Electron's embedded Node.js: the upstream Node.js test suite and the nan native-module tests. Runner scripts under `script/` start each suite.

## Running tests

The contributor documentation (`docs/development/testing.md`) describes the basic commands:

- `npm run test` runs `node ./script/spec-runner.js` (the `test` script in `package.json`). The `pretest` hook regenerates TypeScript definitions first (see [API Documentation, Typings, and API History](api-docs-and-typings.md)).
- `npm run test -- -g <pattern>` passes a regular expression to Mocha through the `-g` (`--grep`) flag. For example, `npm run test -- -g ipc` runs the IPC tests only.
- `node script/node-spec-runner.js` runs the Node.js tests from `third_party/electron_node`. A single test can be named, for example `parallel/test-crypto-keygen`.
- The nan runner, `script/nan-spec-runner.js`, can only be run directly. It throws if loaded from another script.

The unit tests need the build directory to be named `Testing`, `Release`, or `Default`, or `ELECTRON_OUT_DIR` must be set. Without one of these, Electron cannot perform its pre-test steps.

## spec-runner.js: the main entry

`script/spec-runner.js` parses flags with `minimist`. The main flags are `--runners` (a comma-separated list, currently only `main` is registered), `--target`, and `--electronVersion`. When `--electronVersion` is given, the runner downloads that Electron release through `@electron/fiddle-core` and runs the spec suite against it, and only the `main` runner is allowed in that mode. It can install the modules in `spec/` (`installSpecModules`), and when a specific Electron version is requested it sets the native-addon build variables to build against that version.

The `main` runner calls `runTestUsingElectron('spec', 'main')`, which launches the built Electron binary with the `spec` directory as its app. Flags are forwarded to the spec entry, and the runner exits with the number of failures reported through the `Electron_Spec_Runner_Failures` status key.

## spec/index.js: the in-process bootstrap

`spec/index.js` is the main script of the test app. It:

1. Sets `TS_NODE_PROJECT` to `tsconfig.spec.json`, so `ts-node` compiles the `.ts` specs.
2. Disables Electron security warnings, optionally disables hardware acceleration (`ELECTRON_TEST_DISABLE_HARDWARE_ACCELERATION`), and exposes `--expose_gc`.
3. Keeps the app alive when the last window closes, adds switches such as fake media devices and a `host-resolver-rules` mapping for `localhost2` hosts, and registers the custom privileged schemes (`app`, `zoom`, `sw`, and several test-only schemes) that specs rely on.
4. Creates a Mocha instance. It uses `forbidOnly` in CI and `retries = 3` in CI. Reporter and grep options come from `MOCHA_REPORTER`, `MOCHA_GREP`, and `MOCHA_INVERT`.
5. Loads `disabled-tests.json` and adds a root `beforeEach` hook that calls `this.skip()` for any test whose full title is in that list.
6. Registers a `suite` listener so that cleanup functions from `spec/lib/spec-helpers.ts` run before other `afterEach` hooks.
7. Discovers the test files. Files passed with `--files` are validated, and otherwise the runner collects files whose names end in `-spec.ts` or `-spec.js`.

## Files and layout

- `spec/api-*-spec.ts` files are per-API suites, such as `api-browser-window-spec.ts`, `api-ipc-spec.ts`, `api-session-spec.ts`, and `api-web-contents-spec.ts`. Some suites are platform-specific, such as `api-autoupdater-darwin-spec.ts` and `api-notification-dbus-spec.ts`. Other top-level specs cover cross-cutting behavior, such as `asar-spec.ts`, `fuses-spec.ts`, `esm-spec.ts`, `security-warnings-spec.ts`, `types-spec.ts`, and `version-bump-spec.ts`.
- `spec/lib/` holds shared helpers: `spec-helpers.ts` (cleanup functions, remote-control helpers such as `startRemoteControlApp`, and platform gating), `window-helpers.ts`, `net-helpers.ts`, `fs-helpers.ts`, `events-helpers.ts`, `codesign-helpers.ts`, `artifacts.ts`, and others.
- `spec/fixtures/` contains test inputs: HTML pages, apps (`fixtures/apps`), native addons (`fixtures/native-addon`), extensions, ASAR archives such as `test.asar`, certificates, media files, and crash cases. Specs load these by path, for example `fixtures/pages/fetch.html` in `fuses-spec.ts`.
- `spec/ts-smoke/` is the type-check project for the generated typings. It is not a Mocha suite (see [API Documentation, Typings, and API History](api-docs-and-typings.md)).

A spec that uses the remote-control helper runs its code in a second Electron process, so the test can exercise behavior that depends on separate process state, such as file-protocol access controlled by a fuse.

## Disabled tests

Two lists turn off tests without deleting them:

- `spec/disabled-tests.json` is a JSON array of full test titles, with a leading `//` comment entry. The Mocha bootstrap skips any test whose full title matches. Its entries are full titles of individual tests.
- `script/node-disabled-tests.json` is the equivalent list for the Node.js tests. `node-spec-runner.js` can also check that every disabled spec still exists, and it reports missing ones.

The bootstrap comment notes that disabling a whole suite by title is not supported yet. Only individual test titles can be listed.

## Node.js tests and nan tests

`node-spec-runner.js` runs the upstream Node.js test suite against Electron's embedded Node. It uses `node-disabled-tests.json` to skip known-failing upstream tests, and it can validate that disabled entries still exist. 

`nan-spec-runner.js` runs the nan (Native Abstractions for Node) tests from `third_party/nan`, reading that checkout's `package.json` to set up the test run. Both suites are part of the Node test pipeline (`pipeline-segment-node-nan-test.yml`; see [CI Pipelines and Release Automation](ci-pipelines.md)).

## Failure behavior

- A thrown exception outside Mocha ends the bootstrap with exit code 1, so the runner reports a failure.
- The bootstrap exits with the runner's failure count, which the main runner reads as the result.
- A test listed in `disabled-tests.json` is skipped, not failed. Removing an entry re-enables it.

## Extension seams

- New API tests go in `spec/api-<module>-spec.ts`. Put shared setup in `spec/lib/` and test inputs in `spec/fixtures/`.
- Platform-only tests can use a platform suffix in the file name, following the `-darwin-` and `-dbus-` examples above.
- New fixtures for native code go under `spec/fixtures/native-addon/` and are declared in `spec/package.json` as `file:` dependencies.

## Related pages

- [Building Electron with GN and Ninja](build-and-gn.md)
- [API Documentation, Typings, and API History](api-docs-and-typings.md)
- [CI Pipelines and Release Automation](ci-pipelines.md)
- [Linting and Formatting](linting.md)
- [ASAR Archives and Module Loading](../architecture/asar-and-module-loading.md)
- [Fuses and ASAR Integrity](../concepts/fuses-and-integrity.md)
