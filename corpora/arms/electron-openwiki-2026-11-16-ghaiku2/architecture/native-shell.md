---
type: architecture
title: Native Shell (C++)
description: How Electron's C++ shell is organized across shell/app, shell/browser, shell/renderer, and shell/common, how native objects are exposed to JavaScript through gin wrappers and linked Node bindings, and how platform-specific UI and behavior are split by directory.
tags: [electron, c++, shell, gin, node-bindings, browser-process, renderer, chromium, platform]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:50:06.090Z
sources:
  - id: openwiki-source-06306918f0e6a90a63126d92
    resource: repo://filenames.gni
  - id: openwiki-source-7f3026761c06b71bedda7de1
    resource: repo://shell/app/electron_main_delegate.cc
  - id: openwiki-source-b3fce888fb7314f90ce04e64
    resource: repo://shell/browser/electron_browser_main_parts.cc
  - id: openwiki-source-488ecf3e360cb4fab31b09ac
    resource: repo://shell/common/api/electron_bindings.cc
  - id: openwiki-source-3a2d773f29b0bd5683de99b7
    resource: repo://shell/common/gin_converters/gurl_converter.h
  - id: openwiki-source-ae232ffd236dd3176309e3a2
    resource: repo://shell/common/gin_helper/object_template_builder.h
  - id: openwiki-source-7a563f98407b944e8311fdf4
    resource: repo://shell/common/node_bindings.cc
  - id: openwiki-source-8bebcb156457664da5a52d2e
    resource: repo://shell/renderer/api/electron_api_ipc_renderer.cc
generated: { by: "claude-code", at: "2026-11-16T18:50:06.090Z" }
---

# Native Shell (C++)

<!-- openwiki: broken internal link [/openwiki/architecture/javascript-api-layer.md] link "/openwiki/architecture/javascript-api-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
The C++ shell is the part of Electron that embeds Chromium's content layer and Node.js into one executable, and then exposes window, menu, session, network, and OS features to the JavaScript layer in `lib/`. This page maps the four C++ directories, explains how a native object becomes a JavaScript value, and points out where platform differences live. For the JavaScript side of the same boundary, see [JavaScript API Layer](/openwiki/architecture/javascript-api-layer.md).

## Directory responsibilities

- `shell/app/` is the process entry layer. `ElectronMainDelegate` in `electron_main_delegate.cc` implements Chromium's content main-delegate hooks: basic startup, sandbox initialization, browser-main pre-start, and creation of the content client and the browser, renderer, GPU, and utility client objects. Platform entry files `electron_main_linux.cc`, `electron_main_mac.cc`, and `electron_main_win.cc` supply the native `main`. `node_main.cc` provides the Node entry used for the Node-only process type. `BRANDING.json` supplies application branding strings.
- `shell/browser/` is the browser process: windows, the main-process API implementations, networking, extensions, notifications, printing, and the device APIs (`bluetooth`, `hid`, `serial`, `usb`). Its top-level files include `electron_browser_main_parts.cc`, which owns the browser-process lifecycle, `electron_browser_client.cc`, which implements Chromium's browser-side client interface, and `electron_browser_context.cc`, which holds per-session state.
- `shell/renderer/` is the renderer side. It includes `electron_renderer_client.cc` and `renderer_client_base.cc`, the preload realm context (`preload_realm_context.cc`), the sandboxed-renderer client, and the renderer API implementations under `api/`, such as the IPC bridge and `context_bridge`.
- `shell/common/` is code shared by processes. It contains `node_bindings.cc` and `electron_bindings.cc`, the `gin_helper/` and `gin_converters/` wrapper libraries, the `asar/` archive support, and the common API implementations in `api/`.
- `shell/services/`, `shell/utility/`, and `shell/browser/lib/` hold the utility-process and service support code.

## How a native object reaches JavaScript

Two mechanisms carry values across the boundary. Both are used throughout `shell/`.

1. **Gin wrappers for classes.** A native class derives from `gin_helper::Wrappable` (`shell/common/gin_helper/wrappable.h`) or `gin::Wrappable`, and exposes members through a `gin_helper::ObjectTemplateBuilder` (`object_template_builder.h`), which adds methods, properties, and accessors to a V8 object template. Event-emitting objects use `gin_helper/event_emitter.h`, so their `on`, `once`, and `emit` behavior is shared. Lifetime is managed by `gin_helper/destroyable.h` and `trackable_object.h`, which let a native object be destroyed when its JavaScript wrapper is collected or when its owner is destroyed.
2. **Converters for values.** `shell/common/gin_converters/` holds one converter per type. Examples include `file_path_converter.h`, `gurl_converter.h`, `gfx_converter.cc` for geometry types, `image_converter.cc`, `value_converter.cc` for base values, and `callback_converter.h`. Converters for Chromium-specific or platform types live alongside them, such as `native_window_converter.h`, `usb_device_info_converter.h`, and `hid_device_info_converter.h`. Argument decoding in the native method goes through `gin_helper/arguments.h` and `gin_helper/dictionary.h`, and promise results go through `gin_helper/promise.h`.

When JavaScript calls a method, the template dispatches to the native member function, and the converters decode the arguments. `gin_helper/error_thrower.h` provides the helper that native code uses to report such errors back to JavaScript as thrown exceptions.

## Linked Node bindings

Native modules are registered into Node's built-in namespace rather than through `require` on a file. Each native module defines a context-aware linked binding with the `NODE_LINKED_BINDING_CONTEXT_AWARE` macro. Examples include `electron_browser_view` in `shell/browser/api/electron_api_view.cc`, `electron_browser_crash_reporter` in `electron_api_crash_reporter.cc`, and `electron_renderer_ipc` in `shell/renderer/api/electron_api_ipc_renderer.cc`. About 52 files under `shell/` use the macro.

`shell/common/node_bindings.cc` names every binding in per-process lists. `ELECTRON_BROWSER_BINDINGS` (around line 53) lists the main-process modules. `ELECTRON_COMMON_BINDINGS` (around line 89) lists shared ones such as `electron_common_asar`, `electron_common_clipboard`, and `electron_common_shell`. `ELECTRON_RENDERER_BINDINGS` (around line 100) and `ELECTRON_UTILITY_BINDINGS` (around line 107) cover the renderer and utility processes, and `ELECTRON_TESTING_BINDINGS` covers test-only bindings. Each list is expanded with a `V` macro to declare and then register the `_register_<name>` function. A binding must appear in the list of the process type that uses it, or the JavaScript side cannot link to it.

The JavaScript code reaches these bindings through `process._linkedBinding(name)`, which is how the `lib/` modules obtain their native halves. Declarations of those names are in `typings/internal-ambient.d.ts`.

## Browser process lifecycle

<!-- openwiki: broken internal link [/openwiki/architecture/javascript-api-layer.md] link "/openwiki/architecture/javascript-api-layer.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`ElectronBrowserMainParts` (`shell/browser/electron_browser_main_parts.h`) is the hook that Chromium calls during browser startup. Its member initializers create a `NodeBindings` object for the browser environment and an `ElectronBindings` object bound to the Node libuv loop (`electron_browser_main_parts.cc` around line 178), and startup then creates a `JavascriptEnvironment` on that loop (around line 232). `node_bindings.cc` chooses the init script name from the process type, as described in [JavaScript API Layer](/openwiki/architecture/javascript-api-layer.md). `PreMainMessageLoopRun` (around line 425) starts the Node polling thread, locks URL scheme registries so schemes cannot be added concurrently, and, when extensions are enabled, sets up the extensions client and the web-UI controller factory.

`ElectronBindings::BindProcess` attaches the native members of the `process` object that every process type receives, such as `crash`, `hang`, `getHeapStatistics`, `getSystemMemoryInfo`, and `getCPUUsage`. `getProcessMemoryInfo` is attached only when `IsBrowserProcess()` is true. `BindTo`, which runs in the browser main parts, adds `takeHeapSnapshot` and, on POSIX, `setFdLimit`.

## Platform layout

Platform differences are kept in directory and file-suffix conventions rather than in a single abstraction.

- `shell/browser/ui/` implements windowing and chrome per platform. `views/` is the shared Views toolkit layer, including `root_view.cc`, `win_frame_view.cc`, and `menu_bar.cc`. `gtk/` and `x/` hold Linux-specific code, including `gtk_util.cc`, `status_icon_gtk.cc`, and `global_menu_bar_x11.cc`. `win/` and `cocoa/` hold Windows and macOS code. Files ending in `_mac.mm`, `_win.cc`, `_linux.cc`, and `_views.cc` are compiled only for their platform through `filenames.gni`.
- `shell/browser/api/` contains the implementations of main-process modules. Platform variants use the same suffix pattern, for example `electron_api_app_mac.mm`, `electron_api_power_monitor_win.cc`, and `electron_api_web_contents_mac.mm`.
- `shell/browser/mac/`, `shell/browser/linux/`, and `shell/browser/win/` hold platform helpers that do not belong to a single window or API.

The GN file `filenames.gni` decides which sources are part of each platform's build. Adding a platform file without listing it there silently drops it.

## Subsystems in shell/browser

- `net/` implements network context setup, `ElectronURLLoaderFactory`, and the proxying factories used by `session.webRequest`. `asar/` handles ASAR archive reads for URL loading.
- `extensions/` contains Chromium-extension support, including the extensions client, loader, and system. It is built only when `ENABLE_ELECTRON_EXTENSIONS` is set. `electron_api_extensions.cc` in `shell/browser/api/` exposes the extension API to JavaScript.
- `notifications/`, `printing/`, `osr/` (off-screen rendering), `media/`, `file_system_access/`, `webauthn/`, `badging/`, `bluetooth/`, `hid/`, `serial/`, and `usb/` each implement one feature area that is surfaced through a `shell/browser/api/` counterpart.

## Invariants and failure behavior

- Native object lifetime is tied to the gin helpers (`destroyable.h`, `trackable_object.h`, `self_keep_alive.h`), so native code should not keep a raw pointer to an object past the point where its wrapper can be collected or the owner is destroyed.
- Converters are the place where JavaScript values are decoded into C++ types, which keeps argument handling in one set of files per type.
- The per-process binding lists in `shell/common/node_bindings.cc` are the authority for which native modules a process registers. A binding that is not in the list for a given process is not registered there.
- Platform code is selected by file suffix and by the platform source lists in `filenames.gni`. A file that is not listed for a platform is not compiled for it.

## Extension seams

<!-- openwiki: broken internal link [/openwiki/architecture/api-docs-and-typings.md] link "/openwiki/architecture/api-docs-and-typings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- New main-process module: implement it in `shell/browser/api/`, wrap it with the gin helpers, register a `NODE_LINKED_BINDING_CONTEXT_AWARE` binding, add the name to `ELECTRON_BROWSER_BINDINGS`, and add the source to `filenames.gni`. The JavaScript wrapper and typings follow the steps in [API Documentation and Typings](/openwiki/architecture/api-docs-and-typings.md).
- New value type across the boundary: add a converter under `shell/common/gin_converters/` and include it where the type is used.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md) gives the surrounding process layout.
<!-- openwiki: broken internal link [/openwiki/architecture/process-model-and-ipc.md] link "/openwiki/architecture/process-model-and-ipc.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Process Model and IPC](/openwiki/architecture/process-model-and-ipc.md) covers the messages that flow between the processes these classes live in.
<!-- openwiki: broken internal link [/openwiki/architecture/chromium-and-upstream-patches.md] link "/openwiki/architecture/chromium-and-upstream-patches.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Chromium, Node, and Upstream Patches](/openwiki/architecture/chromium-and-upstream-patches.md) explains the upstream changes that the shell depends on.
