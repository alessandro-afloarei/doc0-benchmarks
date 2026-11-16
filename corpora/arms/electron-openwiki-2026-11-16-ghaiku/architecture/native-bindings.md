---
type: architecture
title: Native Bindings (gin_helper, gin_converters, shell/common/api)
description: How C++ code in shell/ exposes objects and functions to JavaScript. Covers the linked-binding registration that lib/ modules call through process._linkedBinding, the gin Wrappable and EventEmitter pattern, the gin_helper template and dictionary helpers, and the gin_converters that map C++ types to V8 values.
tags: [native-bindings, gin, gin-helper, gin-converters, v8, linked-binding, event-emitter]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T11:29:50.477Z
sources:
  - id: openwiki-source-40ae9731305a5602929dfc2b
    resource: repo://shell/browser/api/electron_api_app.cc
  - id: openwiki-source-5d71f103a5967d2d743c7271
    resource: repo://shell/browser/event_emitter_mixin.h
  - id: openwiki-source-ddbe2db84d8c5467f38feaad
    resource: repo://shell/common/api/electron_api_asar.cc
  - id: openwiki-source-07596f383af233feb5d3824c
    resource: repo://shell/common/gin_converters/blink_converter.h
  - id: openwiki-source-1a50f87b90a14b25ee3b687e
    resource: repo://shell/common/gin_converters/std_converter.h
  - id: openwiki-source-9b324c001bad4359533214c3
    resource: repo://shell/common/gin_helper/constructible.h
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
generated: { by: "claude-code", at: "2026-11-16T11:29:50.477Z" }
---

# Native Bindings (gin_helper, gin_converters, shell/common/api)

Electron's native layer is C++ built on Chromium's `gin` library and on Node.js's linked-binding mechanism. Code in `shell/` defines the objects that the JavaScript layer in `lib/` uses. This page covers the pieces that connect the two: how a binding is registered, how a C++ class becomes a JavaScript object, and how C++ values are converted to and from V8 values.

## Registration: linked bindings

A native module is registered with `NODE_LINKED_BINDING_CONTEXT_AWARE(<name>, Initialize)` in its `.cc` file. The name is then listed in a macro in `shell/common/node_bindings.cc`, which makes it reachable from JavaScript through `process._linkedBinding(<name>)`. For example:

- `shell/browser/api/electron_api_app.cc` ends with `NODE_LINKED_BINDING_CONTEXT_AWARE(electron_browser_app, Initialize)`. Its `Initialize` function sets `app` on the exports object to the `App` singleton.
- `ELECTRON_BROWSER_BINDINGS` in `shell/common/node_bindings.cc` (around line 53) lists `electron_browser_app` alongside the other browser bindings.
- `lib/browser/api/app.ts` calls `process._linkedBinding('electron_browser_app')` and wraps the methods it gets.

The repository has about 50 such registrations in `.cc` files, so the binding names are the contract between the two halves. Renaming one requires updating both the C++ registration and the `_linkedBinding` call.

## Wrapping C++ classes: gin::Wrappable and EventEmitterMixin

A C++ class exposed to JavaScript usually inherits `gin::Wrappable<T>` (or `gin_helper::Wrappable<T>`) and overrides `GetObjectTemplateBuilder`. The template builder attaches methods and properties to the JavaScript prototype. In `shell/browser/api/electron_api_app.cc` (around line 1728), `App::GetObjectTemplateBuilder` binds methods such as `quit`, `exit`, `getVersion`, and `whenReady` to the `Browser` singleton with `base::BindRepeating`, so the C++ methods are reached through a bound callback rather than a per-call lookup.

Events are added by inheriting from `gin_helper::EventEmitterMixin<T>`, which is defined in `shell/browser/event_emitter_mixin.h`. `App` and `Session` both do this (`shell/browser/api/electron_api_app.h`, `shell/browser/api/electron_api_session.h`). The mixin's `Emit` creates an `internal::Event`, dispatches it through `gin_helper::EmitEvent`, and returns whether the listener called `preventDefault()`. `gin_helper::EventEmitter<T>` in `shell/common/gin_helper/event_emitter.h` offers the same `Emit` and `EmitWithoutEvent` helpers as a `Wrappable` base. `Constructible<T>` (`shell/common/gin_helper/constructible.h`) checks for the mixin and inherits the event-emitter JavaScript prototype when a class has it.

Other helpers in `shell/common/gin_helper/`:

- `Constructible<T>` (`constructible.h`) supports `new Foo()` from JavaScript, as used by `Session`.
- `Destroyable` (`destroyable.h`) adds `destroy` and `isDestroyed` to a prototype. `CleanedUpAtExit` and `TrackableObjectBase` (`cleaned_up_at_exit.h`, `trackable_object.h`) track objects that must be cleaned up before the process exits.
- `Dictionary` (`dictionary.h`) is a typed wrapper over `gin::Dictionary` with `Get` and `Set` templates. It is used to read option objects and to build return values.
- `Arguments`, `ErrorThrower`, `Promise`, `Callback`, and `ReplyChannel` (`arguments.h`, `error_thrower.h`, `promise.h`, `callback.h`, `reply_channel.h`) handle argument parsing, JavaScript exceptions, promise results, callbacks, and IPC replies.

## Converting types: gin_converters

`shell/common/gin_converters/` holds the `gin::Converter<T>` specializations that map C++ types to V8 values and back. Examples:

- `base_converter.h` provides converters for `base::TerminationStatus` and `base::flat_set`.
- `std_converter.h` handles standard containers and strings (also used by `std::span` in other converters).
- `gfx_converter.cc`, `gurl_converter.h`, `file_path_converter.h`, `time_converter.cc`, and `guid_converter.h` convert geometry, URLs, paths, times, and GUIDs.
- `blink_converter.{h,cc}` converts `blink::CloneableMessage` and related Blink types. The IPC path depends on it (see [IPC Between Main, Renderer, and Utility Processes](ipc.md)).
- Feature-specific converters cover accelerators, extensions, file dialogs, frames, native windows, network, message boxes, service workers, and USB, HID, and serial device info.

## shell/common/api: shared bindings

`shell/common/api/` holds bindings used by more than one process. Examples:

- `electron_api_asar.cc` exposes an `asar.Archive` class whose methods (`stat`, `readdir`, `realpath`, `copyFileOut`, `getFileInfo`) back the `fs` wrapper described in [ASAR Archives and Module Loading](asar-and-module-loading.md).
- `electron_api_clipboard.cc`, `electron_api_native_image.cc`, `electron_api_net.cc`, `electron_api_url_loader.cc`, `electron_api_shell.cc`, and `electron_api_command_line.cc` provide the shared APIs behind `clipboard`, `nativeImage`, `net`, `shell`, and command-line handling.
- `api.mojom` defines the Mojo interfaces used across processes, and `electron_api_v8_util.cc` exposes V8 helper utilities.

## Renderer and browser bindings

`shell/renderer/api/` provides the renderer-side equivalents, such as `electron_api_ipc_renderer.cc` (IPC send, invoke, and sync), `electron_api_web_frame.cc`, `electron_api_web_utils.cc`, `electron_api_crash_reporter_renderer.cc`, and `electron_api_context_bridge.cc` for context isolation. `shell/browser/api/` holds the main-process APIs, one file per module, such as `electron_api_app.cc`, `electron_api_session.cc`, `electron_api_web_contents.cc`, `electron_api_tray.cc`, and `electron_api_menu.cc`.

## Invariants and failure behavior

- An object created in C++ and returned to JavaScript is owned by its wrapper. Lifetime-sensitive objects use `Destroyable` or `TrackableObject` so that teardown can be explicit.
- Argument-handling errors are reported through `ErrorThrower` (`shell/common/gin_helper/error_thrower.h`).

## Extension seams

- To add a native API, create `shell/<process>/api/electron_api_<name>.{h,cc}` with a `Wrappable` or a plain `Initialize` function, register the binding, and add a `lib/<process>/api/<name>.ts` wrapper. See [JavaScript API Layer](js-api-layer.md) for the JavaScript side.
- New argument or return types need a `gin::Converter` in `shell/common/gin_converters/` before the binding can use them.
- New shared types that cross processes go through `shell/common/api/api.mojom` and the Blink converters.

## Related pages

- [Browser Main Process](browser-main-process.md) describes the main-process objects these bindings expose.
- [JavaScript API Layer](js-api-layer.md) describes how the `lib/` modules call these bindings.
- [Architecture Overview](overview.md) gives the wider system context.

## Focused tests

- `spec/api-app-spec.ts`, `spec/api-session-spec.ts`, and `spec/api-web-contents-spec.ts` cover binding behavior through the public API.
- `spec/api-native-image-spec.ts` covers the native image binding.
