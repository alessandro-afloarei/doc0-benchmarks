---
title: "Gin Helpers, Converters and Wrappables"
---
## Overview

Electron's C++ APIs are exposed to JavaScript with Chromium's `gin` library, extended by the `gin_helper` namespace in `shell/common/gin_helper` and by type converters in `shell/common/gin_converters`. Together they answer four questions every binding has: how a native class gets a JavaScript wrapper object, how that wrapper becomes an `EventEmitter`, how arguments and return values change type at the boundary, and who owns the native object's lifetime. This page uses `Tray` as the worked example. How a binding is registered by name is in [[Module Loading and Linked Bindings]].

Sources: [shell/browser/api/electron_api_tray.h:38-56](repo://shell/browser/api/electron_api_tray.h#L38-L56), [shell/common/gin_helper/wrappable_base.h:19-35](repo://shell/common/gin_helper/wrappable_base.h#L19-L35)

## Anatomy of a native class

`Tray` is typical of the current style. It inherits several small mixins, each doing one job:

| Base | Job |
| --- | --- |
| `gin_helper::DeprecatedWrappable<Tray>` | owns the link between the C++ object and its V8 wrapper |
| `gin_helper::EventEmitterMixin<Tray>` | gives the class `Emit` and makes the JS object an `EventEmitter` |
| `gin_helper::Constructible<Tray>` | makes the class creatable with `new` from JavaScript |
| `gin_helper::CleanedUpAtExit` | gets `WillBeDestroyed` called when the process shuts down |
| `gin_helper::Pinnable<Tray>` | keeps the wrapper alive until the object unpins itself |

Sources: [shell/browser/api/electron_api_tray.h:38-43](repo://shell/browser/api/electron_api_tray.h#L38-L43)

A `Constructible` class supplies two static methods, `New` (the JavaScript constructor body) and `FillObjectTemplate` (the prototype's methods), and must not define `GetObjectTemplateBuilder`. The binding's `Initialize` then exports the constructor by name:

```cpp
gin::Dictionary dict{isolate, exports};
dict.Set("Tray", Tray::GetConstructor(isolate, context));
```

Sources: [shell/common/gin_helper/constructible.h:17-39](repo://shell/common/gin_helper/constructible.h#L17-L39), [shell/browser/api/electron_api_tray.cc:454-465](repo://shell/browser/api/electron_api_tray.cc#L454-L465)

`GetConstructor` builds the `FunctionTemplate` once per isolate. It binds `T::New` as the call handler, sets the class name from `GetClassName()`, reserves internal fields for the native pointer, and lets `T::FillObjectTemplate` fill the prototype. If `T` derives from `EventEmitterMixin<T>`, the template also inherits from the shared event emitter template.

Sources: [shell/common/gin_helper/constructible.h:39-65](repo://shell/common/gin_helper/constructible.h#L39-L65)

`Tray::FillObjectTemplate` uses `gin::ObjectTemplateBuilder`, chaining `SetMethod("setImage", &Tray::SetImage)` and similar calls. Gin converts each JavaScript argument to the C++ parameter type of the member function and the return value back, so a method signature is its own argument schema.

```cpp
gin::ObjectTemplateBuilder(isolate, GetClassName(), templ)
    .SetMethod("destroy", &Tray::Destroy)
    .SetMethod("isDestroyed", &Tray::IsDestroyed)
    .SetMethod("setImage", &Tray::SetImage)
```

Sources: [shell/browser/api/electron_api_tray.cc:414-438](repo://shell/browser/api/electron_api_tray.cc#L414-L438)

## Creating the object

`Tray::New` receives its arguments through the same conversion: an `ErrorThrower` (a small object that throws JavaScript `Error`, `TypeError`, `RangeError`, `ReferenceError` or `SyntaxError`), the image as a raw `v8::Local<v8::Value>`, an optional GUID, and the raw `gin::Arguments*` for anything unusual. It throws if the app is not ready, runs the constructor inside a `v8::TryCatch` (the comment says errors thrown from native code are otherwise dropped when entering V8), wraps the new object with `CreateHandle`, and calls `Pin`.

Sources: [shell/browser/api/electron_api_tray.cc:65-94](repo://shell/browser/api/electron_api_tray.cc#L65-L94), [shell/common/gin_helper/error_thrower.h:15-35](repo://shell/common/gin_helper/error_thrower.h#L15-L35)

The base class documents the rule behind `CreateHandle`: subclasses should have private constructors and a static creator returning a handle, because the weak callback of the wrapper is the signal to delete the C++ object. A wrappable without a wrapper would leak.

Sources: [shell/common/gin_helper/wrappable_base.h:19-35](repo://shell/common/gin_helper/wrappable_base.h#L19-L35)

## Making the wrapper an EventEmitter

Node's `EventEmitter.prototype` only exists once JavaScript has run, so C++ receives it from JavaScript: `lib/browser/init.ts` calls `setEventEmitterPrototype(EventEmitter.prototype)` on the `electron_browser_event_emitter` binding, which stores it in a global `v8::Global`. The utility bootstrap does the same.

Sources: [lib/browser/init.ts:19](repo://lib/browser/init.ts#L19-L19), [shell/browser/api/electron_api_event_emitter.cc:17-48](repo://shell/browser/api/electron_api_event_emitter.cc#L17-L48), [lib/utility/init.ts:16](repo://lib/utility/init.ts#L16-L16)

`GetEventEmitterTemplate` then creates a `FunctionTemplate` whose prototype is that `EventEmitter.prototype` (via `SetPrototypeV2`), cached per isolate. Classes using `EventEmitterMixin` inherit from this template, so `new Tray()` is a real `EventEmitter` in JavaScript.

Sources: [shell/common/gin_helper/event_emitter_template.cc:17-42](repo://shell/common/gin_helper/event_emitter_template.cc#L17-L42)

Emitting from C++ is `Emit("name", args...)`. The mixin fetches the wrapper, creates an `Event` object, and calls `EmitEvent` with the event as the first argument, so a listener sees `(event, ...args)` and can call `preventDefault()`; `Emit` returns `event->GetDefaultPrevented()`. `EmitWithoutEvent` skips the event object. Tray uses this everywhere, for example `Emit("balloon-show")` and `Emit("drop-files", files)`.

Sources: [shell/browser/event_emitter_mixin.h:19-52](repo://shell/browser/event_emitter_mixin.h#L19-L52), [shell/browser/api/electron_api_tray.cc:123-143](repo://shell/browser/api/electron_api_tray.cc#L123-L143)

The actual call goes through `CallMethodWithArgs`: it returns false when there is no current Node environment, opens a `node::CallbackScope` and a microtask scope, and uses `node::MakeCallback` so that pending Node tasks run too. A throwing listener yields `false`, which means "not handled". This is why native events interleave correctly with Node's process-tick queue; see [[Node.js Integration and the Event Loop]].

Sources: [shell/common/gin_helper/event_emitter_caller.cc:11-41](repo://shell/common/gin_helper/event_emitter_caller.cc#L11-L41)

## Lifetime and destruction

Native objects normally die when V8 garbage-collects their wrapper, through the first and second weak callbacks on `WrappableBase`. Three helpers adjust that:

- `Pinnable::Pin` stores the wrapper in a strong `v8::Global`, so an object like a `Tray` that must outlive every JavaScript reference is not collected; `Unpin` releases it.
- `CleanedUpAtExit` registers each instance in a static list. At shutdown `DoCleanup` calls `WillBeDestroyed()` on each (Tray overrides it to `ClearWeak()`) and then deletes it. `JavascriptEnvironment::DestroyMicrotasksRunner` runs it, after telling the isolate holder so finalizers do not touch freed state.
- `Destroyable::MakeDestroyable` adds `destroy()` and `isDestroyed()` to a prototype: `destroy` deletes the native object and nulls the internal field, and `isDestroyed` checks for a missing internal pointer.

Sources: [shell/common/gin_helper/pinnable.h:15-32](repo://shell/common/gin_helper/pinnable.h#L15-L32), [shell/common/gin_helper/cleaned_up_at_exit.cc:16-40](repo://shell/common/gin_helper/cleaned_up_at_exit.cc#L16-L40), [shell/browser/api/electron_api_tray.cc:444-446](repo://shell/browser/api/electron_api_tray.cc#L444-L446), [shell/browser/javascript_environment.cc:150-160](repo://shell/browser/javascript_environment.cc#L150-L160), [shell/common/gin_helper/destroyable.cc:26-72](repo://shell/common/gin_helper/destroyable.cc#L26-L72)

`TrackableObject<T>`, used by `BaseWindow`, adds identity on top of this: each instance gets a `weak_map_id`, is registered in a per-class weak map, and can be found again with `FromWeakMapID` or from a wrapped class carrying that id as user data. `MarkDestroyed` nulls the internal field and `IsDestroyed` tests it. The map is leaked on purpose, as the source says. See [[Windows, Views and Native Window Backends]].

Sources: [shell/common/gin_helper/trackable_object.h:22-52](repo://shell/common/gin_helper/trackable_object.h#L22-L52), [shell/common/gin_helper/trackable_object.h:54-128](repo://shell/common/gin_helper/trackable_object.h#L54-L128)

The older `Wrappable<T>` template builds its template with `T::BuildPrototype`, and both it and `DeprecatedWrappable` carry a note that they are copies of Chromium code to be removed as part of electron/electron#47922. New classes follow the `Constructible` style above.

Sources: [shell/common/gin_helper/wrappable.h:28-55](repo://shell/common/gin_helper/wrappable.h#L28-L55), [shell/common/gin_helper/wrappable.h:80-96](repo://shell/common/gin_helper/wrappable.h#L80-L96)

## Dictionaries, promises and callbacks

`gin_helper::Dictionary` extends `gin::Dictionary` without adding members. Its `Get` is `const`, checks the key exists first and accepts any key type; `ValueOrDefault` returns a default for a missing key and `GetOptional` writes into a `std::optional`. `GetHidden` and `SetHidden` use V8 private keys for values JavaScript cannot see, which is how `appSearchPaths` is passed to `init.ts` (see [[Main Process Startup]]).

Sources: [shell/common/gin_helper/dictionary.h:20-110](repo://shell/common/gin_helper/dictionary.h#L20-L110)

`gin_helper::Promise<T>` wraps a `v8::Promise::Resolver`. It is move-only and must be destroyed on its creation thread, with `Resolve`, `Reject`, `RejectWithErrorMessage` and `GetHandle`. Asynchronous APIs create one, return its handle, and settle it later. `dialog` does exactly this: `ShowSaveDialog` creates a `Promise<gin_helper::Dictionary>`, returns `promise.GetHandle()` and passes the promise to the platform dialog. `SettleScope` enters the right context and a microtask scope when it settles.

```cpp
gin_helper::Promise<gin_helper::Dictionary> promise(args->isolate());
v8::Local<v8::Promise> handle = promise.GetHandle();

file_dialog::ShowSaveDialog(settings, std::move(promise));
return handle;
```

Sources: [shell/common/gin_helper/promise.h:23-77](repo://shell/common/gin_helper/promise.h#L23-L77), [shell/common/gin_helper/promise.h:79-131](repo://shell/common/gin_helper/promise.h#L79-L131), [shell/browser/api/electron_api_dialog.cc:79-87](repo://shell/browser/api/electron_api_dialog.cc#L79-L87)

## Converters

Type conversion lives in `gin::Converter<T>` specializations, usually in `shell/common/gin_converters`. Each has `ToV8` and `FromV8`. `Converter<GURL>` goes through the URL's `spec()` string and builds a `GURL` back from a string. The callback converters turn a JavaScript function into a `base::RepeatingCallback` (wrapping a `SafeV8Function`), and a native callback into a JavaScript function; the comment explains that a fresh `FunctionTemplate` per conversion would leak because V8 caches them, so the produced function can be invoked only once. The directory also holds converters for geometry (`gfx_converter`), file paths, net objects, accelerators, images and native windows.

Sources: [shell/common/gin_converters/gurl_converter.h:15-31](repo://shell/common/gin_converters/gurl_converter.h#L15-L31), [shell/common/gin_converters/callback_converter.h:15-37](repo://shell/common/gin_converters/callback_converter.h#L15-L37), [shell/common/gin_converters/std_converter.h:34-130](repo://shell/common/gin_converters/std_converter.h#L34-L130)

Writing a new API means choosing these pieces, then following the repository's guide: add the files to `filenames.gni`, document the API, and implement the object template and `Wrappable`. The guide's own example still shows `gin::DeprecatedWrappable`; the shape the current code uses is the `Tray` one above. See [[API Documentation Pipeline]] and [[Build System]].

Sources: [docs/development/creating-api.md:7-47](repo://docs/development/creating-api.md#L7-L47), [shell/browser/api/electron_api_tray.h:38-56](repo://shell/browser/api/electron_api_tray.h#L38-L56)
