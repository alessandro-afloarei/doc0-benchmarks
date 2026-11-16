---
type: quickstart
title: Quickstart
description: Orientation for contributors to the Electron source repository — what the repo is, the mental model of its layers and processes, the essential build/test commands, and a task-routing map to the wiki pages covering architecture, systems, build, testing, workflows and releases.
tags: [quickstart, overview, onboarding, routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T08:25:33.723Z
sources:
  - id: openwiki-source-b55c1369c4912b5d57b1a8f8
    resource: repo://docs/development/build-instructions-gn.md
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-23775c3de52f3ab95a13cb8b
    resource: repo://README.md
generated: { by: "claude-code", at: "2026-11-16T08:25:33.723Z" }
---

# Quickstart

This repository is the source of **Electron**, a framework for building
desktop apps with JavaScript, HTML and CSS by embedding **Chromium** (via its
content API) and **Node.js** into one executable. It is not a standalone
project: it is checked out as `src/electron` inside a Chromium tree and built
with GN/ninja, with patches applied to Chromium, V8, Node and other
dependencies.

## Mental model in five sentences

1. One binary plays every role — main (browser) process, renderers, GPU,
   utility processes, and a plain Node mode — chosen at startup by
   `ElectronMainDelegate`.
2. The C++ layer in `shell/` implements Chromium embedder hooks and native
   APIs, exposed to JS as Node *linked bindings* (`process._linkedBinding`).
3. The TypeScript layer in `lib/` wraps those bindings into the public
   `electron` module and is bundled per process type with webpack, then
   compiled into the binary via js2c.
4. Main ↔ renderer communication is Mojo IPC with structured-clone payloads,
   routed through sessions, WebContents and frames; Electron's own features use
   the same pipes on internal channels.
5. Security posture comes from `webPreferences` (sandbox, context isolation,
   node integration), fuses flipped in the shipped binary, and permission /
   window-open / webview hooks in the main process.

## Essential commands

| Task | Command |
| --- | --- |
| Configure | `gn gen out/Testing --args='import("//electron/build/args/testing.gn")'` |
| Build | `ninja -C out/Testing electron` |
| Run tests | `npm run test` (filter: `npm run test -- -g ipc`) |
| Lint | `npm run lint` (subsets: `lint:js`, `lint:cpp`, `lint:docs`, …) |
| Regenerate typings | `npm run create-typescript-definitions` |
| Re-export patches | `script/git-export-patches -o <patch_dir>` from inside the patched checkout |

Most contributors use [`@electron/build-tools`](https://github.com/electron/build-tools)
(`e sync`, `e build`, `e test`) which wraps the same steps.

## Task routing

| I want to… | Start here |
| --- | --- |
| Understand where code lives | [Repository layout and layering](architecture/repository-layout.md) |
| Follow startup / app loading / quit | [Process model and main-process startup](architecture/process-model-and-startup.md) |
| Understand how `require('electron')` and native bindings work | [JS bundles, module lists and native bindings](architecture/js-bundles-and-native-bindings.md) |
| Work on preload, sandbox, contextBridge, workers | [Renderer processes, sandboxing and context isolation](architecture/renderer-processes-and-sandboxing.md) |
| Debug or extend IPC, `invoke`/`handle`, MessagePorts | [IPC between main and renderer](systems/ipc.md) |
| Change BrowserWindow / BaseWindow / WebContents / window.open | [Windows, views and WebContents](systems/windows-and-web-contents.md) |
| Touch `<webview>` | [The webview tag and guest views](systems/webview-guests.md) |
| Work on sessions, protocols, webRequest, `net`, permissions | [Sessions, protocols and networking](systems/sessions-protocols-and-networking.md) |
| Fix ASAR / packaged-app file access | [ASAR archive support](systems/asar-archives.md) |
| Work on `utilityProcess` | [Utility processes](systems/utility-process.md) |
| Add a fuse, build flag or feature default | [Fuses and build flags](systems/fuses-and-build-flags.md) |
| Build, change GN files, bump DEPS | [GN build, DEPS and build configuration](build/gn-build-and-deps.md) |
| Patch Chromium / Node / V8 | [Patching Chromium, Node and other dependencies](build/chromium-and-node-patches.md) |
| Write or run tests | [Testing: spec runner and test suites](testing/spec-runner.md) |
| Add or change a public API (code + docs + typings) | [Workflow: adding or changing an API](workflows/adding-an-api.md) |
| Understand releases and the npm package | [Releases and npm distribution](operations/release-and-npm-distribution.md) |

## Upstream docs in this repo

- `docs/development/` — build instructions per platform, coding style,
  debugging (`debugging.md`, `debugging-on-macos.md`,
  `debugging-on-windows.md`, symbol server, Xcode), patches, testing,
  `creating-api.md`, Chromium/V8 development notes.
- `docs/api/` — the public API reference and the source of `electron.d.ts`.
- `docs/breaking-changes.md` — planned and past breaking changes per major.
- `CONTRIBUTING.md`, `docs/development/pull-requests.md` — contribution
  process; PR descriptions feed release notes.

## Gotchas for newcomers

- Most main-process APIs only work after `app.whenReady()`, and
  `protocol.registerSchemesAsPrivileged` must run **before** ready.
- New C++ files must be added to `filenames.gni`; new TS files and API docs
  are picked up by regenerating `filenames.auto.gni` (pre-commit does it).
- Public typings come from Markdown in `docs/api/` — a doc formatting mistake
  is a typings bug.
- Changes to a patched upstream checkout are invisible to others until
  re-exported into `patches/`.
- Default security is not maximal everywhere: permission requests are granted
  unless the app installs a handler, and `nodeIntegration: true` disables the
  sandbox unless `sandbox: true` is explicit.
