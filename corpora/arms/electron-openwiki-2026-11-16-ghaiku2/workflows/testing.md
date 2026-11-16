---
type: workflow
title: Testing
description: How Electron's test suites run, covering the main-process Electron app under spec/, the spec runner that installs and launches it, the mocha options for focusing on a subset, the Node.js and NAN native test runners, the type-smoke check, and how CI shards the suite.
tags: [electron, testing, spec, mocha, spec-runner, node-tests, nan, ts-smoke, sharding]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-437d543fde8af4fce127b205
    resource: repo://.github/workflows/pipeline-segment-electron-test.yml
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
  - id: openwiki-source-77cdf815ef4367228044ad66
    resource: repo://script/split-tests.js
  - id: openwiki-source-141ce8f9fd4f733f5b609f8e
    resource: repo://spec/index.js
  - id: openwiki-source-0f529756516b7814efa5b38b
    resource: repo://spec/ts-smoke/runner.js
  - id: openwiki-source-75744acc431a23f51a13b556
    resource: repo://spec/ts-smoke/tsconfig.json
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# Testing

<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Electron has three test layers. Most tests are an Electron application under `spec/`, run inside a real Electron binary, with mocha as the runner. A second layer runs Node.js's own test suite against Electron's embedded Node fork, and a third builds native addons against Electron's headers. A type-level smoke test checks the generated typings. This page explains how each layer is started, how to narrow a run to a subset of tests, and how CI shards the suite. Building the binary that the tests need is covered in [Building Electron](/openwiki/workflows/building.md).

## The main-process spec suite

`npm run test` runs `node ./script/spec-runner.js`. Before launching anything, the runner does three things:

1. If `electron.d.ts` is missing, it runs `npm run create-typescript-definitions` to generate it. The `pretest` npm hook also runs that script before `npm test`.
2. It compares the current hash of `spec/` and of its install inputs with the values saved in `spec/.hash`. If either changed, it runs `installSpecModules` for `spec/`, which runs `yarn install --frozen-lockfile` in that directory with the Electron headers as the Node directory, then saves the new hashes. Unchanged specs skip reinstalling.
3. It selects the runners to execute. The only registered runner is `main`, with the description "Main process specs". `--runners main` is the default and the only valid value when `--electronVersion` is set.

The main runner, `runMainProcessElectronTests`, calls `runTestUsingElectron('spec', 'main')`. That spawns the built Electron binary with the argument `electron/spec` and any extra arguments the user passed. On Linux, the spawn is wrapped in `script/dbus_mock.py` so a D-Bus session is available. The binary's exit status becomes the runner's exit status.

`spec/index.js` is the entry point that Electron runs. It does the following at startup:

<!-- openwiki: broken internal link [/openwiki/architecture/security-model-and-fuses.md] link "/openwiki/architecture/security-model-and-fuses.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Sets `ELECTRON_DISABLE_SECURITY_WARNINGS`, so renderer warnings from [Security Model and Fuses](/openwiki/architecture/security-model-and-fuses.md) do not clutter the output.
- Registers privileged schemes `app`, `zoom`, and `sw` for the tests that need them.
- Adds Chromium switches such as `use-fake-device-for-media-stream` and a `host-resolver-rules` mapping for `localhost2` and related names.
- Uses `ts-node` with `tsconfig.spec.json`, so spec files are TypeScript.
- Builds a mocha instance and adds a root `beforeEach` hook that skips every test whose full title appears in `spec/disabled-tests.json`.

Spec files are named `*-spec.ts` (or `.js`). Shared helpers live in `spec/lib/` (for example `spec-helpers.ts`, `window-helpers.ts`, and `net-helpers.ts`), and test fixtures live in `spec/fixtures/`, which holds the HTML pages, native addon sources, and apps the specs load. The `api-*-spec.ts` files are organized by module, so `api-ipc-main-spec.ts` and `api-browser-window-spec.ts` test one public module each.

## Focusing a run

These options are accepted by `npm test`, which forwards unknown flags to the Electron binary:

- `npm run test -- -g <pattern>` (or `--grep`) runs only tests whose titles match the regular expression. For example, `npm run test -- -g ipc` runs the IPC tests.
- `-i` (or `--invert`) inverts the grep, so matching tests are skipped.
- `--files <spec files>` runs only the named spec files. `spec/index.js` normalizes each path, converting absolute paths to relative ones before matching them against the spec files it found.
- `--ci` is parsed by the spec index as a boolean flag.
- `--electronVersion <version>` runs the suite against a published Electron version instead of the local build. It is not compatible with runners other than `main`.

The `ELECTRON_TEST_RESULTS_DIR` environment variable makes the runner set `MOCHA_FILE` to `test-results-<runner>.xml` in that directory. `ELECTRON_FORCE_TEST_SUITE_EXIT` makes the runner take the exit status from a `Electron_Spec_Runner_Failures: <n>` line in the suite's output, rather than from the process exit code.

The runner looks for the Electron build in one of `Testing`, `Release`, `Default`, or `Debug` under `out/`, through `getOutDir` in `script/lib/utils.js`. Set `ELECTRON_OUT_DIR` to use another directory. Without a recognized directory, the runner throws an error that lists the choices.

## Node.js and NAN suites

Two other runners exercise the native layers.

`script/node-spec-runner.js` runs Node.js's own test suite against Electron's embedded Node fork under `third_party/electron_node`. It invokes `tools/test.py` with `--shell` set to the built Electron executable, so Node's tests run in Electron's embedding. Extra command-line arguments are passed through. A single test is named by its Node test path, for example:

```sh
node script/node-spec-runner.js parallel/test-crypto-keygen
```

`--default` selects the default set, `--validateDisabled` checks that the entries in `script/node-disabled-tests.json` still exist, and `--jUnitDir` writes JUnit results. Node tests that Electron cannot run are listed in `script/node-disabled-tests.json`.

<!-- openwiki: broken internal link [/openwiki/operations/ci-and-release.md] link "/openwiki/operations/ci-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`script/nan-spec-runner.js` builds and runs the NAN native-addon tests from `third_party/nan`. It must be invoked directly, not required as a module. It uses the `--only` option to select a subset and installs the `node-gyp` version pinned in NAN's own `package.json`. Pipelines that include NAN tests run it through `pipeline-electron-build-and-test-and-nan.yml`, as described in [CI, Release, and Distribution](/openwiki/operations/ci-and-release.md).

## Type-smoke test

<!-- openwiki: broken internal link [/openwiki/architecture/api-docs-and-typings.md] link "/openwiki/architecture/api-docs-and-typings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`spec/ts-smoke/runner.js` type-checks sample files against `electron.d.ts`. It is part of `npm run create-typescript-definitions` and therefore runs on every test run that regenerates the typings. Its details are covered in [API Documentation and Typings](/openwiki/architecture/api-docs-and-typings.md).

`spec/types-spec.ts` is a separate spec that runs inside the main suite. It asserts that the bundled `@types/node` major version matches the Node.js version Electron ships.

## How CI shards the main suite

The test segment in `.github/workflows/pipeline-segment-electron-test.yml` runs the main suite across matrix shards. Each shard runs `node script/split-tests <shard> <count>`, where the count is 3 on Linux and 2 on other platforms. `script/split-tests.js` lists `spec/*-spec.ts`, sorts them by the number of `it(` calls in each file, and deals them into buckets so that each shard receives roughly equal work. The shard's file list is assembled in the workflow as `tests_files`. The test segment also sets `ELECTRON_DISABLE_SECURITY_WARNINGS` and writes results to Datadog and as artifacts.

## Failure behavior

- All selected spec files run in one Electron process under one mocha instance. If that process exits non-zero, the runner reports `Electron tests failed with code <n>` and exits with status 1.
- An uncaught exception in `spec/index.js` prints the error and exits with status 1, so a crash in setup fails the whole run.
- A test listed in `spec/disabled-tests.json` is skipped, not failed. The spec index does not validate that entries still exist; only the Node runner's `--validateDisabled` option does that for its own list.
- `--electronVersion` downloads and runs a released binary, so a failure there can come from the released build rather than the source tree.

## Related pages

<!-- openwiki: broken internal link [/openwiki/workflows/building.md] link "/openwiki/workflows/building.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Building Electron](/openwiki/workflows/building.md) describes how to produce the binary these runners use.
<!-- openwiki: broken internal link [/openwiki/workflows/contributing-and-linting.md] link "/openwiki/workflows/contributing-and-linting.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Contributing and Linting](/openwiki/workflows/contributing-and-linting.md) covers the lint gates that run alongside the tests.
<!-- openwiki: broken internal link [/openwiki/operations/ci-and-release.md] link "/openwiki/operations/ci-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [CI, Release, and Distribution](/openwiki/operations/ci-and-release.md) describes the pipelines that run these suites.
