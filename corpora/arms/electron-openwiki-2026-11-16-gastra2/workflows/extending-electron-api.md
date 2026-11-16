---
type: workflow
title: Extending an Electron API
description: Connect an Electron API change across process exports, native binding registration, object lifetime, GN inputs, documentation-derived types and regression tests.
tags: [api, development, bindings, typescript, documentation]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:01:04.581Z
sources:
  - id: openwiki-source-ec2e5719a4f01093665ba043
    resource: repo://BUILD.gn
  - id: openwiki-source-e6a032917c6dd65e2c267f13
    resource: repo://docs/development/creating-api.md
  - id: openwiki-source-41867ed238aead8948b8c4fc
    resource: repo://lib/browser/api/exports/electron.ts
  - id: openwiki-source-406eca1c3eb099492f250e9f
    resource: repo://lib/browser/api/safe-storage.ts
  - id: openwiki-source-429e87f7c9d00abb42707b15
    resource: repo://lib/common/define-properties.ts
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-094b5a818bbd2984ab827a19
    resource: repo://patches/node/fix_expose_the_built-in_electron_module_via_the_esm_loader.patch
  - id: openwiki-source-4833b66ebbc1ab1c287cbd47
    resource: repo://script/create-api-json.mjs
  - id: openwiki-source-0e4201c67cf80162df957f59
    resource: repo://script/gen-filenames.ts
  - id: openwiki-source-c6d02b9c68e4cb539973ebaa
    resource: repo://shell/browser/api/electron_api_safe_storage.cc
  - id: openwiki-source-1a6f8e7d7e3713a29fbed1d2
    resource: repo://shell/browser/api/electron_api_session.cc
  - id: openwiki-source-9969464afecae1e67ad6d267
    resource: repo://shell/browser/api/electron_api_session.h
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-d8d3f0fc26fba6d586fcac90
    resource: repo://spec/modules-spec.ts
  - id: openwiki-source-0f529756516b7814efa5b38b
    resource: repo://spec/ts-smoke/runner.js
  - id: openwiki-source-0a3d5c576a42616c3417b0ca
    resource: repo://typings/internal-ambient.d.ts
generated: { by: "codex", at: "2026-11-16T18:01:04.581Z" }
---

# Extending an Electron API

An Electron API spans more than a native method or a TypeScript export. A complete change connects the public module, the process that owns it, native registration when needed, build inputs, documentation-derived types and observable behavior. Start from a neighboring API with similar ownership and lifetime requirements.

## Select the execution boundary

Decide whether the feature belongs to the browser, renderer, common or utility surface. Browser APIs typically own desktop/Chromium objects; renderer APIs operate in a web frame or expose controlled bridges; utility exports are a narrower Node-service surface. Adding an export to one process does not automatically make its native binding available in another.

`lib/browser/api/exports/electron.ts` combines common and browser module lists using `defineProperties`. Those lists supply getter-backed loaders. A wrapper can be as small as `lib/browser/api/safe-storage.ts`, which returns a linked binding, or it can implement validation, event adaptation and promise behavior as the session and utility wrappers do.

For cross-process features, first define sender identity, serialization and response/error behavior using the [IPC architecture](../architecture/ipc-and-message-ports.md). For page-facing capabilities, include the [preload and context-bridge boundary](../concepts/renderer-security.md) in the design.

## Native implementation and lifetime

For a new native binding, export the required methods or constructor from its initialization function and register it with `NODE_LINKED_BINDING_CONTEXT_AWARE`. Add its name to the appropriate `ELECTRON_*_BINDINGS` macro in `shell/common/node_bindings.cc`. `RegisterBuiltinBindings` invokes browser/renderer/utility registrations conditionally and common registrations across those Node environments.

The simple safeStorage binding exports methods directly through `gin_helper::Dictionary`. Stateful objects need a matching wrapper and ownership model. Session, for example, derives from `gin::Wrappable`, traces cached V8 references, uses a weak-cell factory and holds a self-keepalive; its disposal hook clears that lifetime state before the microtask runner disappears. Do not infer a new object's lifetime from JavaScript reachability alone.

The existing [API creation guide](../../docs/development/creating-api.md) is a useful checklist, but some sample macro and wrapper names differ from current implementations. Follow live neighboring code for the exact registration macro and garbage-collection conventions. Specify readiness checks, thread affinity, destruction behavior and callback cancellation as part of the feature's contract.

## Connect exports, types and build inputs

1. Add the wrapper to the appropriate `lib/<process>/api/module-list.ts`, keeping the public module list ordered. Confirm that each intended environment has the required implementation and binding.
2. Add or update `_linkedBinding` declarations in `typings/internal-ambient.d.ts` and internal interfaces in `typings/internal-electron.d.ts` as needed. These describe private implementation contracts, distinct from public application types.
3. Add native source/header files to the appropriate shared or platform-specific lists in `filenames.gni`. GN needs explicit native source membership.
4. Write or update `docs/api/` documentation, including platform/process restrictions, events, error cases and associated structures. Public `electron.d.ts` is generated from this documentation.
5. Regenerate `filenames.auto.gni` with the repository's `script/gen-filenames.ts` tooling when adding documentation or changing bundle dependency membership. It measures webpack graphs and enumerates API docs/typings; it is not a hand-maintained list.

The documentation pipeline is concrete: `script/create-api-json.mjs` parses repository docs into `electron-api.json`; `create-typescript-definitions` generates declarations and invokes TypeScript smoke checks. GN's `build_electron_definitions` copies the result into the generated typings directory, and the process bundles depend on that target. A documentation signature error can therefore fail a native build before compilation reaches the implementation.

## Validate the complete surface

Run `npm run create-typescript-definitions`, the relevant language checks, and a focused runtime spec after rebuilding changed native code. Use the [contributor validation page](../testing/contributor-validation.md) for commands and fixtures. Exercise the supported process, readiness and lifecycle boundaries, including rejection after destruction where relevant.

For a new export, also check CommonJS/ESM parity. `spec/modules-spec.ts` compares exports from both loading modes, and Electron's Node patch for the ESM loader derives named exports from the loaded module. This is a better regression target than relying on a stale comment about an export-key file.

For platform-specific behavior, use neighboring platform-gated tests and test both the supported path and documented unsupported behavior. For upstream changes, follow [dependency patch maintenance](../operations/build-and-dependencies.md#upstream-patch-lifecycle) so the tested native change survives a fresh sync. [Runtime startup](../architecture/runtime-startup.md) explains when wrappers and environments become usable.
