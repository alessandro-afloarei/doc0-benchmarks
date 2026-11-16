---
title: "Testing with the Spec Suite"
---
## Overview

The spec suite runs Mocha tests inside a built Electron process, so the tests exercise the browser process, renderers and native APIs of the build. The suite lives in `spec/`, and `npm test` starts it through `script/spec-runner.js`. This page covers how the suite is started, how it picks its test files, and how it is set up before the first test runs. The steps that build the binary the suite runs are on [[Quickstart]].

Sources: [spec/index.js:1-3](repo://spec/index.js#L1-L3), [script/spec-runner.js:42-44](repo://script/spec-runner.js#L42-L44)

## Starting the suite

The spec runner is a Node script that knows one runner, `main`. For that runner it spawns the built executable with `electron/spec` as the argument, so the executable's own startup runs `spec/index.js` as the app's `main`. The runner exits with status 1 when a runner reports errors.

Sources: [script/spec-runner.js:42-44](repo://script/spec-runner.js#L42-L44), [script/spec-runner.js:194-206](repo://script/spec-runner.js#L194-L206), [script/spec-runner.js:151-157](repo://script/spec-runner.js#L151-L157)

`spec/index.js` sets up the process before it loads any test. It turns off the security warnings, enables `--expose_gc`, keeps the app running when the last window closes, and enables the fake media device and host rules that the tests rely on. A crash in the setup code exits the process with status 1 instead of showing a dialog.

Sources: [spec/index.js:8-14](repo://spec/index.js#L8-L14), [spec/index.js:18-37](repo://spec/index.js#L18-L37)

The setup code also registers the custom schemes the tests use, `app`, `zoom` and `sw`, each with its own privileges. Those schemes exist so that tests can load pages with standard, secure or service-worker behaviour.

Sources: [spec/index.js:44-54](repo://spec/index.js#L44-L54)

## Choosing the tests

The entry point reads `--grep`, `--invert` and `--files` from the command line with `yargs`, and it reads Mocha's options from the environment: `CI` adds forbidden `.only` checks and three retries, and `MOCHA_REPORTER`, `MOCHA_GREP` and `MOCHA_INVERT` select the reporter and sharding.

Sources: [spec/index.js:61-93](repo://spec/index.js#L61-L93), [spec/index.js:129-130](repo://spec/index.js#L129-L130)

A test file is chosen when its name ends in `-spec.ts` or `-spec.js`. The filter then applies the `npm_config_match` pattern, if one is set, and the `--files` list, so `npm test --match=menu` runs the files whose path matches that pattern. The files are sorted before they run.

Sources: [spec/index.js:137-156](repo://spec/index.js#L137-L156), [spec/index.js:158-160](repo://spec/index.js#L158-L160), [spec/get-files.ts:4-11](repo://spec/get-files.ts#L4-L11)

Tests named in `spec/disabled-tests.json` are skipped by a root `beforeEach` hook, which compares the full test title with the list. Disabling a test is therefore a data change, not a code change.

Sources: [spec/index.js:97-107](repo://spec/index.js#L97-L107)

## Cleanup

Each suite gets an `afterEach` hook named `cleanup` that runs the functions the tests registered with `defer`. The hook is attached to every suite as it is created, so it runs before the `afterEach` hooks that a test file adds itself.

Sources: [spec/index.js:109-121](repo://spec/index.js#L109-L121)

## Helpers and fixtures

The shared helpers live in `spec/lib`. `spec-helpers.ts` holds the defer and cleanup functions, and the window, network and event helpers are separate modules, so a test file imports only the helpers it uses. Test apps and pages that the tests load are under `spec/fixtures`.

Sources: [spec/lib/spec-helpers.ts:30-40](repo://spec/lib/spec-helpers.ts#L30-L40)

The Node.js test runner is separate. `script/node-spec-runner.js` reads a list of disabled tests from `script/node-disabled-tests.json` and runs the Node.js test tree in `third_party/electron_node`, writing TAP output and optional JUnit reports.

Sources: [script/node-spec-runner.js:1-19](repo://script/node-spec-runner.js#L1-L19)

Type checking is also a test. The `ts-smoke` runner compiles the generated typings against sample code, as [[API Docs and TypeScript Types]] describes.

Sources: [spec/ts-smoke/runner.js:1-18](repo://spec/ts-smoke/runner.js#L1-L18)
