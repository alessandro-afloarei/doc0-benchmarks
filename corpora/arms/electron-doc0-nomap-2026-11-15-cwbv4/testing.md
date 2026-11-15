---
title: "Testing"
---
## Overview

Electron's main test suite is itself an Electron app. `spec/` contains a `package.json`, an entry script `spec/index.js`, and hundreds of mocha spec files written in TypeScript that run in the main process of a real Electron build and drive windows, renderers and child processes from there. `script/spec-runner.js` (`npm test`) prepares that app and launches it. A second runner executes Node.js's own test suite against Electron running in Node mode. This page covers both, the helpers specs use, and how tests are disabled. Running the commands is covered in [[Quickstart: Build and Run from Source]].

Sources: [docs/development/testing.md:22-58](repo://docs/development/testing.md#L22-L58), [package.json:87-92](repo://package.json#L87-L92)

## The spec runner

### Preparing the spec app

`script/spec-runner.js` parses its arguments with `minimist`, keeping unknown ones to forward to Electron and mocha. It has one runner, `main` ("Main process specs"); `--runners` limits which run.

Sources: [script/spec-runner.js:15-67](repo://script/spec-runner.js#L15-L67)

Before running, it hashes `spec/package.json`, `spec/yarn.lock` and the runner script itself, plus the installed `spec/node_modules`, and compares the result with `spec/.hash`. When anything changed it reinstalls the spec's dependencies: native modules are compiled against the Node headers from the local build (`out/<dir>/gen/node_headers`), `node_modules` is deleted, and `yarn install --frozen-lockfile` runs; the new hash is saved. It also generates `electron.d.ts` if it is missing, since specs are type-checked against it.

Sources: [script/spec-runner.js:90-130](repo://script/spec-runner.js#L90-L130), [script/spec-runner.js:224-292](repo://script/spec-runner.js#L224-L292)

### Launching Electron

`runTestUsingElectron` starts the locally built executable (found as in the quickstart) with `electron/spec` as the app path and the forwarded arguments. On Linux it runs it under `script/dbus_mock.py`, which starts private system and session D-Bus instances with mock `logind` and notification-daemon services. A non-zero exit or a kill signal fails the run. With `ELECTRON_TEST_RESULTS_DIR` set, it points `MOCHA_FILE` at `test-results-<runner>.xml` in that directory.

Sources: [script/spec-runner.js:131-222](repo://script/spec-runner.js#L131-L222), [script/dbus_mock.py:10-25](repo://script/dbus_mock.py#L10-L25)

With `--electronVersion` (a version, `latest` or `latest@<major>`), the runner instead downloads that release through `@electron/fiddle-core`, builds native modules against its published headers, and runs only the main-process specs, which makes it possible to run the suite against a released Electron without a local build.

Sources: [script/spec-runner.js:48-99](repo://script/spec-runner.js#L48-L99), [script/spec-runner.js:194-200](repo://script/spec-runner.js#L194-L200), [script/spec-runner.js:224-246](repo://script/spec-runner.js#L224-L246)

## Inside the spec app

### Process setup

`spec/index.js` runs as the app's main script. It exits on any uncaught exception instead of showing the error dialog, points `ts-node` at `tsconfig.spec.json`, turns off security warnings, exposes `gc`, keeps the app alive when all windows close, uses fake media devices, maps test host names such as `localhost2` with `host-resolver-rules`, and registers the privileged custom schemes the protocol specs need (`app`, `zoom`, `sw`, `cors`, `stream` and others) before `ready`, as [[Custom Protocols and Request Interception]] requires.

Sources: [spec/index.js:1-59](repo://spec/index.js#L1-L59)

### Building the mocha run

After `ready` it registers `ts-node`, parses `--grep`/`-g`, `--invert`/`-i` and `--files`, and configures mocha: `forbidOnly` and three retries under `CI`, reporters from `MOCHA_REPORTER`/`MOCHA_MULTI_REPORTERS` (TAP by default), sharding through `MOCHA_GREP`/`MOCHA_INVERT`, and a timeout from `MOCHA_TIMEOUT` (30 s by default).

Sources: [spec/index.js:61-130](repo://spec/index.js#L61-L130)

Spec files are every `*-spec.ts` or `*-spec.js` under `spec/`, optionally filtered by `npm_config_match` (`npm run test -match=menu`) or by the explicit `--files` list; naming files that match nothing is an error. chai is set up with `chai-as-promised` and `dirty-chai`, and full diffs. The process exits with the failure count, or, with `ELECTRON_FORCE_TEST_SUITE_EXIT`, prints it with a known key and kills itself so the outer runner can read it.

Sources: [spec/index.js:132-196](repo://spec/index.js#L132-L196), [script/spec-runner.js:161-192](repo://script/spec-runner.js#L161-L192)

### Disabled tests

`spec/disabled-tests.json` lists tests to skip by their full mocha title. A root `beforeEach` hook skips any test whose `fullTitle()` is in the list, so a test can be disabled without editing its file; suites cannot yet be disabled this way.

Sources: [spec/index.js:96-107](repo://spec/index.js#L96-L107), [spec/disabled-tests.json:1-4](repo://spec/disabled-tests.json#L1-L4)

## Writing specs

### Cleanup with defer

`spec/lib/spec-helpers.ts` provides the shared helpers. `defer(fn)` registers cleanup for the current test; `index.js` attaches `runCleanupFunctions` as an `afterEach` named `cleanup` to every suite, so deferred functions run in reverse order right after the test and before the suite's other `afterEach` hooks. `closeAllWindows` and `cleanupWebContents` in `window-helpers.ts` close every window or destroy every `webContents`, which many specs call in `afterEach` so one test's windows do not leak into the next.

Sources: [spec/lib/spec-helpers.ts:28-40](repo://spec/lib/spec-helpers.ts#L28-L40), [spec/index.js:109-121](repo://spec/index.js#L109-L121), [spec/lib/window-helpers.ts:51-70](repo://spec/lib/window-helpers.ts#L51-L70)

### Conditional and remote tests

| Helper | Use |
| --- | --- |
| `ifit(cond)`, `ifdescribe(cond)` | Run a test or suite only on some platforms or configurations; otherwise it is skipped |
| `itremote(name, fn)` | Run `fn` inside a renderer with Node integration (a hidden remote-context window) and fail the test if it throws |
| `useRemoteContext(opts)` | Create that window once for a whole suite |
| `startRemoteControlApp()` | Start a separate Electron app from `spec/fixtures/apps/remote-control` and evaluate code in its main process over HTTP |
| `waitUntil`, `repeatedly`, `listen` | Polling and local HTTP server helpers |

Sources: [spec/lib/spec-helpers.ts:25-26](repo://spec/lib/spec-helpers.ts#L25-L26), [spec/lib/spec-helpers.ts:42-97](repo://spec/lib/spec-helpers.ts#L42-L97), [spec/lib/spec-helpers.ts:160-229](repo://spec/lib/spec-helpers.ts#L160-L229)

`spec/fixtures` holds the pages, preload scripts, apps, extensions, asar archives, certificates, native add-ons and crash cases the specs load; the apps under `fixtures/apps` (such as `crash`, `remote-control` and `set-path`) are spawned as separate Electron processes when a test needs its own main process.

Sources: [spec/lib/spec-helpers.ts:79-95](repo://spec/lib/spec-helpers.ts#L79-L95)

## Node.js tests

`script/node-spec-runner.js` runs Node's own `tools/test.py` from `src/third_party/electron_node`, with the Electron executable as the `--shell` and `ELECTRON_RUN_AS_NODE=true`, so Node's suite exercises Electron in Node mode. `ELECTRON_EAGER_ASAR_HOOK_FOR_TESTING` makes the asar `child_process` patches install eagerly so stack traces match what Node's tests expect ([[ASAR Archives]]).

Sources: [script/node-spec-runner.js:1-100](repo://script/node-spec-runner.js#L1-L100), [lib/node/asar-fs-wrapper.ts:1255-1263](repo://lib/node/asar-fs-wrapper.ts#L1255-L1263)

With `--default` it uses CI's settings: TAP output to a log file, the tests listed in `script/node-disabled-tests.json` skipped, flaky tests tolerated and measured. Without it, the arguments are passed through, so a single test such as `parallel/test-crypto-keygen` can be run. `--validateDisabled` checks that every disabled test still exists, and `--jUnitDir` converts the TAP log to JUnit XML.

Sources: [script/node-spec-runner.js:25-57](repo://script/node-spec-runner.js#L25-L57), [script/node-spec-runner.js:59-100](repo://script/node-spec-runner.js#L59-L100), [script/node-disabled-tests.json:1-5](repo://script/node-disabled-tests.json#L1-L5)

## Linting

`npm run lint` runs the JavaScript, C++, Objective-C, Python, GN and Markdown linters through `script/lint.js`, plus the docs checks (fiddle code, relative links, type-checking code in Markdown, API history). Many run as pre-commit hooks through `lint-staged`, which also regenerates `filenames.auto.gni` ([[Build System]]).

Sources: [package.json:64-85](repo://package.json#L64-L85), [package.json:101-107](repo://package.json#L101-L107), [docs/development/testing.md:13-20](repo://docs/development/testing.md#L13-L20)
