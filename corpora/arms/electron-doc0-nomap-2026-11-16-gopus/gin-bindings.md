---
title: "Native API Bindings with gin"
---
## Overview

Every Electron API object that JavaScript touches is backed by a C++ object: `BrowserWindow`, `webContents`, `session`, `powerSaveBlocker`. Electron builds them on Chromium's *gin* library, which binds C++ classes and functions to V8, and adds its own `gin_helper` layer for the patterns it needs: wrappers whose lifetime V8 manages, classes constructible with `new`, objects that emit Node-style events, and promises settled from C++. Each module is registered as a Node *linked binding*, and the TypeScript in `lib/` picks it up with `process._linkedBinding(name)`.

Sources: [shell/common/gin_helper/wrappable.h:28-101](repo://shell/common/gin_helper/wrappable.h#L28-L101), [shell/common/node_includes.h:34-38](repo://shell/common/node_includes.h#L34-L38)

How the linked bindings are listed and registered per process is described in [[Node.js Integration and the Event Loop]]. How the TypeScript side wraps them into the `electron` module is described in [[Internal JavaScript Bundles]]. This page covers the C++ side, starting with one complete small module.

Sources: [shell/common/node_bindings.cc:531-547](repo://shell/common/node_bindings.cc#L531-L547)

## A module end to end: powerSaveBlocker

`powerSaveBlocker` is about as small as a module gets. The TypeScript is two lines: it takes the `powerSaveBlocker` object from the `electron_browser_power_save_blocker` binding and exports it.

Sources: [lib/browser/api/power-save-blocker.ts:1-2](repo://lib/browser/api/power-save-blocker.ts#L1-L2)

On the C++ side, `PowerSaveBlocker` derives from `gin_helper::DeprecatedWrappable<PowerSaveBlocker>` and has a static `kWrapperInfo`. `GetObjectTemplateBuilder` lists the methods JavaScript can call. `start`, `stop` and `isStarted` are plain member functions, and gin converts their arguments and return values.

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:44-45](repo://shell/browser/api/electron_api_power_save_blocker.cc#L44-L45), [shell/browser/api/electron_api_power_save_blocker.cc:100-115](repo://shell/browser/api/electron_api_power_save_blocker.cc#L100-L115)

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

`start(type)` takes a `device::mojom::WakeLockType`, so the file defines a `gin::Converter` for it. `"prevent-app-suspension"` and `"prevent-display-sleep"` map to the enum values, and any other string fails the conversion, which gin reports to the caller as a type error.

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:20-40](repo://shell/browser/api/electron_api_power_save_blocker.cc#L20-L40)

The module's `Initialize` function receives the binding's `exports` object and sets `powerSaveBlocker` to a single instance created with `gin_helper::CreateHandle`. `NODE_LINKED_BINDING_CONTEXT_AWARE(electron_browser_power_save_blocker, Initialize)` registers it. That macro is Electron's alternative to Node's own: it expands to `NODE_BINDING_CONTEXT_AWARE_CPP(..., NM_F_LINKED)` without a static constructor, so `NodeBindings::RegisterBuiltinBindings` registers each module explicitly.

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:138-153](repo://shell/browser/api/electron_api_power_save_blocker.cc#L138-L153), [shell/common/node_includes.h:34-38](repo://shell/common/node_includes.h#L34-L38), [shell/common/node_bindings.cc:114-127](repo://shell/common/node_bindings.cc#L114-L127)

The behaviour shows the module's own logic. `Start` records the type under an increasing id. `UpdatePowerSaveBlocker` asks the device service's wake lock for the strongest type requested: display-sleep prevention outranks app-suspension prevention, as the comment explains. It cancels the lock when no ids remain.

Sources: [shell/browser/api/electron_api_power_save_blocker.cc:52-115](repo://shell/browser/api/electron_api_power_save_blocker.cc#L52-L115)

## Wrapper base classes

### Three kinds of wrapper

Electron has three ways to tie a C++ object to its JavaScript wrapper. Which one a class uses decides who owns the object.

Sources: [shell/common/gin_helper/wrappable.h:28-96](repo://shell/common/gin_helper/wrappable.h#L28-L96), [shell/browser/api/electron_api_session.h:62-70](repo://shell/browser/api/electron_api_session.h#L62-L70)

| Base | Wrapper created by | C++ object deleted when | Used by |
| --- | --- | --- | --- |
| `gin_helper::Wrappable<T>` | `InitWith` / `InitWithArgs` from a constructor | The wrapper is garbage-collected (two-pass weak callback) | `BaseWindow` and other `TrackableObject` classes |
| `gin_helper::DeprecatedWrappable<T>` | `GetWrapper` on first use | The wrapper is garbage-collected | `WebContents`, `PowerSaveBlocker`, IPC objects |
| `gin::Wrappable<T>` (cppgc) | gin, as a garbage-collected C++ object | The Oilpan heap collects it | `Session` |

Sources: [shell/common/gin_helper/wrappable.cc:57-91](repo://shell/common/gin_helper/wrappable.cc#L57-L91), [shell/common/gin_helper/wrappable.cc:110-140](repo://shell/common/gin_helper/wrappable.cc#L110-L140), [shell/browser/api/electron_api_base_window.h:37-38](repo://shell/browser/api/electron_api_base_window.h#L37-L38), [shell/browser/api/electron_api_web_contents.h:114-126](repo://shell/browser/api/electron_api_web_contents.h#L114-L126)

`DeprecatedWrappable` is a copy of an upstream gin class; the header comment marks it for removal under electron/electron#47922.

Sources: [shell/common/gin_helper/wrappable.h:80-96](repo://shell/common/gin_helper/wrappable.h#L80-L96)

### WrappableBase in detail

`WrappableBase::InitWith` stores `this` in the wrapper's first internal field and keeps the wrapper in a weak `v8::Global`. It then calls the object's JavaScript `_init` method if it has one, which is how `BaseWindow.prototype._init` and the other TypeScript initializers run. When the wrapper becomes unreachable, the first weak callback resets the handle. The second pass deletes the C++ object, unless the microtasks runner has already been destroyed during shutdown. The destructor clears the internal field, so a wrapper that outlives its object sees `null` instead of a dangling pointer.

Sources: [shell/common/gin_helper/wrappable.cc:32-91](repo://shell/common/gin_helper/wrappable.cc#L32-L91)

`Wrappable<T>::GetConstructor` lazily builds one `FunctionTemplate` per class from `T::BuildPrototype` and caches it in gin's per-isolate data under `kWrapperInfo`. The pointer-converter specializations let any `T*` cross into JavaScript as its wrapper, or as `null` when the pointer is null, and come back as the C++ pointer.

Sources: [shell/common/gin_helper/wrappable.h:33-55](repo://shell/common/gin_helper/wrappable.h#L33-L55), [shell/common/gin_helper/wrappable.h:105-140](repo://shell/common/gin_helper/wrappable.h#L105-L140)

## Constructible classes

A class JavaScript can `new`, such as `WebContents` or `Session`, also derives from `gin_helper::Constructible<T>`. It defines a static `New` and a static `FillObjectTemplate` instead of `GetObjectTemplateBuilder`, as the header comment explains. `GetConstructor` builds a constructor function template bound to `T::New`, sets the class name, fills the prototype, caches it, and returns the function, which the module's `Initialize` puts on `exports`. If `T` also mixes in `EventEmitterMixin<T>`, the constructor inherits the event emitter template.

Sources: [shell/common/gin_helper/constructible.h:17-65](repo://shell/common/gin_helper/constructible.h#L17-L65), [shell/browser/api/electron_api_session.cc:1920-1930](repo://shell/browser/api/electron_api_session.cc#L1920-L1930)

## Emitting events

Native objects emit events on their JavaScript wrappers by calling the wrapper's own `emit` method, so listeners added with `on` in TypeScript or app code receive them. `gin_helper::EmitEvent` converts each argument with gin and calls `obj.emit(name, ...args)`.

Sources: [shell/common/gin_helper/event_emitter_caller.h:28-42](repo://shell/common/gin_helper/event_emitter_caller.h#L28-L42)

Two helpers sit on top. `EventEmitter<T>`, a `Wrappable`, and `EventEmitterMixin<T>`, for other base classes, each provide two methods.

Sources: [shell/common/gin_helper/event_emitter.h:22-28](repo://shell/common/gin_helper/event_emitter.h#L22-L28), [shell/browser/event_emitter_mixin.h:18-28](repo://shell/browser/event_emitter_mixin.h#L18-L28)

- `Emit(name, args...)` creates an `internal::Event`, passes it as the first argument, and returns whether a listener called `preventDefault()`. Native code uses that to decide, for example, whether a window may close.
- `EmitWithoutEvent(name, args...)` calls `emit` with only the arguments. The private `-ipc-*` events use it.

Sources: [shell/common/gin_helper/event_emitter.h:22-61](repo://shell/common/gin_helper/event_emitter.h#L22-L61), [shell/browser/event_emitter_mixin.h:18-55](repo://shell/browser/event_emitter_mixin.h#L18-L55)

`EmitEvent` may run JavaScript that destroys the emitter. That is why `Emit` takes everything it needs from `this` before the call, and why callers such as `WebContents::LoadURL` re-check a weak pointer afterwards.

Sources: [shell/common/gin_helper/event_emitter.h:37-41](repo://shell/common/gin_helper/event_emitter.h#L37-L41), [shell/browser/api/electron_api_web_contents.cc:2398-2406](repo://shell/browser/api/electron_api_web_contents.cc#L2398-L2406)

For wrappers to have `on`, `once` and the rest, their prototypes must chain to Node's `EventEmitter.prototype`. The browser init script passes that prototype to the `electron_browser_event_emitter` binding, which stores it. `GetEventEmitterTemplate` builds a function template whose `prototype` is set to it, and every emitter class inherits from that template.

Sources: [lib/browser/init.ts:19-19](repo://lib/browser/init.ts#L19-L19), [shell/browser/api/electron_api_event_emitter.cc:22-44](repo://shell/browser/api/electron_api_event_emitter.cc#L22-L44), [shell/common/gin_helper/event_emitter_template.cc:17-37](repo://shell/common/gin_helper/event_emitter_template.cc#L17-L37)

## Lifetime helpers

Garbage collection is not always the right owner. Electron has helpers to keep wrappers alive and to find them again.

Sources: [shell/common/gin_helper/pinnable.h:15-28](repo://shell/common/gin_helper/pinnable.h#L15-L28)

| Helper | What it does | Example |
| --- | --- | --- |
| `TrackableObject<T>` | An `EventEmitter` with a per-class weak map from a numeric id to the wrapper; `AttachAsUserData` lets the wrapped Chromium object find its API object; `MarkDestroyed` clears the internal field so later calls see a destroyed object | `BaseWindow`, which looks up windows by id |
| `Pinnable<T>` | `Pin` holds a strong `v8::Global` to the wrapper until `Unpin` | Extension background pages in `WebContents` |
| `SelfKeepAlive<T>` | Holds a `cppgc::Persistent` to a cppgc object until `Clear` | `Session::keep_alive_`, cleared when the isolate is disposed |
| `CleanedUpAtExit` | Registers the object for deletion just before the isolate is disposed, because weak callbacks do not run at isolate teardown | `WebContents` |

Sources: [shell/common/gin_helper/trackable_object.h:21-131](repo://shell/common/gin_helper/trackable_object.h#L21-L131), [shell/common/gin_helper/pinnable.h:13-34](repo://shell/common/gin_helper/pinnable.h#L13-L34), [shell/common/gin_helper/self_keep_alive.h:10-34](repo://shell/common/gin_helper/self_keep_alive.h#L10-L34), [shell/common/gin_helper/cleaned_up_at_exit.h:10-26](repo://shell/common/gin_helper/cleaned_up_at_exit.h#L10-L26), [shell/browser/api/electron_api_session.cc:1860-1866](repo://shell/browser/api/electron_api_session.cc#L1860-L1866)

`CleanedUpAtExit::DoCleanup` runs from `JavascriptEnvironment::DestroyMicrotasksRunner`, before gin is told the runner is gone. That is also the signal the second-pass weak callbacks check before deleting anything.

Sources: [shell/browser/javascript_environment.cc:151-160](repo://shell/browser/javascript_environment.cc#L151-L160), [shell/common/gin_helper/wrappable.cc:84-91](repo://shell/common/gin_helper/wrappable.cc#L84-L91)

## Promises from C++

Asynchronous APIs return promises created in C++. `gin_helper::Promise<RT>` holds a `v8::Promise::Resolver` and its context. It is move-only and must be settled on the thread that created it, as the class comment says. `GetHandle()` returns the JavaScript promise to hand back from the method. `Resolve(value)` converts the value with gin and resolves inside a `SettleScope`, which enters the creation context and a microtasks scope.

Sources: [shell/common/gin_helper/promise.h:25-115](repo://shell/common/gin_helper/promise.h#L25-L115)

Static helpers cover the common cases: `ResolvePromise` posts the resolution as a task when a task runner exists, `ResolvedPromise` returns a promise that is already settled, and `RejectWithErrorMessage` rejects with a new `Error`. `Then` attaches a C++ callback to a promise, which is how the download delegate waits for the save dialog.

Sources: [shell/common/gin_helper/promise.h:45-50](repo://shell/common/gin_helper/promise.h#L45-L50), [shell/common/gin_helper/promise.h:85-120](repo://shell/common/gin_helper/promise.h#L85-L120), [shell/browser/electron_download_manager_delegate.cc:266-274](repo://shell/browser/electron_download_manager_delegate.cc#L266-L274)

## Converters

Arguments and return values cross the boundary through `gin::Converter<T>` specializations. Gin provides the basic types. Electron adds its converters in `shell/common/gin_converters`, one header per area: accelerators, Blink input events and cloneable messages, content types such as permission types and referrers, frames, GURLs, file paths, images, network objects, `base::Value`, and more. A module can also define a converter locally for its own enum, as `powerSaveBlocker` does.

Sources: [shell/common/gin_converters/blink_converter.h:1-40](repo://shell/common/gin_converters/blink_converter.h#L1-L40), [shell/browser/api/electron_api_power_save_blocker.cc:20-40](repo://shell/browser/api/electron_api_power_save_blocker.cc#L20-L40)
