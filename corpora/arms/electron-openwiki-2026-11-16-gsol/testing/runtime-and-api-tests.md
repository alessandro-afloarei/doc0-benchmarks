---
type: testing
title: Runtime and API testing
description: How Electron launches its own API test application, prepares native fixtures, selects tests, reports failures, and runs Node and declaration smoke checks.
tags: [testing, mocha, fixtures, ci, typescript]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-1e59d294433f0c981874804a
    resource: repo://script/lib/utils.js
  - id: openwiki-source-80cbb8057bb5abbe844aaae7
    resource: repo://script/node-spec-runner.js
  - id: openwiki-source-b63413b6df1236d7411a0cbc
    resource: repo://script/spec-runner.js
  - id: openwiki-source-141ce8f9fd4f733f5b609f8e
    resource: repo://spec/index.js
  - id: openwiki-source-0f529756516b7814efa5b38b
    resource: repo://spec/ts-smoke/runner.js
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# Runtime and API testing

Electron's API tests execute inside an Electron application. A Node script prepares the environment and launches the chosen binary; `spec/index.js` initializes Electron and runs Mocha after app readiness. A test can exercise TypeScript wrappers, linked C++ APIs, renderer contexts, and operating-system integration in one flow.

## Prerequisites and binary selection

Build Electron in the surrounding Chromium workspace and install repository dependencies first. The test app has its own `spec/package.json` and lockfile, including native addon fixtures. Those dependencies are separate from the root package.

`script/lib/utils.js` uses `ELECTRON_OUT_DIR` when provided and verifies that directory exists. Otherwise it chooses the first existing directory among Testing, Release, Default, and Debug under the parent `src/out`. Set the variable explicitly when more than one build exists to avoid testing an unintended binary.

## Run a focused case

From the Electron repository root:

```sh
npm run test -- -g ipc
npm run test -- --files spec/api-ipc-spec.ts
npm run test -- --files spec/api-web-contents-spec.ts -g 'loadURL'
```

The first command filters test titles, the second filters files, and the third combines them. `spec/index.js` normalizes file paths relative to the Electron checkout and fails if an explicit nonempty file selection finds no files. `npm run test` alone runs the complete API suite.

The npm pretest hook generates API declarations and runs declaration smoke checks. Directly invoking `node script/spec-runner.js` bypasses npm pretest, although the runner generates missing declarations itself.

## Preparation and launch

The host runner hashes the spec manifest, lockfile, runner script, and installed dependency tree. When these change, it reinstalls spec dependencies with frozen Yarn resolution and records the new hashes. For local builds it points native compilation at `out/<configuration>/gen/node_headers`. Native fixture compilation failures can therefore precede any Mocha test execution.

By default the runner launches the local built executable with the spec app. On Linux it inserts the D-Bus mock wrapper. `--electronVersion` instead selects and installs a published Electron version and prepares dependencies using release headers; use that for comparison, remembering it does not exercise local runtime changes.

## In-process harness and cleanup

Before readiness, the spec application configures fake media devices, test host resolution, and custom protocol privileges. It keeps the application alive when windows close and terminates on uncaught exceptions.

After readiness it registers ts-node, creates Mocha, sorts selected test files, and runs them. Deferred cleanup functions execute in reverse order before ordinary afterEach hooks. Reuse `spec/lib` helpers for windows, local servers, and temporary resources so tests do not leave state for later cases.

The harness uses a 30-second default timeout, configurable with `MOCHA_TIMEOUT`. CI forbids exclusive tests and sets retries to three. Reporter variables and `ELECTRON_TEST_RESULTS_DIR` support result collection. The host runner reports nonzero status or signal termination as failure.

## Choose coverage by boundary

| Change | Representative coverage |
| --- | --- |
| App launch or module startup | `spec/api-app-spec.ts`, `spec/esm-spec.ts` |
| Navigation and close behavior | `spec/api-web-contents-spec.ts`, `spec/api-browser-window-spec.ts` |
| Invoke, ports, or isolated exposure | `spec/api-ipc-spec.ts`, `spec/api-context-bridge-spec.ts` |
| Sessions, custom schemes, networking | `spec/api-session-spec.ts`, `spec/api-protocol-spec.ts`, `spec/api-net-spec.ts` |
| Archive-backed filesystem behavior | `spec/asar-spec.ts` |
| Utility process lifetime | `spec/api-utility-process-spec.ts` |

IPC tests demonstrate both sync and async handlers, errors, absent/removed handlers, and duplicate registration. Extend behavior-focused cases rather than merely checking that a symbol exists.

## Additional checks and failure diagnosis

For Node embedding changes, `node script/node-spec-runner.js parallel/test-crypto-keygen` runs a selected upstream Node test. The runner invokes Node's Python harness in `third_party/electron_node` with Electron as its shell and Node-mode environment variables; `--default` selects its configured default options and disabled-test list.

`npm run create-typescript-definitions` regenerates declarations and runs `spec/ts-smoke/runner.js`. Use the root lint commands for affected languages; `lint:docs` also generates declarations and includes checks that may rewrite docs.

CI's build workflow separates documentation-only routing from source jobs, and its reusable test segment runs platform/architecture shards. Local graphics, permissions, fonts, display scaling, and native headers can affect results; the [testing guide](../../docs/development/testing.md) records platform considerations.

For a failure, first establish the binary and whether setup completed, then narrow to a file and title. Preserve the complete failure output and inspect the system owner described in [IPC](../concepts/preload-isolation-and-ipc.md), [API extension](../workflows/extending-electron-apis.md), or the [quickstart](../quickstart.md).
