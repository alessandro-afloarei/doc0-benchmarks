---
type: quickstart
title: Contributor quickstart
description: Start contributing to Electron with the correct source checkout, local runtime and test commands, and a task-based map of the repository.
tags: [quickstart, contributors, navigation, build, testing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:11:18.304Z
sources:
  - id: openwiki-source-7c03237a6b57ffb3e526a51b
    resource: repo://.nvmrc
  - id: openwiki-source-29cf14000ac0366c40fd5358
    resource: repo://DEPS
  - id: openwiki-source-b55c1369c4912b5d57b1a8f8
    resource: repo://docs/development/build-instructions-gn.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-1e59d294433f0c981874804a
    resource: repo://script/lib/utils.js
  - id: openwiki-source-b63413b6df1236d7411a0cbc
    resource: repo://script/spec-runner.js
  - id: openwiki-source-890aa2f7845d954a96cefaac
    resource: repo://script/start.js
  - id: openwiki-source-4c88e92b4d450d55be24a1a1
    resource: repo://spec/package.json
generated: { by: "codex", at: "2026-11-16T07:11:18.304Z" }
---

# Contributor quickstart

This repository implements Electron: native Chromium/Node integration, JavaScript-facing APIs, platform desktop behavior, packaging, and tests. Use this wiki to locate the owner and execution flow for a change, then check the linked source and focused tests.

## Choose your starting point

For an application that consumes a released Electron binary, install Electron in that application's directory:

```sh
npm install electron --save-dev
```

Continue with [installation](../docs/tutorial/installation.md) and the existing [tutorial documentation](../docs/README.md). Contributing to this runtime requires a source build with the surrounding Chromium workspace.

For framework work, begin with [the build guide](../docs/development/build-instructions-gn.md) and your platform's prerequisites. The expected layout puts this repository at `<workspace>/src/electron`, Chromium at `<workspace>/src`, and Node at `src/third_party/electron_node`. The `.nvmrc` requests Node 20 for repository tooling; this is distinct from the embedded Node revision pinned in DEPS.

A manual fresh checkout uses depot_tools:

```sh
mkdir electron-workspace
cd electron-workspace
gclient config --name "src/electron" --unmanaged https://github.com/electron/electron
gclient sync --with_branch_heads --with_tags
```

The dependency hooks apply upstream patches and install frozen Yarn dependencies. A standalone clone can be inspected, but it does not supply the surrounding dependency repositories or build output.

## Build, launch, and verify a local runtime

After completing platform setup, run these commands from the Chromium `src` directory on Linux or macOS:

```sh
export CHROMIUM_BUILDTOOLS_PATH="$PWD/buildtools"
gn gen out/Testing --args='import("//electron/build/args/testing.gn")'
ninja -C out/Testing electron
```

Use the build guide for Windows environment and quoting syntax. Then switch to the Electron repository for npm commands:

```sh
cd electron
npm start
npm run test -- --files spec/api-ipc-spec.ts
```

`npm start` launches the existing local executable through `script/start.js`; it does not compile it. The helper resolves binaries beneath the parent directory's `out`. Set `ELECTRON_OUT_DIR` to an existing configuration name when needed. Without it, selection tries Testing, Release, Default, then Debug.

The API suite is itself an Electron application. Its runner prepares separate spec dependencies, including native fixtures. The npm pretest hook generates public declarations and runs declaration smoke checks. A setup failure before Mocha begins is therefore different from a failing API case.

## Find the relevant system

| Task or symptom | Start here |
| --- | --- |
| Entry script, app readiness, event loops, utility lifecycle | [Runtime architecture and bootstrap](architecture/runtime-and-bootstrap.md) |
| Window close, page lifetime, load promises, window.open | [Windows, WebContents, and navigation](architecture/windows-and-navigation.md) |
| Preload loading, renderer privileges, contextBridge, invoke routing | [Preload isolation and IPC](concepts/preload-isolation-and-ipc.md) |
| Shared cookies, persistent partitions, custom schemes, fetch, permissions | [Sessions, storage, and networking](concepts/sessions-and-networking.md) |
| Packaged file lookup, native modules, archive extraction | [ASAR and module loading](concepts/asar-and-module-loading.md) |
| New native API, exports, generated declarations | [Extending Electron APIs](workflows/extending-electron-apis.md) |
| Checkout synchronization, GN, webpack, upstream patches | [Building and upstream dependencies](operations/build-and-upstream-dependencies.md) |
| Binary archives, npm installation, fuses, updates, release stages | [Distribution and release](operations/distribution-and-release.md) |
| Test selection, fixtures, CI, Node smoke tests, failures | [Runtime and API testing](testing/runtime-and-api-tests.md) |

## Source landmarks and contribution flow

`shell/` owns native process integration and platform APIs. `lib/` initializes process environments and wraps native bindings. `BUILD.gn`, `build/`, and the filename lists connect those layers into the executable. `spec/` exercises observable runtime behavior. `docs/api/` is also input to public declaration generation, so documentation changes can change the type surface.

For an implementation change, follow the public call through its TypeScript wrapper, linked native owner, and any renderer/browser boundary. Inspect neighboring failure and cleanup paths, rebuild the affected runtime, and run the smallest relevant test group. API additions usually also need documentation, build registration, internal typing, and generated dependency lists.

The [contributing guide](../CONTRIBUTING.md) and [development documentation](../docs/development/README.md) describe pull requests, coding style, debugging, and dependency policies. Use `npm run lint:js`, `lint:cpp`, or other focused root scripts as appropriate. `npm run lint:docs` includes formatting and generated-definition steps and can rewrite documentation.

Repository source and tests remain the authority when investigating a behavior. The wiki connects systems and workflows; the linked API and platform guides supply detailed contracts and environment setup.
