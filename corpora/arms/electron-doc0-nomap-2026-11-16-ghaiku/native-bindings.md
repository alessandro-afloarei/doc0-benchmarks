---
title: "Native Bindings with gin_helper"
---
## Overview

The C++ side exposes each native module to JavaScript as a linked binding, which the JavaScript code reads with `process._linkedBinding`. Each binding is a C++ class or function registered when Node starts, and the classes are built with `gin_helper`, Electron's wrapper over Chromium's `gin` bindings. This page covers how a binding is registered, how a class becomes a constructor with methods, and how values pass between C++ and JavaScript. The APIs built on these bindings are on the pages for their areas, such as [[Windows and WebContents]].

Sources: [shell/common/node_bindings.cc:531-551](repo://shell/common/node_bindings.cc#L531-L551), [shell/common/node_includes.h:38-39](repo://shell/common/node_includes.h#L38-L39)

## Registration

`RegisterBuiltinBindings` runs the registration macros for the process. The browser process gets the browser list, every process gets the common list, a renderer gets the renderer list, and a utility process gets the utility list. The testing list is compiled in only for DCHECK builds.

Sources: [shell/common/node_bindings.cc:531-551](repo://shell/common/node_bindings.cc#L531-L551)

Each list is a macro of `V(name)` entries. The browser list includes `electron_browser_app`, and the common list includes `electron_common_asar`, `electron_common_clipboard` and `electron_common_command_line`. Each name is then matched to the C++ file that defines it with `NODE_LINKED_BINDING_CONTEXT_AWARE`.

Sources: [shell/common/node_bindings.cc:53-62](repo://shell/common/node_bindings.cc#L53-L62), [shell/common/node_bindings.cc:89-96](repo://shell/common/node_bindings.cc#L89-L96), [shell/common/node_bindings.cc:100-104](repo://shell/common/node_bindings.cc#L100-L104)

The macro takes the binding name, which is the string JavaScript passes to `_linkedBinding`, and an init function that Node calls with the exports object. The ASAR binding and the `v8_util` binding use the same macro.

Sources: [shell/common/node_includes.h:38-39](repo://shell/common/node_includes.h#L38-L39), [shell/common/api/electron_api_asar.cc:230](repo://shell/common/api/electron_api_asar.cc#L230), [shell/common/api/electron_api_v8_util.cc:116](repo://shell/common/api/electron_api_v8_util.cc#L116)

The browser window binding is a small example. Its init function creates the `BrowserWindow` constructor with `CreateConstructor` and stores it on the exports object under the name `BrowserWindow`.

Sources: [shell/browser/api/electron_api_browser_window.cc:340-353](repo://shell/browser/api/electron_api_browser_window.cc#L340-L353)

## Classes

`gin_helper::Wrappable<T>` is the base class for objects that JavaScript creates. `SetConstructor` builds a function template with an internal field for the C++ pointer, calls `T::BuildPrototype` to add the methods, and stores the template in the per-isolate data. `GetConstructor` does the same on first use if the template is missing.

Sources: [shell/common/gin_helper/wrappable.h:28-55](repo://shell/common/gin_helper/wrappable.h#L28-L55)

`Init` creates the JavaScript wrapper object from the template and then calls `InitWith` to attach the C++ object to it. If the wrapper cannot be created, for example because `Object.prototype.constructor` was overwritten, the C++ object deletes itself, because V8 no longer manages it.

Sources: [shell/common/gin_helper/wrappable.h:59-74](repo://shell/common/gin_helper/wrappable.h#L59-L74)

`CreateConstructor` may run only once for each type. A second call fails a `CHECK`, so the template for a class cannot be replaced after a binding has created it.

Sources: [shell/common/gin_helper/constructor.h:86-91](repo://shell/common/gin_helper/constructor.h#L86-L91)

`ObjectTemplateBuilder` adds members to a prototype template. Its `SetMethod`, `SetProperty` and `SetValue` calls wrap each C++ callback or value and attach it under a name, so a `BuildPrototype` function is a list of such calls. It adds to the template it is given instead of creating one.

Sources: [shell/common/gin_helper/object_template_builder.h:15-57](repo://shell/common/gin_helper/object_template_builder.h#L15-L57)

## Process bindings

`ElectronBindings::BindProcess` adds methods to the `process` object of each process: `crash`, `hang`, `getCreationTime`, `getHeapStatistics` and similar. `getProcessMemoryInfo` is added only in the browser process. `BindTo` then adds `takeHeapSnapshot` and `setFdLimit` on POSIX.

Sources: [shell/common/api/electron_bindings.cc:43-70](repo://shell/common/api/electron_bindings.cc#L43-L70), [shell/common/api/electron_bindings.cc:72-80](repo://shell/common/api/electron_bindings.cc#L72-L80)

## Conversions

Values cross the boundary through `gin::ConvertToV8` and `gin::ConvertFromV8`, and Electron adds converters for its own types under `shell/common/gin_converters`. A callback converter turns a `base::RepeatingCallback` into a JavaScript function, so a C++ method can take a JavaScript callback and call it later.

Sources: [shell/common/gin_converters/callback_converter.h:15-17](repo://shell/common/gin_converters/callback_converter.h#L15-L17)

The comment in `function_template.h` describes the path a callback takes: it is passed through `v8::FunctionTemplate` to `DispatchToCallback`, which invokes it when JavaScript calls the function.

Sources: [shell/common/gin_helper/function_template.h:51-53](repo://shell/common/gin_helper/function_template.h#L51-L53)

The JavaScript modules in `lib/` read these bindings with `_linkedBinding`, and `BrowserWindow.prototype._init` in [[Windows and WebContents]] is one example. How those modules attach to the exports is on [[JavaScript Module Loading]].

Sources: [lib/browser/api/browser-window.ts:1-10](repo://lib/browser/api/browser-window.ts#L1-L10)
