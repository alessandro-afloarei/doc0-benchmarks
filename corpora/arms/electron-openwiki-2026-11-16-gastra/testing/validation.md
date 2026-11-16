---
type: testing
title: Testing and API validation
description: Running focused Electron specs, preparing native addon headers, validating generated API types, and selecting Node, native, or CI checks.
tags: [testing, specs, typescript, ci, validation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-7a80b79a6fb3618cbfab08a2
    resource: repo://.github/workflows/build.yml
  - id: openwiki-source-89473520499d52e0cd993b3d
    resource: repo://.github/workflows/pipeline-electron-docs-only.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-60ce06900da9c82713a266a1
    resource: repo://script/lib/native_tests.py
  - id: openwiki-source-1e59d294433f0c981874804a
    resource: repo://script/lib/utils.js
  - id: openwiki-source-80cbb8057bb5abbe844aaae7
    resource: repo://script/node-spec-runner.js
  - id: openwiki-source-b63413b6df1236d7411a0cbc
    resource: repo://script/spec-runner.js
  - id: openwiki-source-141ce8f9fd4f733f5b609f8e
    resource: repo://spec/index.js
  - id: openwiki-source-4c88e92b4d450d55be24a1a1
    resource: repo://spec/package.json
  - id: openwiki-source-0f529756516b7814efa5b38b
    resource: repo://spec/ts-smoke/runner.js
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# Testing and API validation

The main spec suite is itself an Electron application. It needs a built or explicitly selected Electron runtime and its own dependencies, including native test addons. A plain repository checkout and a system Node installation are not enough to run the local-runtime suite.

## Prepare the intended runtime

In the full checkout's Chromium src directory, build Electron and the Node headers used by spec addons:

```sh
ninja -C out/Testing electron electron:node_headers
```

Then run commands from src/electron. The runtime selector checks ELECTRON_OUT_DIR or an explicit output selection, otherwise searches Testing, Release, Default, and Debug under the parent src/out. It verifies that the selected directory exists. Set ELECTRON_OUT_DIR to the directory name for a custom build.

The spec runner hashes the spec manifest, lockfile, runner, and installed dependencies. When hashes change, it reinstalls spec dependencies with frozen-lockfile Yarn and points native addon builds at the selected output's gen/node_headers. With --electronVersion, it instead obtains release headers and selects a downloaded runtime. That mode tests the selected release, not local native edits.

## Focused and full runs

```sh
npm run test -- -g 'ipc'
npm run test -- --files spec/api-context-bridge-spec.ts
npm run test
```

The npm pretest hook generates API declarations and runs TypeScript smoke checks before the spec runner. The runner launches the spec app; on Linux it wraps the executable with script/dbus_mock.py. Unknown runner arguments are forwarded to the spec application.

spec/package.json selects index.js. That entry configures test switches, prevents window-all-closed from terminating the suite, waits for app readiness, installs ts-node, and starts Mocha. It selects sorted *-spec.ts/js files, supports grep/invert and explicit file lists, and fails if an explicit list matches nothing. Normal completion exits with Mocha's failure count.

MOCHA_TIMEOUT, reporter variables, and grep/invert environment variables provide suite configuration. CI forbids .only and enables retries; disabled-test filtering is also part of the entrypoint. A passing filtered run establishes only the selected coverage.

## Choose checks by the affected boundary

| Change | Useful starting coverage |
| --- | --- |
| Main/renderer messages and replies | api-ipc-spec.ts, api-ipc-main-spec.ts, api-ipc-renderer-spec.ts |
| Preloads or cross-world conversion | api-context-bridge-spec.ts, sandbox variants and preload fixtures |
| Window ownership/navigation | api-browser-window-spec.ts, api-web-contents-spec.ts |
| Storage, networking, custom schemes | api-session-spec.ts, api-net-spec.ts, api-protocol-spec.ts |
| Archive or background-process behavior | asar-spec.ts, api-utility-process-spec.ts |
| Public API shape | Documentation parser, generated definitions, spec/ts-smoke |
| Node integration or Node patches | Node smoke runner plus focused Electron behavior |

Tests often create windows, local servers, temporary profiles and child applications. Follow neighboring cleanup helpers and fixtures so destruction, pending replies, or persisted sessions do not contaminate later tests. The system pages link specific failure cases.

For Node integration, the repository documents:

```sh
node script/node-spec-runner.js
node script/node-spec-runner.js parallel/test-crypto-keygen
```

This runner invokes the vendored Node tools/test.py using Electron as its shell, with ELECTRON_RUN_AS_NODE and the eager ASAR testing hook. The --default option selects the runner's predefined skip/flakiness configuration; arbitrary arguments are otherwise forwarded to Node's test tool.

Native C++ tests also exist alongside implementations. script/lib/native_tests.py is a helper that reads configured binaries, checks platform eligibility, and applies disabled-test policy. Resolve the owning GN target and configuration in the full dependency checkout before running a native test; it is not one of the main spec runner's registered runners.

## API and lint checks

```sh
npm run create-typescript-definitions
npm run lint:js
npm run lint:cpp
npm run lint:gn
```

The declaration command parses docs into electron-api.json, runs the declaration generator, then compiles TypeScript smoke fixtures. The root lint and lint:docs scripts combine several checks; lint:docs includes formatting commands that can rewrite documentation, as well as code examples, links and API history checks. Inspect the script before using it as a supposedly read-only check.

## CI routing and limits

The Build workflow filters docs/** from other paths, routes documentation-only work to a dedicated pipeline, and invokes reusable lint/build/test workflows. The docs-only pipeline still generates declarations, type-checks the default app, and compiles webpack bundles. A documentation edit can therefore affect compiled public types.

For local failures, distinguish output-directory selection, header/addon installation, type generation, and actual test assertions. See [build setup](../workflows/build-electron.md), [API layers](../architecture/api-layers.md), and [dependency patch validation](../workflows/dependency-patches.md).
