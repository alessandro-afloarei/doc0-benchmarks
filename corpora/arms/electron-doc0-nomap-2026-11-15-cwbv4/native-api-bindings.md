---
title: "Native API Bindings with gin"
---
## Overview

Most of Electron's API is implemented in C++ and reached from JavaScript through Node "linked bindings": modules compiled into the executable and fetched with `process._linkedBinding(name)`. The C++ side uses Chromium's gin library plus Electron's own `gin_helper` layer to wrap C++ objects in JavaScript objects, convert arguments, emit events, return promises and manage object lifetimes. This page follows two APIs from the TypeScript module down to C++ (`powerSaveBlocker`, a singleton, and `Tray`, a constructible event emitter) and then describes the helpers they use. How the TypeScript modules are bundled and exposed as `require('electron')` is covered in [[JavaScript Bundles and the electron Module]].

Sources: [lib/browser/api/power-save-blocker.ts:1-2](repo://lib/browser/api/power-save-blocker.ts#L1-L2), [lib/browser/api/tray.ts:1-3](repo://lib/browser/api/tray.ts#L1-L3), [docs/development/creating-api.md:41-47](repo://docs/development/creating-api.md#L41-L47)

## Registering a binding

### NODE_LINKED_BINDING_CONTEXT_AWARE

Each API file ends with a `NODE_LINKED_BINDING_CONTEXT_AWARE(name, Initialize)` macro. `Initialize` receives the binding's `exports` object and fills it. For `powerSaveBlocker` it stores one `PowerSaveBlocker` instance; for `Tray` it stores the constructor function.

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:138-152](repo://shell/browser/api/electron_api_power_save_blocker.cc#L138-L152), [shell/browser/api/electron_api_tray.cc:450-465](repo://shell/browser/api/electron_api_tray.cc#L450-L465)

### The binding lists

The macro only defines a registration function. `node_bindings.cc` lists every binding name in macros such as `ELECTRON_BROWSER_BINDINGS` and `ELECTRON_COMMON_BINDINGS`, and `NodeBindings::RegisterBuiltinBindings` calls the registration function for each list that applies to the current process: browser bindings only in the main process, renderer bindings only in renderers, utility bindings only in utility processes, common bindings everywhere, and testing bindings in DCHECK builds. A binding missing from the lists cannot be loaded, and a binding from another process's list is unavailable by design.

Sources: [shell/common/node_bindings.cc:53-93](repo://shell/common/node_bindings.cc#L53-L93), [shell/common/node_bindings.cc:531-547](repo://shell/common/node_bindings.cc#L531-L547)

### The TypeScript side

The TypeScript module calls `process._linkedBinding` with the same name. Many modules simply re-export what the binding holds.

Sources: [lib/browser/api/power-save-blocker.ts:1-2](repo://lib/browser/api/power-save-blocker.ts#L1-L2), [lib/browser/api/tray.ts:1-3](repo://lib/browser/api/tray.ts#L1-L3)

```ts
const { powerSaveBlocker } = process._linkedBinding('electron_browser_power_save_blocker');
export default powerSaveBlocker;
```

Sources: [lib/browser/api/power-save-blocker.ts:1-2](repo://lib/browser/api/power-save-blocker.ts#L1-L2)

Others add JavaScript behaviour. `powerMonitor` is a JavaScript `EventEmitter` that creates the native monitor only when the first listener is added, then points the native object's `emit` at its own, so native events reach the JavaScript listeners; on Linux it also tells C++ whether anyone listens for `shutdown`. The `_linkedBinding` overloads in `typings/internal-ambient.d.ts` give each binding name its TypeScript type.

Sources: [lib/browser/api/power-monitor.ts:1-50](repo://lib/browser/api/power-monitor.ts#L1-L50), [docs/development/creating-api.md:128-149](repo://docs/development/creating-api.md#L128-L149)

## Wrapping C++ objects

### Wrappable and the object template

A C++ class becomes a JavaScript object by deriving from a wrappable base. `PowerSaveBlocker` derives from `gin_helper::DeprecatedWrappable<PowerSaveBlocker>`, declares a static `kWrapperInfo`, and overrides `GetObjectTemplateBuilder` to list its methods; `Create` wraps a new instance with `gin_helper::CreateHandle`. gin builds the template once per isolate and stores it in `PerIsolateData` under the address of `kWrapperInfo`.

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:44-48](repo://shell/browser/api/electron_api_power_save_blocker.cc#L44-L48), [shell/browser/api/electron_api_power_save_blocker.cc:117-134](repo://shell/browser/api/electron_api_power_save_blocker.cc#L117-L134), [shell/common/gin_helper/wrappable.h:81-96](repo://shell/common/gin_helper/wrappable.h#L81-L96)

```cpp
gin::ObjectTemplateBuilder PowerSaveBlocker::GetObjectTemplateBuilder(
    v8::Isolate* isolate) {
  return gin_helper::DeprecatedWrappable<
             PowerSaveBlocker>::GetObjectTemplateBuilder(isolate)
      .SetMethod("start", &PowerSaveBlocker::Start)
      .SetMethod("stop", &PowerSaveBlocker::Stop)
      .SetMethod("isStarted", &PowerSaveBlocker::IsStarted);
}
```

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:123-130](repo://shell/browser/api/electron_api_power_save_blocker.cc#L123-L130)

`SetMethod` binds a C++ member function; gin converts each JavaScript argument to the C++ parameter type and the return value back. `start('prevent-display-sleep')` therefore reaches `PowerSaveBlocker::Start(device::mojom::WakeLockType)` through a `gin::Converter` specialisation in the same file, which maps the two accepted strings to the enum and fails conversion for anything else.

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:20-40](repo://shell/browser/api/electron_api_power_save_blocker.cc#L20-L40), [shell/browser/api/electron_api_power_save_blocker.cc:100-115](repo://shell/browser/api/electron_api_power_save_blocker.cc#L100-L115)

The older `gin_helper::Wrappable<T>` variant builds its template from a static `T::BuildPrototype` and creates its wrapper in `Init`, deleting the C++ object if V8 cannot instantiate one. Both are being phased out in favour of Chromium's newer `gin::Wrappable`, which the `DeprecatedWrappable` comment notes.

Sources: [shell/common/gin_helper/wrappable.h:27-96](repo://shell/common/gin_helper/wrappable.h#L27-L96)

### Converters

Shared conversions live in `shell/common/gin_converters`: one header per family of types, for example `gfx_converter` for points, sizes and rectangles, `gurl_converter`, `file_path_converter`, `image_converter` for `NativeImage`, `net_converter` for requests and headers, `value_converter` for `base::Value`, and `callback_converter` for passing JavaScript functions as `base::Callback`s. A converter used by one API only, like the wake-lock type above, sits in that API's file.

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:20-40](repo://shell/browser/api/electron_api_power_save_blocker.cc#L20-L40)

### Constructible classes

When JavaScript must call `new`, the class also derives from `gin_helper::Constructible<T>`. `GetConstructor` creates a constructor function template that calls the static `T::New`, makes it inherit from the event emitter template when `T` is an `EventEmitterMixin`, names it with `T::GetClassName()`, and fills the prototype with `T::FillObjectTemplate`. `Tray` is built this way: its binding exports `Tray::GetConstructor(isolate, context)`, and `Tray::FillObjectTemplate` lists `destroy`, `setImage`, `setToolTip` and the other methods.

Sources: [shell/common/gin_helper/constructible.h:14-80](repo://shell/common/gin_helper/constructible.h#L14-L80), [shell/browser/api/electron_api_tray.cc:415-422](repo://shell/browser/api/electron_api_tray.cc#L415-L422), [shell/browser/api/electron_api_tray.cc:454-463](repo://shell/browser/api/electron_api_tray.cc#L454-L463)

`Tray::New` shows the conventions for a constructor. It takes a `gin_helper::ErrorThrower` to raise JavaScript errors, refuses to run before the app is ready, validates its arguments, and wraps construction in a `v8::TryCatch` so an error thrown while converting the image is re-thrown to JavaScript rather than dropped.

Sources: [shell/browser/api/electron_api_tray.cc:65-94](repo://shell/browser/api/electron_api_tray.cc#L65-L94)

## Emitting events

C++ objects that emit events derive from `gin_helper::EventEmitterMixin<T>`. Its template inherits from a function template whose prototype's prototype is Node's `EventEmitter.prototype`, so a native `Tray` has `on`, `once` and `emit` like any JavaScript emitter. The main-process bootstrap supplies that prototype by calling `setEventEmitterPrototype` on the `electron_browser_event_emitter` binding.

Sources: [shell/browser/event_emitter_mixin.h:19-73](repo://shell/browser/event_emitter_mixin.h#L19-L73), [shell/common/gin_helper/event_emitter_template.cc:17-42](repo://shell/common/gin_helper/event_emitter_template.cc#L17-L42), [shell/browser/api/electron_api_event_emitter.cc:28-48](repo://shell/browser/api/electron_api_event_emitter.cc#L28-L48), [lib/browser/init.ts:19-19](repo://lib/browser/init.ts#L19-L19)

The mixin offers two calls. `Emit(name, args...)` creates a `gin_helper::internal::Event`, passes it as the first argument and returns whether a listener called `event.preventDefault()`, which is how C++ learns that `before-quit` or `will-quit` was cancelled. `EmitWithoutEvent(name, args...)` passes only the arguments, as `Tray::OnClicked` does for `click`. Both convert their arguments with gin and call the object's JavaScript `emit` method.

Sources: [shell/browser/event_emitter_mixin.h:26-52](repo://shell/browser/event_emitter_mixin.h#L26-L52), [shell/common/gin_helper/event.h:13-33](repo://shell/common/gin_helper/event.h#L13-L33), [shell/common/gin_helper/event_emitter_caller.h:31-42](repo://shell/common/gin_helper/event_emitter_caller.h#L31-L42), [shell/browser/api/electron_api_tray.cc:96-101](repo://shell/browser/api/electron_api_tray.cc#L96-L101), [shell/browser/api/electron_api_app.cc:573-583](repo://shell/browser/api/electron_api_app.cc#L573-L583)

## Promises

Asynchronous methods return a `gin_helper::Promise<T>`, which holds a V8 promise resolver. `Resolve` converts the C++ value with gin; `Reject` and `RejectWithErrorMessage` reject it. The static `ResolvePromise` posts the resolution as a task when a task runner is available, so the promise settles outside the C++ call stack that produced the result. `ResolvedPromise` returns an already-settled promise, and `Then` attaches a C++ callback. `app.whenReady()` is an example: `Browser::WhenReady` keeps one `Promise<void>` and resolves it in `DidFinishLaunching`.

Sources: [shell/common/gin_helper/promise.h:30-133](repo://shell/common/gin_helper/promise.h#L30-L133), [shell/browser/browser.cc:194-211](repo://shell/browser/browser.cc#L194-L211)

## Object lifetimes

A wrapped object normally lives until V8 collects its JavaScript wrapper. Several helpers change that.

Sources: [shell/common/gin_helper/wrappable.h:81-96](repo://shell/common/gin_helper/wrappable.h#L81-L96)

| Helper | What it guarantees | Example |
| --- | --- | --- |
| `Pinnable<T>` | `Pin` holds a strong reference to the wrapper so it is not collected while the native resource is visible; `Unpin` releases it | `Tray::New` pins, `Tray::Destroy` unpins |
| `CleanedUpAtExit` | Instance is registered in a list that `DoCleanup` deletes, calling `WillBeDestroyed` first, when the JavaScript environment shuts down | `Tray`, which clears its weak wrapper there |
| `TrackableObject<T>` | Each instance gets a `weak_map_id` and is kept in a per-class `KeyWeakMap`, so it can be found by ID or listed with `GetAll`; `MarkDestroyed` clears the wrapper's pointer so later calls see a destroyed object | `BaseWindow` |

Sources: [shell/common/gin_helper/pinnable.h:12-26](repo://shell/common/gin_helper/pinnable.h#L12-L26), [shell/browser/api/electron_api_tray.cc:188-196](repo://shell/browser/api/electron_api_tray.cc#L188-L196), [shell/common/gin_helper/cleaned_up_at_exit.h:7-18](repo://shell/common/gin_helper/cleaned_up_at_exit.h#L7-L18), [shell/common/gin_helper/cleaned_up_at_exit.cc:33-40](repo://shell/common/gin_helper/cleaned_up_at_exit.cc#L33-L40), [shell/common/gin_helper/trackable_object.h:20-75](repo://shell/common/gin_helper/trackable_object.h#L20-L75), [shell/browser/api/electron_api_base_window.h:37-37](repo://shell/browser/api/electron_api_base_window.h#L37-L37)

`DoCleanup` runs when the microtask runner is torn down in `JavascriptEnvironment`, which itself happens during shutdown after the message loop ends, as described in [[Process Model and Native Startup]].

Sources: [shell/browser/javascript_environment.cc:151-160](repo://shell/browser/javascript_environment.cc#L151-L160)

## Checklist for a new API

`docs/development/creating-api.md` lists the steps that are easy to miss when adding a main-process module.

Sources: [docs/development/creating-api.md:1-11](repo://docs/development/creating-api.md#L1-L11)

1. Add the `.cc` and `.h` files, and any platform files, to the lists in `filenames.gni`.
2. Write the API's Markdown in `docs/api`; the TypeScript definitions are generated from it.
3. Implement the wrappable class and an `Initialize` that fills `exports`.
4. Add a `_linkedBinding` overload in `typings/internal-ambient.d.ts`, end the file with `NODE_LINKED_BINDING_CONTEXT_AWARE`, and add the name to the binding list in `node_bindings.cc`.
5. Create `lib/browser/api/<name>.ts` and add it to `browserModuleList`.

Sources: [docs/development/creating-api.md:7-35](repo://docs/development/creating-api.md#L7-L35), [docs/development/creating-api.md:37-39](repo://docs/development/creating-api.md#L37-L39), [docs/development/creating-api.md:128-174](repo://docs/development/creating-api.md#L128-L174)
