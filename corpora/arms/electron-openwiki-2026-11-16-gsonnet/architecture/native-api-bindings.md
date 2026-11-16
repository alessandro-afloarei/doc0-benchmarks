---
type: architecture
title: Native API Bindings (gin_helper and shell/browser/api)
description: How Electron's C++ implementations are exposed to JavaScript as linked Node bindings, using gin wrappables, TrackableObject weak maps, EventEmitter helpers, converters, and per-process binding registries; includes the checklist for adding a new API.
tags: [gin, v8, bindings, native, wrappable, architecture]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:55:01.404Z
sources:
  - id: openwiki-source-e6a032917c6dd65e2c267f13
    resource: repo://docs/development/creating-api.md
  - id: openwiki-source-85151ea4a0ecb0d852396c8e
    resource: repo://lib/browser/init.ts
  - id: openwiki-source-8a088ec85482661244e023a2
    resource: repo://shell/browser/api/electron_api_tray.cc
  - id: openwiki-source-8c64bb8d77dd4ff9bda2830e
    resource: repo://shell/common/gin_converters/callback_converter.h
  - id: openwiki-source-aed24065b862089af424817e
    resource: repo://shell/common/gin_helper/cleaned_up_at_exit.h
  - id: openwiki-source-af824dce8385ae94f3521a99
    resource: repo://shell/common/gin_helper/destroyable.cc
  - id: openwiki-source-82d45d7514103fe8e9439cca
    resource: repo://shell/common/gin_helper/event_emitter.h
  - id: openwiki-source-07ba4544daa27140abee0b72
    resource: repo://shell/common/gin_helper/trackable_object.h
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "claude-code", at: "2026-11-16T09:55:01.404Z" }
---

# Native API Bindings (gin_helper and shell/browser/api)

Most of Electron's public API has a C++ core in `shell/` and a thin TypeScript facade in `lib/`. The glue is a set of **linked Node bindings** (`electron_browser_*`, `electron_common_*`, `electron_renderer_*`, `electron_utility_*`) that TypeScript fetches with `process._linkedBinding('<name>')`. The C++ side is built on Chromium's `gin` plus Electron's own `gin_helper` layer.

## Registration and per-process visibility

- Each binding file ends with `NODE_LINKED_BINDING_CONTEXT_AWARE(<name>, Initialize)` (macro defined in `shell/common/node_includes.h`), and its `Initialize(exports, ...)` fills an exports dictionary, e.g. `electron_browser_tray` exports the `Tray` constructor (`shell/browser/api/electron_api_tray.cc`).
- Instead of static constructors, `shell/common/node_bindings.cc` lists binding names in four X-macros: `ELECTRON_BROWSER_BINDINGS`, `ELECTRON_COMMON_BINDINGS`, `ELECTRON_RENDERER_BINDINGS`, `ELECTRON_UTILITY_BINDINGS` (plus `ELECTRON_TESTING_BINDINGS`, only when `DCHECK_IS_ON()`). It forward-declares `_register_<name>()` for each and `NodeBindings::RegisterBuiltinBindings()` calls them explicitly, gated by process kind: browser bindings only in the browser process, common bindings everywhere, renderer bindings only in renderers, utility bindings only in utility processes.
- A few names appear in more than one list (for example `electron_browser_event_emitter` and `electron_common_net` are available to utility processes too).
- Because visibility is per process type, a renderer cannot reach `electron_browser_*` bindings even from internal code.

<!-- openwiki: broken internal link [/openwiki/architecture/js-bundles-and-internal-modules.md] link "/openwiki/architecture/js-bundles-and-internal-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
On the JS side the module wrapper in `lib/<process>/api/*.ts` typically re-exports or subclasses the native class and wires it into the lazily built `electron` module (see [JavaScript bundles](/openwiki/architecture/js-bundles-and-internal-modules.md)).

## Object model: Wrappable, TrackableObject, EventEmitter

- `gin_helper::Wrappable<T>` / `WrappableBase` (`shell/common/gin_helper/wrappable.*`) tie a C++ object to a V8 wrapper whose internal field 0 holds the native pointer. New classes describe their JS shape through `FillObjectTemplate(isolate, templ)` using `gin::ObjectTemplateBuilder` (`.SetMethod(...)`, `.SetProperty(...)`), as `Tray` does, and expose a constructor via `GetConstructor`.
- `gin_helper::EventEmitter<T>` (`shell/common/gin_helper/event_emitter.h`) lets C++ emit JS events on the wrapper. `Emit(name, args...)` creates a JS `Event` object as the first argument and returns whether `preventDefault()` was called; `EmitWithoutEvent` emits raw args. The JS prototype is made an `EventEmitter` at startup: `lib/browser/init.ts` calls `electron_browser_event_emitter.setEventEmitterPrototype(EventEmitter.prototype)`.
- `gin_helper::TrackableObject<T>` adds identity tracking for objects that other C++ code needs to look up from an ID or from a wrapped Chromium object. Each instance gets a monotonically increasing `weak_map_id`, is stored in a per-type `KeyWeakMap` (deliberately leaked), and can be found with `FromWeakMapID`, `FromWrappedClass` (via `SupportsUserData`), or listed with `GetAll`.
- `gin_helper::Destroyable` adds `destroy()` and `isDestroyed()` to a prototype. An object counts as destroyed when its internal field is empty or null; `destroy()` deletes the native object and nulls the pointer. `TrackableObject::MarkDestroyed()` clears the pointer and the weak callback.

## Lifetime and teardown

V8 owns the wrapper's lifetime through weak handles, but V8 does not run weak finalizers during isolate teardown. `CleanedUpAtExit` (`shell/common/gin_helper/cleaned_up_at_exit.h`) exists for exactly this: its instances are destroyed immediately before the V8 isolate is disposed, so native resources (windows, tray icons, sessions) are released deterministically at exit. Classes override `WillBeDestroyed()` (for example `Tray::WillBeDestroyed()` calls `ClearWeak()`). Native methods on objects that can outlive their resource guard with a check such as `Tray::CheckAlive()`, which throws `"Tray is destroyed"` through `ErrorThrower` instead of dereferencing a dead pointer.

## Converters

`shell/common/gin_converters/` holds `gin::Converter<T>` specializations that move values across the boundary: base types, `std::` and optional types, `GURL`, file paths, `gfx` geometry, `NativeImage`, accelerators, Blink and content types, frames, native windows, net types, and device-info types (HID/USB/serial). `callback_converter.h` converts `base::RepeatingCallback` to JS functions and back; the JS function created from a native callback is single-use, a deliberate guard against leaking `FunctionTemplate`s. Promises are built with `gin_helper::Promise` and `ErrorThrower` helpers.

## Adding a new API (checklist)

`docs/development/creating-api.md` is the guide; the steps in code terms are:

1. Add the `.cc`/`.h` files (and `_mac`, `_win`, `_linux` variants) to `filenames.gni`.
2. Write `docs/api/<name>.md`; the TypeScript definitions in `electron.d.ts` are generated from the docs, not hand-written.
3. Implement the class with `gin` wrappable machinery and `ObjectTemplateBuilder`, and register it with `NODE_LINKED_BINDING_CONTEXT_AWARE`.
4. Add the binding name to the right X-macro in `shell/common/node_bindings.cc` and a `_linkedBinding` overload to `typings/internal-ambient.d.ts`.
5. Add `lib/browser/api/<name>.ts` and a `{ name, loader }` entry to the module list (`lib/browser/api/module-list.ts`).

Note that the doc's example still uses `gin::DeprecatedWrappable`, whereas current code such as `Tray` uses `FillObjectTemplate` and `GetConstructor`; prefer copying a recent API from `shell/browser/api/`.

<!-- openwiki: broken internal link [/openwiki/architecture/web-contents-and-windows.md] link "/openwiki/architecture/web-contents-and-windows.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/js-bundles-and-internal-modules.md] link "/openwiki/architecture/js-bundles-and-internal-modules.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Related: [WebContents and windows](/openwiki/architecture/web-contents-and-windows.md), [JS bundles](/openwiki/architecture/js-bundles-and-internal-modules.md).
