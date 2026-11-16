---
type: quickstart
title: Electron repository quickstart
description: Start here to navigate Electron's runtime architecture, build and test the framework, or trace a contributor change across native code, JavaScript and public APIs.
tags: [quickstart, electron, architecture, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-b55c1369c4912b5d57b1a8f8
    resource: repo://docs/development/build-instructions-gn.md
  - id: openwiki-source-d80250c29d7bf31d2f7121c4
    resource: repo://lib/browser/api/session.ts
  - id: openwiki-source-fba9e7e3e57c0a479bdd26b5
    resource: repo://npm/package.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-4833b66ebbc1ab1c287cbd47
    resource: repo://script/create-api-json.mjs
  - id: openwiki-source-1e59d294433f0c981874804a
    resource: repo://script/lib/utils.js
  - id: openwiki-source-b63413b6df1236d7411a0cbc
    resource: repo://script/spec-runner.js
  - id: openwiki-source-890aa2f7845d954a96cefaac
    resource: repo://script/start.js
  - id: openwiki-source-1a6f8e7d7e3713a29fbed1d2
    resource: repo://shell/browser/api/electron_api_session.cc
  - id: openwiki-source-a7812b9989726197c70b9034
    resource: repo://shell/browser/electron_browser_context.cc
  - id: openwiki-source-141ce8f9fd4f733f5b609f8e
    resource: repo://spec/index.js
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# Electron repository quickstart

This repository implements Electron, the desktop runtime combining Chromium and Node.js. Its native shell, process-specific JavaScript, dependency patches and API documentation together define the framework. This wiki explains those implementation relationships and routes contributor tasks to the right subsystem; the existing [API reference](../docs/api/) and [tutorials](../docs/tutorial/) describe application-facing usage.

## Choose your task

| Task or symptom | Start here | What the page connects |
| --- | --- | --- |
| App entry fails, readiness is surprising, or shutdown hangs | [Runtime startup](architecture/runtime-startup.md) | Native entry → Node bootstrap → application loading → ordered teardown |
| A window closes incorrectly, a load aborts, or a popup behaves unexpectedly | [Windows and web contents](architecture/windows-and-web-contents.md) | Native window, view/page ownership, navigation promises and guest policies |
| IPC reaches the wrong handler or a transferred port stops working | [IPC and message ports](architecture/ipc-and-message-ports.md) | Native transport, frame/WebContents/global dispatch and endpoint lifetime |
| A preload cannot require a module or bridge behavior differs | [Renderer security](concepts/renderer-security.md) | Sandbox, Node integration, isolated worlds, preload paths and bridge rules |
| Cookies, storage, protocols or permissions apply to the wrong page | [Sessions and networking](concepts/sessions-and-networking.md) | Browser-context identity, persistence and session-specific routing |
| A background Node task crashes, loses messages or uses unexpected network state | [Utility processes](architecture/utility-processes.md) | Service launch, parent ports, networking and termination |
| An application works unpacked but fails from an archive | [ASAR and application loading](concepts/asar-and-application-loading.md) | Package lookup, virtual fs, extraction and integrity checks |
| Set up compilation or update Chromium/Node | [Build and dependencies](operations/build-and-dependencies.md) | gclient layout, GN/Ninja, embedded bundles and patch series |
| Add or change a public API | [API extension workflow](workflows/extending-electron-api.md) | Wrappers, native registration, ownership, docs-derived types and tests |
| Reproduce a regression or choose validation | [Contributor tests and debugging](testing/contributor-validation.md) | Test app, native fixtures, focused filters, Node smoke tests and symbols |
| Diagnose binary installation, release stages or application updating | [Distribution and release](operations/distribution-and-release.md) | GN artifacts, npm downloader, release checks and platform updaters |

## First contributor build and test

The supported manual layout places this repository at `<checkout>/src/electron`, with Chromium in `<checkout>/src`. A standalone Git clone does not include that dependency tree. Follow the [platform prerequisites and checkout steps](operations/build-and-dependencies.md#checkout-and-build-entry-points) first.

In a configured checkout, these POSIX-shell commands run from **Chromium `src`**:

```sh
export CHROMIUM_BUILDTOOLS_PATH="$PWD/buildtools"
gn gen out/Testing --args='import("//electron/build/args/testing.gn")'
ninja -C out/Testing electron
ninja -C out/Testing electron:node_headers
```

Then run contributor commands from the **Electron Git root** (`src/electron`):

```sh
npm start
npm run test -- -g 'ipc'
npm run test -- --files spec/api-context-bridge-spec.ts
```

`npm start` resolves and launches the local build. `npm test` first generates public TypeScript definitions and then runs the Electron spec app; spec dependencies include native fixtures built against matching headers. Use `ELECTRON_OUT_DIR` for a selected output configuration. The current helper otherwise searches Testing, Release, Default and Debug in that order.

If your purpose is to build an application with a prebuilt runtime, the repository README instead documents `npm install electron --save-dev` in that application's project. That install invokes the published binary downloader, not this native source build.

## Read a feature across the layers

Use the public API name to locate its wrapper in `lib/<process>/api/`, then follow `_linkedBinding` into `shell/<process>/api/`. Check the native registration in `shell/common/node_bindings.cc`, the owning Chromium object or platform implementation, and the relevant `spec/api-*-spec.ts`. A small wrapper can hide substantial native ownership and failure behavior.

| Layer | Source entry | Why it matters |
| --- | --- | --- |
| Native process setup | `shell/app/`, `shell/browser/electron_browser_main_parts.cc` | Chooses process clients and orders runtime setup/teardown |
| Process JavaScript | `lib/browser/init.ts`, renderer/sandbox/utility initializers | Loads app/preload code and selects available APIs |
| Native API integration | `shell/browser/api/`, `shell/renderer/api/`, `shell/common/` | Bridges JavaScript to Chromium, Node and desktop facilities |
| Dependency customization | `DEPS`, `patches/config.json`, ordered `.patches` files | Explains behavior implemented outside this Git repository |
| Build graph | `BUILD.gn`, `filenames.gni`, generated `filenames.auto.gni` | Connects native sources and embedded JavaScript to artifacts |
| Public contracts | `docs/api/`, `script/create-api-json.mjs` | Documentation feeds generated application types |
| Regression evidence | `spec/index.js`, focused specs and fixtures | Verifies process, lifecycle and error boundaries |

For example, a session API change crosses the TypeScript wrapper, the native Session wrapper, the browser context that owns persistent services, and tests that create multiple partitions. A renderer-facing version additionally needs IPC routing and sender validation. Follow those relationships before deciding a change is confined to one file.

## Scope of evidence

These pages describe this checkout's source and link to representative tests. They do not assert current support policies for a different Electron release, successful local compilation, or passing runtime tests. Source and tests remain authoritative, especially where an older development guide differs from the implementation. Each generated page records repository-grounded evidence through OpenWiki; use the task map above to read only the relevant system.
