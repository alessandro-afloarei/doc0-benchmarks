---
type: overview
title: Electron Quickstart and Task Map
description: Entry point for the Electron source repository - what it is, how the code is laid out, how processes and layers fit together, and which wiki page to read for each kind of task (startup, IPC, renderer, windows, network, build, patches, tests, release).
tags: [overview, quickstart, electron, task-map]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-f46d5bad520e315f61552c31
    resource: repo://build/args/all.gn
  - id: openwiki-source-cd0201cca1cac030ad487fa2
    resource: repo://docs/development/source-code-directory-structure.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Electron Quickstart and Task Map

This repository is **Electron itself** (the framework that lets apps be built with JavaScript, HTML and CSS on Chromium and Node.js), not an app that uses it. It is designed to live at `src/electron` inside a Chromium checkout and is compiled with GN/ninja; it is not built with a stand-alone `npm install`. The root `package.json` (`electron`, version `0.0.0-development`) only carries dev tooling for docs, linting, typings and release scripts.

## How it fits together

- **C++ shell (`shell/`)** implements Chromium's content-API embedder: `app/` (entry points, `ElectronMainDelegate`), `browser/` (main process: windows, sessions, `api/` bindings, native UI per platform), `renderer/` (renderer clients, preload and context-bridge support), `common/` (Node bindings, gin helpers, ASAR, shared utilities), `services/node` and `utility/` (utility processes).
- **TypeScript (`lib/`)** is bundled by webpack per process type (`browser`, `renderer`, `sandboxed_renderer`, `isolated_renderer`, `worker`, `node`, `utility`, `preload_realm`), embedded into the binary, and exposes the `electron` module. `lib/browser/api` mirrors the main-process modules.
- **Node.js and Chromium are patched, not forked**: `patches/` holds ordered patch series for Chromium, Node, V8 and others, applied after `gclient sync` (`DEPS` pins versions). `chromium_src/` builds some unmodified Chrome-layer files.
- **Docs are the API source of truth**: `docs/api/*.md` generates `electron.d.ts`; `docs/tutorial` and `docs/development` hold guides.
- **Tests (`spec/`)** are mocha integration tests that run inside a built Electron; `script/` has the runners, lint, patch, and release tooling. `default_app/` is the app run when none is supplied, and `npm/` is the published downloader package.
- Other top-level: `build/` (GN args, webpack configs, fuses), `buildflags/`, `typings/`, `filenames*.gni` (source lists).

Process model in one paragraph: one executable serves every process type; `main()` either runs plain Node (`ELECTRON_RUN_AS_NODE`, gated by a fuse) or `content::ContentMain` with `ElectronMainDelegate`. The browser (main) process embeds Node into Chromium's UI thread, runs `lib/browser/init.ts`, then the app's main script. Renderers run Blink and, per `webPreferences`, either a full Node environment or a sandboxed preload bundle, optionally in an isolated world bridged by `contextBridge`. Renderer-to-main messages travel over Mojo to a per-session JS dispatcher.

## Where to read for each task

| If you need to... | Read |
| --- | --- |
<!-- openwiki: broken internal link [/openwiki/architecture/process-model.md] link "/openwiki/architecture/process-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Understand startup, process types, `BrowserMainParts`, quit/exit | [Process model and startup](/openwiki/architecture/process-model.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/node-chromium-integration.md] link "/openwiki/architecture/node-chromium-integration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Debug timers/microtasks, `setImmediate` stalls, how Node runs in the main process | [Node and Chromium event loop integration](/openwiki/architecture/node-chromium-integration.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/js-bundles-and-internal-modules.md] link "/openwiki/architecture/js-bundles-and-internal-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Change anything under `lib/`, add a module to `electron`, or see how JS is bundled | [JS bundles and internal modules](/openwiki/architecture/js-bundles-and-internal-modules.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/native-api-bindings.md] link "/openwiki/architecture/native-api-bindings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Add or change a native API (gin, `TrackableObject`, bindings, converters) | [Native API bindings](/openwiki/architecture/native-api-bindings.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/ipc.md] link "/openwiki/architecture/ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Work on `ipcMain`/`ipcRenderer`, `MessagePort`, internal channels | [IPC](/openwiki/architecture/ipc.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/renderer-preload-and-isolation.md] link "/openwiki/architecture/renderer-preload-and-isolation.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Change preload, sandbox, `nodeIntegration`, `contextBridge`, or workers | [Renderer, preload and isolation](/openwiki/architecture/renderer-preload-and-isolation.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/web-contents-and-windows.md] link "/openwiki/architecture/web-contents-and-windows.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Work on `BrowserWindow`, `WebContents`, views, `window.open`, `<webview>` | [WebContents, windows and views](/openwiki/architecture/web-contents-and-windows.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/sessions-protocols-and-network.md] link "/openwiki/architecture/sessions-protocols-and-network.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Work on sessions, protocols, `webRequest`, `net`, permissions, downloads | [Sessions, protocols, network and permissions](/openwiki/architecture/sessions-protocols-and-network.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/utility-processes-and-asar.md] link "/openwiki/architecture/utility-processes-and-asar.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Work on `utilityProcess`, node-mode, ASAR or ASAR integrity | [Utility processes, Node service and ASAR](/openwiki/architecture/utility-processes-and-asar.md) |
<!-- openwiki: broken internal link [/openwiki/security/fuses-and-security-model.md] link "/openwiki/security/fuses-and-security-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Add or flip a fuse, or review security defaults and env/flag restrictions | [Fuses and security model](/openwiki/security/fuses-and-security-model.md) |
<!-- openwiki: broken internal link [/openwiki/build/build-system.md] link "/openwiki/build/build-system.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Compile Electron, edit `BUILD.gn`/`filenames.gni`, add build flags | [Build system](/openwiki/build/build-system.md) |
<!-- openwiki: broken internal link [/openwiki/build/upstream-patches.md] link "/openwiki/build/upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Modify or update patches to Chromium/Node/V8, or upgrade a dependency | [Upstream patch system](/openwiki/build/upstream-patches.md) |
<!-- openwiki: broken internal link [/openwiki/testing/spec-suite.md] link "/openwiki/testing/spec-suite.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Run or write tests, or use the Node/nan runners | [Testing: spec suite and runners](/openwiki/testing/spec-suite.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/docs-api-and-release.md] link "/openwiki/workflows/docs-api-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Edit API docs/typings, run lint, understand `default_app`, the npm package or release scripts | [API docs, linting and release tooling](/openwiki/workflows/docs-api-and-release.md) |

## Common first steps

1. **Orient in source.** Public API is documented in `docs/api/<module>.md`; its implementation is `lib/browser/api/<module>.ts` (or `lib/renderer/api`, `lib/common/api`) over `shell/browser/api/electron_api_<module>.cc`.
<!-- openwiki: broken internal link [/openwiki/architecture/native-api-bindings.md] link "/openwiki/architecture/native-api-bindings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
2. **Change C++.** Add new files to `filenames.gni`; follow the [native bindings](/openwiki/architecture/native-api-bindings.md) checklist for new APIs.
<!-- openwiki: broken internal link [/openwiki/architecture/js-bundles-and-internal-modules.md] link "/openwiki/architecture/js-bundles-and-internal-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
3. **Change JS.** Imports in `lib/` change bundle dependency lists; regenerate `filenames.auto.gni` with `script/gen-filenames.ts` (see [JS bundles](/openwiki/architecture/js-bundles-and-internal-modules.md)).
<!-- openwiki: broken internal link [/openwiki/build/build-system.md] link "/openwiki/build/build-system.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/testing/spec-suite.md] link "/openwiki/testing/spec-suite.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
4. **Build and test.** `gn gen out/Testing --args='import("//electron/build/args/testing.gn")'`, `ninja -C out/Testing electron`, then `npm test` (optionally `-- -g <pattern>`), per [build](/openwiki/build/build-system.md) and [testing](/openwiki/testing/spec-suite.md).
<!-- openwiki: broken internal link [/openwiki/workflows/docs-api-and-release.md] link "/openwiki/workflows/docs-api-and-release.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
5. **Before committing.** Lint-staged hooks run lint, `gen-filenames`, GN format and patch checks; docs changes need `npm run lint:docs` ([workflows](/openwiki/workflows/docs-api-and-release.md)).

## Conventions worth knowing

- C++ and Python follow Chromium style; JS/TS uses standard-style ESLint. Every patch needs a justification in its commit message.
- Never edit applied upstream sources without exporting the change as a patch.
- App-visible behavior changes belong in `docs/breaking-changes.md` and in API history blocks.
- Security-sensitive features should consider fuse gating and secure defaults (sandbox and `contextIsolation` are on by default).
