---
title: "Test Suite and Spec Runner"
---
## Overview

Electron's tests are an Electron application. The `spec/` folder is an app whose main script starts Mocha inside the main process and loads one `*-spec.ts` file per feature; `npm test` runs `script/spec-runner.js`, which installs the spec's dependencies if they changed and launches the built Electron binary on that app. Two further runners check the embedded Node.js and the `nan` headers. This page follows a test run and describes the conventions a spec uses. Building the binary under test is in [[Building and Running Electron from Source]].

Sources: [package.json:92-92](repo://package.json#L92-L92), [script/spec-runner.js:42-44](repo://script/spec-runner.js#L42-L44), [spec/package.json:1-5](repo://spec/package.json#L1-L5)

## Running tests

`npm test` runs `node ./script/spec-runner.js`, and its `pretest` script first regenerates the TypeScript definitions. The testing guide adds that the binary's output directory must be named `Testing`, `Release` or `Default`, or given by `ELECTRON_OUT_DIR`, and that `npm run test -- -g=PATTERN` runs only tests whose titles match a regular expression.

Sources: [package.json:87-92](repo://package.json#L87-L92), [docs/development/testing.md:19-36](repo://docs/development/testing.md#L19-L36)

The runner's own flow is:

Sources: [script/spec-runner.js:22-24](repo://script/spec-runner.js#L22-L24)

1. Parse arguments with `minimist`: `--runners` and `--electronVersion` are known; every other flag is collected to forward to the spec app.
2. If `--electronVersion` is given (`latest`, `latest@<major>` or an exact version), only the `main` runner is allowed, and the binary comes from `@electron/fiddle-core`'s installer. Otherwise the binary is the local build found by `utils.getElectronExec()`.
3. Hash `spec/package.json`, `spec/yarn.lock` and the runner script, plus the contents of `spec/node_modules`. If either hash differs from the saved `spec/.hash`, delete `node_modules` and run `yarn install --frozen-lockfile`, pointing native-module builds at the local Node headers (or at the Electron headers when testing a released version).
4. Generate `electron.d.ts` if missing.
5. Spawn the binary with `electron/spec` and the forwarded flags, piping its output. On Linux it is run under `python3 script/dbus_mock.py`.
6. A non-zero exit prints a failure with the exit code or signal and ends the runner with status 1.

Sources: [script/spec-runner.js:22-67](repo://script/spec-runner.js#L22-L67), [script/spec-runner.js:69-108](repo://script/spec-runner.js#L69-L108), [script/spec-runner.js:194-218](repo://script/spec-runner.js#L194-L218), [script/spec-runner.js:224-264](repo://script/spec-runner.js#L224-L264)

`ELECTRON_FORCE_TEST_SUITE_EXIT` changes how the result is read. The spec app prints a line with `Electron_Spec_Runner_Failures: <n>` and then kills itself, and the runner scans stdout for that line to learn the failure count instead of using the exit status. `ELECTRON_TEST_RESULTS_DIR` sets the Mocha output file for a runner.

Sources: [script/spec-runner.js:131-159](repo://script/spec-runner.js#L131-L159), [script/spec-runner.js:161-190](repo://script/spec-runner.js#L161-L190), [spec/index.js:170-180](repo://spec/index.js#L170-L180)

## The spec application

`spec/index.js` is the app's main script. Before `ready` it sets up the test environment: it turns off security warnings and points ts-node at `tsconfig.spec.json`; exposes `gc` to scripts; prevents the app from quitting when a window closes; uses a fake media device and host-resolver rules for `localhost2` names; and registers a set of privileged custom schemes (`app`, `zoom`, `sw`, `http-like`, `cors`, `stream` and others) with `protocol.registerSchemesAsPrivileged`, which must happen before ready: see [[Sessions, Custom Protocols and Network Interception]].

Sources: [spec/index.js:1-59](repo://spec/index.js#L1-L59)

After `ready`, it loads `ts-node`, configures Mocha from environment variables (`CI` forbids `.only` and retries three times; `MOCHA_REPORTER`, `MOCHA_TIMEOUT` with a default of 30 s, `MOCHA_GREP`, `MOCHA_INVERT` and so on), and parses `--grep`, `--invert` and `--files`.

Sources: [spec/index.js:61-93](repo://spec/index.js#L61-L93), [spec/index.js:123-130](repo://spec/index.js#L123-L130)

Test selection works on file names. A file counts if it matches `-spec.ts` or `-spec.js`, matches the `npm_config_match` regular expression if set, and is in the `--files` list if one was given. The files are sorted and added to Mocha, and a `--files` list that matches nothing is an error.

Sources: [spec/index.js:132-168](repo://spec/index.js#L132-L168)

Tests can be disabled by full title in `spec/disabled-tests.json`; a root `beforeEach` skips any test whose full title is in the set. A cleanup hook, registered on every suite so that it runs before other `afterEach` hooks, runs the functions queued with `defer()`, in reverse order.

Sources: [spec/index.js:96-121](repo://spec/index.js#L96-L121), [spec/lib/spec-helpers.ts:25-45](repo://spec/lib/spec-helpers.ts#L25-L45)

Chai gets `chai-as-promised` and `dirty-chai`, with full object diffs.

Sources: [spec/index.js:182-190](repo://spec/index.js#L182-L190)

## Structure of a spec

Specs are named after what they cover: `api-<module>-spec.ts` for each public module, plus specs for Chromium behaviour, ASAR, fuses, and the webview tag. Each is a Mocha `describe` that creates windows and drives them through the public API.

Sources: [spec/api-ipc-spec.ts:15-23](repo://spec/api-ipc-spec.ts#L15-L23)

`spec/api-ipc-spec.ts` shows the pattern for the IPC path in [[IPC Between Renderer and Main]]. It creates a hidden `BrowserWindow` with node integration on and context isolation off, loads `about:blank`, registers an `ipcMain.handleOnce` handler, runs a function inside the page with `executeJavaScript`, and has the page send its result back over a second channel, which the test awaits.

Sources: [spec/api-ipc-spec.ts:15-48](repo://spec/api-ipc-spec.ts#L15-L48)

```ts
w = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
await w.loadURL('about:blank');
```

Sources: [spec/api-ipc-spec.ts:15-48](repo://spec/api-ipc-spec.ts#L15-L48)

Helpers in `spec/lib/` keep that pattern short. `spec-helpers.ts` provides `ifit` and `ifdescribe` (skip when a condition is false), `defer`, `waitUntil`, `listen` and a remote-control app launcher. `window-helpers.ts` provides `closeWindow` and `closeAllWindows`: closing waits for the `closed` event when a window may still have `<webview>` children, and asserts afterwards that no windows remain.

Sources: [spec/lib/spec-helpers.ts:25-45](repo://spec/lib/spec-helpers.ts#L25-L45), [spec/lib/window-helpers.ts:7-49](repo://spec/lib/window-helpers.ts#L7-L49)

## Node.js and nan runners

`script/node-spec-runner.js` runs Node's own test suite against Electron's embedded Node. It runs Node's `tools/test.py` in `third_party/electron_node` with `ELECTRON_RUN_AS_NODE` set and the Electron executable as the shell, so these tests exercise the path in [[Utility Processes and Run-as-Node]]. With `--default` it uses a fixed option set that skips the tests listed in `node-disabled-tests.json`; without it, extra arguments (such as a test path) are passed through. `--validateDisabled` checks that every disabled test still exists. `--jUnitDir` converts the TAP output to JUnit.

Sources: [script/node-spec-runner.js:1-52](repo://script/node-spec-runner.js#L1-L52), [script/node-spec-runner.js:54-103](repo://script/node-spec-runner.js#L54-L103), [docs/development/testing.md:40-56](repo://docs/development/testing.md#L40-L56)

`script/nan-spec-runner.js` does the same for `third_party/nan`, reading the `node-gyp` version from nan's `package.json`, with an `--only` flag to select tests.

Sources: [script/nan-spec-runner.js:17-33](repo://script/nan-spec-runner.js#L17-L33), [script/nan-spec-runner.js:127-141](repo://script/nan-spec-runner.js#L127-L141)

## Linting

`npm run lint` runs `script/lint.js` followed by the docs lint, and there are targeted scripts for JavaScript, C++ (`clang-format` over `shell/`, `clang-tidy`), Objective-C, Python, GN and Markdown. The testing guide notes that many checks also run as pre-commit hooks.

Sources: [package.json:64-80](repo://package.json#L64-L80), [docs/development/testing.md:11-17](repo://docs/development/testing.md#L11-L17)
