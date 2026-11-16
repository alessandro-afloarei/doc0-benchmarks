---
type: testing
title: "Testing: spec runner and test suites"
description: How Electron's tests run — npm test via script/spec-runner.js, the spec/ directory as a Mocha-based Electron app (spec/index.js), filtering and CI options, helpers in spec/lib and fixtures, disabled tests, the TypeScript smoke test, and the Node.js, NAN and native (Chromium) test runners.
tags: [testing, mocha, spec, node-tests, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-4e645e0fe2bd45670a49de39
    resource: repo://build/args/native_tests.gn
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
  - id: openwiki-source-9d4d848abdc8012a9dc521d3
    resource: repo://spec/lib/spec-helpers.ts
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Testing: spec runner and test suites

Electron's main test suite is **itself an Electron app**: `spec/` has its own
`package.json` / `yarn.lock`, and the built Electron binary runs it with
Mocha. Additional runners exercise Electron's Node.js fork and native addon
compatibility.

## Running specs

```sh
npm run test                       # node ./script/spec-runner.js
npm run test -- -g "ipc"           # Mocha grep (regex on test titles)
npm run test -- -i -g "pattern"    # invert grep
npm run test -- --files spec/api-ipc-spec.ts
npm run test -- --electronVersion=latest   # run specs against a released build
```

The local build must be in `out/Testing`, `out/Release` or `out/Default`
(relative to `src/`), or `ELECTRON_OUT_DIR` must be set — see
`docs/development/testing.md`. On Linux, specs need a display (CI uses
Xvfb).

### `script/spec-runner.js`

- Parses `--runners` (currently only `main`), `--target` and
  `--electronVersion`; unknown flags are forwarded to the spec app.
- Hashes `spec/package.json`, `spec/yarn.lock` and the runner itself, plus
  the contents of `spec/node_modules` (stored in `spec/.hash`), and
  reinstalls `spec/` dependencies with `yarn install --frozen-lockfile` only
  when something changed. Native modules are compiled against the local
  build's Node headers (`npm_config_nodedir=out/<dir>/gen/node_headers`), or
  against downloaded Electron headers with `--electronVersion`.
- Generates `electron.d.ts` if missing (specs are TypeScript and type-checked
  against it).
- Launches the Electron executable (or a downloaded version via
  `@electron/fiddle-core` when `--electronVersion` is given) with
  `electron/spec` as the app; on Linux it is wrapped by `script/dbus_mock.py`
  so notification/power D-Bus APIs can be tested.
- `ELECTRON_FORCE_TEST_SUITE_EXIT` makes the runner parse the
  `Electron_Spec_Runner_Failures: N` line instead of relying on exit codes;
  `ELECTRON_TEST_RESULTS_DIR` collects JUnit output.

### `spec/index.js` (the spec app's main)

Before `ready` it sets up the environment tests depend on:

- exits on uncaught exceptions; disables security warnings; exposes GC
  (`--expose_gc`); keeps running when windows close;
- fake media devices, `host-resolver-rules` mapping `localhost2` hosts,
  optional `ELECTRON_TEST_DISABLE_HARDWARE_ACCELERATION`;
- registers privileged test schemes (`app`, `zoom`, `sw`, `http-like`,
  `cors`, `no-cors`, `stream`, `foo`, `bar`, …) because this must happen
  before `ready`.

After `ready` it registers `ts-node` (using `tsconfig.spec.json`), builds a
Mocha instance and:

- on CI (`process.env.CI`) forbids `.only` and **retries failed tests up to 3
  times**; honours `MOCHA_REPORTER`, `MOCHA_MULTI_REPORTERS`, `MOCHA_GREP`,
  `MOCHA_INVERT` (used for sharding) and `MOCHA_TIMEOUT` (default 30s);
- skips any test whose full title is listed in `spec/disabled-tests.json`;
- attaches `runCleanupFunctions` as the **first** `afterEach` in every suite,
  so cleanups registered with `defer()` run before other hooks;
- collects every `*-spec.ts|js` under `spec/` (optionally filtered by
  `npm_config_match` or `--files`; unmatched `--files` is an error);
- configures chai with `chai-as-promised` and `dirty-chai`, and reports via
  TAP by default.

## Writing specs

Specs live at `spec/api-<module>-spec.ts` (plus feature specs such as
`webview-spec.ts`, `chromium-spec.ts`, `node-spec.ts`,
`security-warnings-spec.ts`) and run in the **main process** of the spec
app; renderer behavior is tested by creating windows. Useful helpers in
`spec/lib/`:

| Helper | Use |
| --- | --- |
| `spec-helpers.ts` | `ifit` / `ifdescribe` (conditional tests by platform or feature), `defer()` cleanup, `waitUntil`, `repeatedly`, `listen` (start an HTTP server on a free port), `startRemoteControlApp`, `itremote` / `useRemoteContext` (run a test body inside a renderer) |
| `window-helpers.ts` | `closeWindow` / `closeAllWindows` for reliable teardown |
| `events-helpers.ts` | awaiting events |
| `net-helpers.ts`, `screen-helpers.ts`, `codesign-helpers.ts`, `fs-helpers.ts`, `accelerator-helpers.ts` | domain helpers |

Fixtures live in `spec/fixtures/` — apps launched as child processes
(`fixtures/apps`, `fixtures/api`), pages, ASAR archives (`test.asar`),
certificates, extensions, native addons, crash cases, auto-update fixtures,
workers and webview pages.

Conventions worth following:

- Gate platform- or build-flag-specific tests with `ifdescribe`/`ifit`
  (e.g. using `process.platform` or the `electron_common_features` binding;
  see [Fuses and build flags](../systems/fuses-and-build-flags.md)).
- Always close windows and servers (via `afterEach(closeAllWindows)` or
  `defer`) — leaked windows make later specs flaky.
- For process-level behaviors (startup, crash, quit, fuses), spawn a
  fixture app rather than mutating the spec app.

## Type definition smoke test

`npm run create-typescript-definitions` regenerates `electron.d.ts` from
`docs/api` and then runs `spec/ts-smoke/runner.js`, which compiles
`spec/ts-smoke/electron/` against it — catching doc/typing regressions (see
[Workflow: adding or changing an API](../workflows/adding-an-api.md)).

## Other runners

- **Node.js tests** — `node script/node-spec-runner.js [test]` runs Node's own
  `tools/test.py` suite from `third_party/electron_node` with the Electron
  binary in `ELECTRON_RUN_AS_NODE` mode, skipping tests listed in
  `script/node-disabled-tests.json` (the runner can also validate that every
  disabled test still exists). Use it when changing Node embedding or Node
  patches.
- **NAN tests** — `script/nan-spec-runner.js` builds `third_party/nan`'s test
  addons with `node-gyp` against Electron's generated node headers
  (`out/<dir>/gen/node_headers`) and runs them under Electron, validating
  native-module ABI compatibility.
- **Native/Chromium tests** — `build/args/native_tests.gn` adds
  `//electron/spec-chromium:spec` to the build and
  `script/lib/native_tests.py` runs configured Chromium gtest binaries with
  per-platform disabled-test lists. C++ unit tests such as
  `shell/browser/ui/accelerator_util_unittests.cc` use
  `run_all_unittests.cc`.

## Related

- Building the binary under test:
  [GN build, DEPS and build configuration](../build/gn-build-and-deps.md).
- Focused spec files are listed on each system page (e.g.
  [IPC between main and renderer](../systems/ipc.md)).
