---
type: guide
title: Repository quickstart
description: Contributor entrypoint for Electron framework source, with build prerequisites, focused validation commands, and a task-routing map across runtime and maintenance systems.
tags: [quickstart, electron, architecture, development]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:40:08.980Z
sources:
  - id: openwiki-source-b55c1369c4912b5d57b1a8f8
    resource: repo://docs/development/build-instructions-gn.md
  - id: openwiki-source-0ac207f83d59c73dbe96c965
    resource: repo://docs/development/testing.md
  - id: openwiki-source-85151ea4a0ecb0d852396c8e
    resource: repo://lib/browser/init.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
  - id: openwiki-source-4833b66ebbc1ab1c287cbd47
    resource: repo://script/create-api-json.mjs
  - id: openwiki-source-890aa2f7845d954a96cefaac
    resource: repo://script/start.js
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
  - id: openwiki-source-4c88e92b4d450d55be24a1a1
    resource: repo://spec/package.json
generated: { by: "codex", at: "2026-11-16T08:40:08.980Z" }
---

# Repository quickstart

This repository implements Electron, the desktop framework that combines Chromium and Node.js. Its core is native C++/Objective-C++ under shell with JavaScript/TypeScript initialization and API wrappers under lib. The wiki explains how those layers interact; docs/api and docs/tutorial remain the detailed public API and application guides.

## Choose your starting workflow

For an application using prebuilt Electron, the [README](../README.md) documents:

```sh
npm install electron --save-dev
```

For changes to Electron itself, use [Build Electron from source](workflows/build-electron.md). The full dependency checkout places this repository at src/electron under a Chromium src tree; GN and Ninja run from that parent src directory. DEPS controls the embedded dependency revisions and patch hooks. Installing JavaScript dependencies alone does not compile Electron.

After completing platform prerequisites and dependency synchronization, the normal testing build sequence from Chromium src is:

```sh
gn gen out/Testing --args='import("//electron/build/args/testing.gn")'
ninja -C out/Testing electron electron:node_headers
```

Then from src/electron:

```sh
npm start
npm run test -- -g 'ipc'
```

npm start launches the selected local build. The spec runner uses its own test application and dependencies; npm pretest generates public declarations and runs TypeScript smoke checks. See [Testing and API validation](testing/validation.md) for file selection, custom output directories, and Node integration coverage.

## Find the system behind a task

| Task or symptom | Start here |
| --- | --- |
| App entry fails, ready never arrives, or quitting behaves unexpectedly | [Process startup and application lifecycle](architecture/process-lifecycle.md) |
| Add an API, trace a linked binding, or investigate native desktop behavior | [API layers and desktop integration](architecture/api-layers.md) |
| Window ownership, navigation promises, child windows, or webview teardown | [Windows, WebContents, and guests](concepts/windows-and-web-contents.md) |
| Missing IPC handler, wrong receiving frame, failed invoke, or port transfer | [IPC routing and message ports](concepts/ipc.md) |
| Preload require fails, bridge conversion fails, or privileges differ | [Renderer sandbox, preloads, and context bridge](concepts/renderer-isolation.md) |
| Cookies, partition persistence, permissions, requests, or custom protocols | [Sessions, storage, permissions, and networking](concepts/sessions-and-networking.md) |
| Event-loop hangs, utility-process lifecycle, or archive-only failures | [Node embedding, utility processes, and ASAR](concepts/node-and-asar.md) |
| Configure a checkout, add a bundle dependency, or locate generated artifacts | [Build Electron](workflows/build-electron.md) |
| Roll Chromium/Node or revise an upstream patch | [Dependency updates and patch maintenance](workflows/dependency-patches.md) |
| Select tests, validate types, or understand docs-only CI | [Testing and API validation](testing/validation.md) |
| Runtime packaging, npm installation, releases, or application auto-updates | [Distribution and updates](operations/distribution.md) |

## Trace behavior across boundaries

A typical application begins in native executable entry code, reaches Chromium's browser client, creates the main Node environment, and loads lib/browser/init.ts before the application entry module. BrowserWindow then connects native window ownership to WebContents; its renderer gets a sandbox-selected initialization path and preloads. Renderer messages travel through native transport into scoped main-process handlers. Session/BrowserContext owns the relevant storage and network services.

For a behavior change, follow the public wrapper into its native binding and state owner, then inspect one representative caller and a focused spec. Platform behavior may be split between shared JavaScript policy and separate native implementations. Dependency patches can also define behavior that is invisible in lib or shell alone.

## Documentation and validation boundaries

The public API documentation feeds electron-api.json and generated TypeScript declarations, so an API-doc change can affect compilation. Preserve that pipeline when adding methods or changing signatures. The [API layer guide](architecture/api-layers.md) explains the extension path.

Commands here describe the checked-in workflows. Follow linked source and focused tests for exact semantics, and distinguish successful documentation generation from a successful native build or runtime test run. This wiki is a navigation and evidence aid, not a replacement for the full platform prerequisites or API reference.
