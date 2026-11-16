---
title: "Test Suite"
---
## Overview

Electron's main test suite is itself an Electron app. `spec/` has its own `package.json` (named `electron-test-main`, with `index.js` as `main`) and its own dependencies, and `script/spec-runner.js` launches the built Electron binary on that directory. Inside, `spec/index.js` sets up the app and runs every `*-spec.ts` file with Mocha in the main process, so specs can create real windows, sessions and utility processes. Two more runners reuse upstream test suites: Node.js's own tests run against Electron in run-as-Node mode, and nan's tests check native-addon compatibility.

Sources: [spec/package.json:1-8](repo://spec/package.json#L1-L8), [script/spec-runner.js:194-221](repo://script/spec-runner.js#L194-L221), [spec/index.js:61-130](repo://spec/index.js#L61-L130), [spec/index.js:132-196](repo://spec/index.js#L132-L196)

How to build Electron and run `npm test` is in [[Quickstart: Build and Run Electron]]. This page covers what happens after that command.

Sources: [package.json:83-89](repo://package.json#L83-L89)

## spec-runner.js

`npm test` runs `script/spec-runner.js`. Before that, its `pretest` hook regenerates `electron.d.ts` from the API docs. The runner has a single runner, `main`, and `--runners` must name a subset of it.

Sources: [package.json:83-89](repo://package.json#L83-L89), [script/spec-runner.js:21-67](repo://script/spec-runner.js#L21-L67)

`main()` keeps the spec app's `node_modules` up to date. It hashes the spec sources and lockfile and compares them with `spec/.hash`. When they differ, it reinstalls with yarn, pointing `node-gyp` at the build's `out/<dir>/gen/node_headers`, so native test addons compile against this exact Electron. It also generates the type definitions if they are missing, then runs the tests.

Sources: [script/spec-runner.js:92-129](repo://script/spec-runner.js#L92-L129), [script/spec-runner.js:223-255](repo://script/spec-runner.js#L223-L255)

`runTestUsingElectron` resolves the executable, or with `--electronVersion` downloads a released Electron through `@electron/fiddle-core`. It passes `electron/spec` plus any unknown arguments, so flags like `-g ipc` reach the spec app. On Linux it runs the executable under `script/dbus_mock.py`. With `ELECTRON_TEST_RESULTS_DIR` set, each runner writes JUnit XML through `MOCHA_FILE`.

Sources: [script/spec-runner.js:194-221](repo://script/spec-runner.js#L194-L221), [script/spec-runner.js:131-159](repo://script/spec-runner.js#L131-L159), [script/spec-runner.js:47-80](repo://script/spec-runner.js#L47-L80)

`ELECTRON_FORCE_TEST_SUITE_EXIT` changes how failures are reported. The spec app prints `Electron_Spec_Runner_Failures: <n>` and kills itself instead of exiting, and the runner takes the exit status from that line rather than from the process.

Sources: [script/spec-runner.js:161-192](repo://script/spec-runner.js#L161-L192), [spec/index.js:170-180](repo://spec/index.js#L170-L180)

## The spec app

### Before ready

`spec/index.js` prepares the app before `ready`. It exits with status 1 on an uncaught exception instead of showing a dialog, points ts-node at `tsconfig.spec.json`, and turns off the security warnings. It exposes `--expose_gc` to the main process and to renderers through `js-flags`, and keeps the app alive when windows close. It adds switches for fake media devices and for host resolver rules that map names such as `localhost2` and `notfound.localhost2`.

Sources: [spec/index.js:1-42](repo://spec/index.js#L1-L42)

It also registers the custom schemes the specs need, because `registerSchemesAsPrivileged` only works before `ready`, as [[Custom Protocols and the net Module]] explains. `app`, `zoom` and `sw` are exposed as globals, along with test schemes for each combination of `standard`, `corsEnabled`, `supportFetchAPI`, `stream` and service worker support.

Sources: [spec/index.js:44-59](repo://spec/index.js#L44-L59)

### Running Mocha

Once ready, it registers ts-node, parses `--ci`, `--files`, `-g/--grep` and `-i/--invert` with yargs, and creates Mocha.

Sources: [spec/index.js:61-71](repo://spec/index.js#L61-L71)

- On CI, `.only` is forbidden and each test is retried up to three times.
- `MOCHA_REPORTER`, `MOCHA_MULTI_REPORTERS`, `MOCHA_GREP` and `MOCHA_INVERT` configure reporting and sharding; the comment says vendor builds use the last two to shard.
- The default reporter is TAP, and the default timeout is 30 seconds (`MOCHA_TIMEOUT`).
- A root `beforeEach` skips any test whose full title appears in `spec/disabled-tests.json`.

Sources: [spec/index.js:61-130](repo://spec/index.js#L61-L130)

Test files are every `*-spec.ts` or `*-spec.js` directly under `spec/`, filtered by `npm_config_match` (so `npm run test -match=menu` runs the menu specs) and by `--files`. Explicit files that match nothing fail the run. Files are added in sorted order, and chai is set up with `chai-as-promised`, `dirty-chai` and full diffs before Mocha starts.

Sources: [spec/index.js:132-191](repo://spec/index.js#L132-L191), [spec/get-files.ts:1-11](repo://spec/get-files.ts#L1-L11)

## Spec layout

Most spec files are named after the module they test, such as `api-browser-window-spec.ts`, `api-ipc-spec.ts`, `api-protocol-spec.ts` and `api-utility-process-spec.ts`. Others cover cross-cutting behaviour: `asar-spec.ts`, `asar-integrity-spec.ts`, `chromium-spec.ts`, `node-spec.ts`, `fuses-spec.ts`, `webview-spec.ts`, `guest-window-manager-spec.ts` and `security-warnings-spec.ts`. Static inputs live in `spec/fixtures`: pages, small apps under `fixtures/apps`, native addons that the spec `package.json` installs as `@electron-ci/*` packages, extensions, certificates and ASAR archives.

Sources: [spec/package.json:9-30](repo://spec/package.json#L9-L30)

`spec/ts-smoke` checks that the generated `electron.d.ts` compiles against a sample of API usage. It runs `tsc` on its own project and runs as part of `create-typescript-definitions`.

Sources: [spec/ts-smoke/runner.js:1-17](repo://spec/ts-smoke/runner.js#L1-L17), [package.json:79-80](repo://package.json#L79-L80)

## Helpers in spec/lib

### Cleanup and conditional tests

`defer(fn)` registers a cleanup function for the current test. `runCleanupFunctions` runs the deferred functions in reverse order of registration, awaiting promises. `spec/index.js` attaches it as the first `afterEach` of every suite, so deferred cleanups run before any regular `afterEach` hook; the comment there spells out the order. `ifit(condition)` and `ifdescribe(condition)` return `it` or `describe`, or their `.skip` versions, for platform-specific tests.

Sources: [spec/lib/spec-helpers.ts:16-40](repo://spec/lib/spec-helpers.ts#L16-L40), [spec/index.js:109-121](repo://spec/index.js#L109-L121)

### Renderer-side tests

`itremote(name, fn, args)` runs a test body inside a renderer instead of the main process. `getRemoteContext` creates, or reuses, a hidden `BrowserWindow` with Node integration and no context isolation. The function's source is sent with `executeJavaScript`, wrapped so that it loads chai inside the page, and returns `{ ok, message }`. A failure becomes an `AssertionError` in the main process. `useRemoteContext(opts)` gives a suite its own window with custom preferences.

Sources: [spec/lib/spec-helpers.ts:158-221](repo://spec/lib/spec-helpers.ts#L158-L221)

### Separate app processes

`startRemoteControlApp(args)` spawns another Electron process running `fixtures/apps/remote-control`, which listens on a random local port and `eval`s any JavaScript posted to it, replying with a V8-serialized result. `remoteEval` and `remotely(fn, ...args)` drive it, which lets specs test behaviour that needs a fresh app, such as command-line switches at startup. The process is killed through `defer`, and the fixture exits by itself after 30 seconds.

Sources: [spec/lib/spec-helpers.ts:42-95](repo://spec/lib/spec-helpers.ts#L42-L95), [spec/fixtures/apps/remote-control/main.js:1-38](repo://spec/fixtures/apps/remote-control/main.js#L1-L38)

### Windows

`window-helpers.ts` keeps specs from leaking windows. `closeWindow(w)` destroys a window and, when it still has live web contents, waits for `closed`, since `<webview>` children may need to go first. By default it then asserts on the next tick that no windows remain, destroying any it finds. `closeAllWindows` and `cleanupWebContents` close every window or destroy every `WebContents`.

Sources: [spec/lib/window-helpers.ts:1-70](repo://spec/lib/window-helpers.ts#L1-L70)

## Node.js and nan suites

`script/node-spec-runner.js` runs Node's own `tools/test.py` in `third_party/electron_node`, with the built Electron as the `--shell`. It sets `ELECTRON_RUN_AS_NODE`, which runs the binary in the mode described in [[Process Startup]], and `ELECTRON_EAGER_ASAR_HOOK_FOR_TESTING`, so the ASAR `child_process` hooks are installed eagerly and stack traces match Node's expectations. With `--default`, it skips the tests listed in `node-disabled-tests.json` and writes TAP output, optionally converted to JUnit. `--validateDisabled` checks that every disabled test still exists upstream.

Sources: [script/node-spec-runner.js:1-109](repo://script/node-spec-runner.js#L1-L109), [lib/node/asar-fs-wrapper.ts:1254-1263](repo://lib/node/asar-fs-wrapper.ts#L1254-L1263)

`script/nan-spec-runner.js` builds nan's test addons with `node-gyp` against the build's Node headers, installs the test dependencies, and runs nan's JavaScript tests. A few files are disabled with reasons in comments, and `--only` narrows the run.

Sources: [script/nan-spec-runner.js:1-40](repo://script/nan-spec-runner.js#L1-L40), [script/nan-spec-runner.js:100-161](repo://script/nan-spec-runner.js#L100-L161)
