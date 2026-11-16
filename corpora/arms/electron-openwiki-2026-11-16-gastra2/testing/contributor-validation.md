---
type: testing
title: Contributor tests and debugging
description: How Electron's spec app is launched, how fixtures and native headers are prepared, and which focused checks validate runtime, types and dependency changes.
tags: [testing, debugging, mocha, typescript, ci]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-437d543fde8af4fce127b205
    resource: repo://.github/workflows/pipeline-segment-electron-test.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-80cbb8057bb5abbe844aaae7
    resource: repo://script/node-spec-runner.js
  - id: openwiki-source-b63413b6df1236d7411a0cbc
    resource: repo://script/spec-runner.js
  - id: openwiki-source-141ce8f9fd4f733f5b609f8e
    resource: repo://spec/index.js
  - id: openwiki-source-0f529756516b7814efa5b38b
    resource: repo://spec/ts-smoke/runner.js
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# Contributor tests and debugging

Electron's API tests run inside an Electron application. The root test command launches an orchestration script, which prepares the separate `spec` dependencies and starts the selected Electron executable. A plain host-Node test runner cannot replace this environment for browser, renderer and native integration behavior.

## Prerequisites and focused commands

Complete the [source build](../operations/build-and-dependencies.md), including `electron:node_headers`, before running native-fixture tests. Scripts expect a configured `src/out/<name>` next to the Electron repository. Select a nondefault configuration with `ELECTRON_OUT_DIR`; otherwise discovery searches Testing, Release, Default and Debug.

From the **Electron Git root**, use:

```sh
npm run test -- -g 'ipc'
npm run test -- --files spec/api-context-bridge-spec.ts
npm run lint:js
npm run create-typescript-definitions
```

`-g` filters Mocha test titles. `--files` selects paths relative to the Electron root (or absolute paths); the spec app fails if explicit file selection matches nothing. `npm run test` also executes its `pretest` definition-generation step, so a failure before Mocha starts may be a documentation/type problem.

| Changed behavior | Representative regression surface |
| --- | --- |
| Startup, exit, package metadata | `spec/api-app-spec.ts`, `spec/esm-spec.ts` |
| IPC scopes, invoke errors, transferred ports | `spec/api-ipc-spec.ts`, `spec/api-ipc-main-spec.ts` |
| Preload bridge behavior | `spec/api-context-bridge-spec.ts` |
| Window closing, navigation, view ownership | `spec/api-browser-window-spec.ts`, `spec/api-web-contents-spec.ts`, `spec/api-web-contents-view-spec.ts` |
| Storage, protocol and network policy | `spec/api-session-spec.ts`, `spec/api-net-session-spec.ts`, `spec/api-protocol-spec.ts` |
| Utility Node lifecycle | `spec/api-utility-process-spec.ts` |
| Archive adaptation and integrity | `spec/asar-spec.ts`, `spec/asar-integrity-spec.ts` |

Prefer a regression that checks the externally visible boundary, including failure/cancellation/destruction, rather than one that only repeats implementation steps.

## What the runner prepares

`script/spec-runner.js` hashes the spec manifest, lockfile, runner source and installed dependency tree. When those hashes differ, it reinstalls spec modules with pinned Yarn and `--frozen-lockfile`; the reinstall removes the existing spec node_modules directory. For local builds it sets `npm_config_nodedir` to the chosen build's generated Node headers. The spec manifest includes native fixture packages that depend on this matching runtime ABI.

The runner supports `--electronVersion` for obtaining a published runtime through Fiddle's installer. That path prepares headers for the selected released version; it does not run a freshly edited native implementation. Without that option it resolves the local executable. On Linux, launch passes through `script/dbus_mock.py`. Unknown runner arguments are forwarded to the spec app.

## Inside the spec application

`spec/package.json` points to `spec/index.js`. Before readiness that initializer configures fake media devices, test host mappings, garbage-collection flags and privileged schemes. It prevents default quit-on-last-window behavior. After readiness it registers ts-node, configures Mocha, loads sorted `*-spec.ts/js` files and runs the suite.

The runner checks `spec/disabled-tests.json` by full test title. CI forbids `.only` and enables three retries. Environment variables control reporter, timeout, grep and sharding selection; CLI grep takes precedence when supplied. Deferred cleanup runs in reverse order before ordinary afterEach hooks, making ownership cleanup a meaningful part of test design.

On normal completion the app exits with the Mocha failure count. Forced-exit mode prints a failure marker before killing the process, which the outer runner uses to recover the result. Unexpected exceptions in the main spec runner terminate with failure rather than displaying the application's normal error dialog. The CI test workflow shards file lists and wraps Linux tests with Xvfb and its environment setup.

## Node embedding and types

For Node embedding changes, use the dependency's Node tests through the repository wrapper:

```sh
node script/node-spec-runner.js parallel/test-crypto-keygen
node script/node-spec-runner.js --default
```

The wrapper runs Node's `tools/test.py` in `third_party/electron_node`, passing the Electron executable as the shell and setting `ELECTRON_RUN_AS_NODE` plus the eager-ASAR testing hook. Its `--default` preset supplies skip-list and flakiness settings from `script/node-disabled-tests.json`; custom arguments follow a different option-building path. Inspect the test runner output and status when evaluating failures.

Public types are generated from API documentation, then `spec/ts-smoke/runner.js` compiles the smoke project. `npm run lint:docs` is broader and includes formatting/fixing, examples, links, API history and type generation. Use it as the contributor documentation workflow, not as a read-only probe. The [API extension workflow](../workflows/extending-electron-api.md) explains the production chain.

## Debugging the right layer

For a focused runtime run, append `--enable-logging` alongside the grep/file filter. Trace native failures with Chromium logging/stack traces and a symbol-bearing build. The [debugging guide](../../docs/development/debugging.md) and its platform links cover debugger setup and symbol servers. Distinguish environment setup errors from assertion failures, and preserve the failing process's output and termination signal.

The commands here are documented contributor procedures. Wiki generation checks source evidence and documentation structure; it does not establish that Electron's native build or test suites passed in this workspace.
