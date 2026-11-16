---
title: "Tests and Linting"
---
## Overview

Electron's tests run inside Electron itself. `script/spec-runner.js` starts the built binary on the spec directory, and the main-process spec runner in `spec/index.js` loads the `*-spec.ts` files with Mocha. Node.js's own test suite runs separately through `script/node-spec-runner.js`, and a set of lint scripts covers the code style.

Sources: [script/spec-runner.js:42-44](repo://script/spec-runner.js#L42-L44), [script/spec-runner.js:194-219](repo://script/spec-runner.js#L194-L219), [spec/index.js:62-94](repo://spec/index.js#L62-L94)

## Running the main suite

`spec-runner.js` keeps a map of runners, and at this point it has one, `main`, whose job is `runMainProcessElectronTests`. The `--runners` option picks a subset of runners by name, and each runner that is not selected is skipped.

Sources: [script/spec-runner.js:42-44](repo://script/spec-runner.js#L42-L44), [script/spec-runner.js:49-66](repo://script/spec-runner.js#L49-L66), [script/spec-runner.js:131-146](repo://script/spec-runner.js#L131-L146)

`runTestUsingElectron` spawns the built executable with `electron/spec` as its argument. On Linux it runs the spawn through `dbus_mock.py` with `python3`. A non-zero exit ends the whole script with status 1 at once. An error thrown by a runner is caught instead, and the errors of all failed runners are printed at the end.

Sources: [script/spec-runner.js:194-219](repo://script/spec-runner.js#L194-L219), [script/spec-runner.js:148-159](repo://script/spec-runner.js#L148-L159)

If `ELECTRON_TEST_RESULTS_DIR` is set, each runner writes its results to its own XML file in that directory.

Sources: [script/spec-runner.js:134-141](repo://script/spec-runner.js#L134-L141)

## The Mocha runner

`spec/index.js` runs inside the Electron binary. It makes the app keep running after its last window closes, enables `--expose_gc`, registers the test schemes as privileged, and turns on fake media devices for the tests.

Sources: [spec/index.js:24-27](repo://spec/index.js#L24-L27), [spec/index.js:29-59](repo://spec/index.js#L29-L59)

The Mocha options come from the environment and the command line. When `CI` is set, tests are retried three times. The `MOCHA_REPORTER`, `MOCHA_GREP`, `MOCHA_INVERT` and `MOCHA_TIMEOUT` variables and the `--grep` and `--invert` flags set the reporter, the filter and the timeout.

Sources: [spec/index.js:62-94](repo://spec/index.js#L62-L94), [spec/index.js:126-131](repo://spec/index.js#L126-L131)

Files are picked by name: only paths ending in `-spec.ts` or `-spec.js` are added. The file list comes from `get-files`, and the run ends by printing the failure count and exiting with it.

Sources: [spec/index.js:133-161](repo://spec/index.js#L133-L161), [spec/index.js:171-177](repo://spec/index.js#L171-L177), [spec/index.js:191](repo://spec/index.js#L191)

## Helpers for writing specs

`spec/lib/spec-helpers.ts` exports `ifit` and `ifdescribe`, which run a test only when a condition holds, and skip it otherwise. They are how a spec is limited to a platform or a build.

Sources: [spec/lib/spec-helpers.ts:16-26](repo://spec/lib/spec-helpers.ts#L16-L26)

`defer` registers a cleanup function, and `runCleanupFunctions` is attached as an `afterEach` hook on every suite, so a test's cleanups run after it. `waitUntil` waits until a condition holds.

Sources: [spec/lib/spec-helpers.ts:29-38](repo://spec/lib/spec-helpers.ts#L29-L38), [spec/index.js:117-121](repo://spec/index.js#L117-L121), [spec/lib/spec-helpers.ts:97-101](repo://spec/lib/spec-helpers.ts#L97-L101)

`itremote` runs a test body in a remote window, so the code runs in a renderer rather than in the main-process spec. Its helper keeps a shared remote context for that purpose.

Sources: [spec/lib/spec-helpers.ts:157-175](repo://spec/lib/spec-helpers.ts#L157-L175), [spec/lib/spec-helpers.ts:183-221](repo://spec/lib/spec-helpers.ts#L183-L221)

## Node.js tests

`node-spec-runner.js` runs Node's own `tools/test.py` against the Electron binary. It passes the executable with `--shell`, and it passes every test name in `node-disabled-tests.json` with `--skip-tests`.

Sources: [script/node-spec-runner.js:8](repo://script/node-spec-runner.js#L8), [script/node-spec-runner.js:25-39](repo://script/node-spec-runner.js#L25-L39)

The disabled-test list is a JSON array of Node test paths, such as `parallel/test-code-cache`. The runner can optionally check, before it runs, that every listed test still exists.

Sources: [script/node-disabled-tests.json:1-6](repo://script/node-disabled-tests.json#L1-L6), [script/node-spec-runner.js:59-77](repo://script/node-spec-runner.js#L59-L77)

## Linting

`npm run lint` runs `script/lint.js` and then the documentation checks. The other lint scripts select one language each: JavaScript, C++, Objective-C, Python, GN and Markdown.

Sources: [package.json:64-71](repo://package.json#L64-L71)

`lint.js` parses the command line to choose which languages to check. `findChangedFiles` runs `git diff --name-only --cached` and returns the staged files, so a check can run on the files about to be committed. Its `main` runs the chosen linters.

Sources: [script/lint.js:398-416](repo://script/lint.js#L398-L416), [script/lint.js:433-443](repo://script/lint.js#L433-L443), [script/lint.js:486-490](repo://script/lint.js#L486-L490)
