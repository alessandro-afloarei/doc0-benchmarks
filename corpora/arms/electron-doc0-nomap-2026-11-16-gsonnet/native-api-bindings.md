---
title: "Exposing Native APIs to JavaScript"
---
## Overview

Electron's public API is two layers. The bottom layer is C++: classes under `shell/` derive from helpers in `shell/common/gin_helper`, which make them V8 objects whose lifetime follows the JavaScript wrapper. Each file that exposes such classes registers a Node.js "linked binding". The top layer is TypeScript under `lib/`: a file per module fetches the binding with `process._linkedBinding`, adds behaviour in JavaScript, and a lazy module list turns all of them into properties of the `electron` module. The C++ side is registered per process type by [[Node.js and Chromium Event Loop Integration]]; this page follows one binding from class to `require('electron')`.

Sources: [shell/browser/api/electron_api_screen.cc:215-233](repo://shell/browser/api/electron_api_screen.cc#L215-L233), [lib/browser/api/screen.ts:1-11](repo://lib/browser/api/screen.ts#L1-L11), [lib/browser/api/exports/electron.ts:1-8](repo://lib/browser/api/exports/electron.ts#L1-L8)

## Wrapping C++ objects

`gin_helper::WrappableBase` holds a weak `v8::Global` to the JS wrapper. Its header comment states the rule: constructors should be private with a static `Create` returning a `gin_helper::Handle`, because the weak callback from the wrapper is what deletes the C++ object, and an object without a wrapper would leak. `Wrappable<T>` adds the function template: `SetConstructor` builds a template whose instance has one internal field and whose prototype is filled by the class's static `BuildPrototype`; `GetConstructor` creates and caches it per isolate.

Sources: [shell/common/gin_helper/wrappable_base.h:20-65](repo://shell/common/gin_helper/wrappable_base.h#L20-L65), [shell/common/gin_helper/wrappable.h:31-72](repo://shell/common/gin_helper/wrappable.h#L31-L72)

A second family, `DeprecatedWrappable<T>`, is a copy of a Chromium change and is marked in the header for removal; classes that use it supply a `kWrapperInfo`, `GetObjectTemplateBuilder` and `GetTypeName` instead of `BuildPrototype`.

Sources: [shell/common/gin_helper/wrappable_base.h:67-105](repo://shell/common/gin_helper/wrappable_base.h#L67-L105), [shell/common/gin_helper/wrappable.h:93-109](repo://shell/common/gin_helper/wrappable.h#L93-L109)

## Events and tracked objects

`gin_helper::EventEmitter<T>` extends `Wrappable<T>` with `Emit`, which creates an `Event` object, calls the JS `emit` with the event first and the arguments after it, and returns whether `preventDefault` was called. `EmitWithoutEvent` omits the event object. This is why listeners in Electron's API receive an event argument before their data. `EventEmitterMixin<T>` offers the same two methods to `DeprecatedWrappable` classes, and its template inherits from the shared event emitter template.

Sources: [shell/common/gin_helper/event_emitter.h:19-51](repo://shell/common/gin_helper/event_emitter.h#L19-L51), [shell/browser/event_emitter_mixin.h:19-72](repo://shell/browser/event_emitter_mixin.h#L19-L72)

Where objects need to be found again by a numeric id, they derive from `TrackableObject<T>`, which is an `EventEmitter<T>` that also registers its wrapper in a per-class `KeyWeakMap` when initialised. `FromWeakMapID`, `GetAll` and `FromWrappedClass` look objects up; `AttachAsUserData` stores the id on a Chromium `SupportsUserData`, which is how a native window can find its JS `BaseWindow`. The map is leaked on purpose and the object removes itself on destruction.

Sources: [shell/common/gin_helper/trackable_object.h:22-131](repo://shell/common/gin_helper/trackable_object.h#L22-L131), [shell/common/gin_helper/trackable_object.cc:49-63](repo://shell/common/gin_helper/trackable_object.cc#L49-L63)

The JavaScript prototype of every emitter comes from Node: `lib/browser/init.ts` and `lib/utility/init.ts` each call the `electron_browser_event_emitter` binding's `setEventEmitterPrototype` with `EventEmitter.prototype`, and C++ later reads it back through `GetEventEmitterPrototype`.

Sources: [shell/browser/api/electron_api_event_emitter.cc:17-48](repo://shell/browser/api/electron_api_event_emitter.cc#L17-L48), [lib/browser/init.ts:19-19](repo://lib/browser/init.ts#L19-L19), [lib/utility/init.ts:16-16](repo://lib/utility/init.ts#L16-L16)

## Registering a binding

Each binding file ends by naming itself with `NODE_LINKED_BINDING_CONTEXT_AWARE` and an `Initialize` function. `Initialize` receives the `exports` object and fills it. For a class it installs a constructor; for a singleton it installs a factory.

Sources: [shell/browser/api/electron_api_browser_window.cc:340-349](repo://shell/browser/api/electron_api_browser_window.cc#L340-L349), [shell/browser/api/electron_api_screen.cc:222-231](repo://shell/browser/api/electron_api_screen.cc#L222-L231)

```cpp
void Initialize(v8::Local<v8::Object> exports,
                v8::Local<v8::Value> unused,
                v8::Local<v8::Context> context,
                void* priv) {
  v8::Isolate* const isolate = electron::JavascriptEnvironment::GetIsolate();
  gin_helper::Dictionary dict{isolate, exports};
  dict.Set("BrowserWindow",
           gin_helper::CreateConstructor<BrowserWindow>(
               isolate, base::BindRepeating(&BrowserWindow::New)));
}
...
NODE_LINKED_BINDING_CONTEXT_AWARE(electron_browser_window, Initialize)
```

Sources: [shell/browser/api/electron_api_browser_window.cc:340-353](repo://shell/browser/api/electron_api_browser_window.cc#L340-L353)

The macro does not run at load time. `node_bindings.cc` forward-declares a `_register_<name>` function for each entry of its per-process lists and calls them explicitly from `RegisterBuiltinBindings`; its comment says this avoids `__attribute__((constructor))`. A binding therefore only exists in a process whose list includes it: browser modules such as `electron_browser_window` are listed only for the browser process, `electron_renderer_ipc` and `electron_renderer_context_bridge` for renderers.

Sources: [shell/common/node_bindings.cc:53-128](repo://shell/common/node_bindings.cc#L53-L128), [shell/common/node_bindings.cc:531-547](repo://shell/common/node_bindings.cc#L531-L547)

## From binding to `electron`

On the TypeScript side a module reads its binding at the top of the file. Some simply re-export it, as `native-theme.ts` does; others extend the native prototype. `BrowserWindow`, for example, re-parents its prototype onto `BaseWindow.prototype`, defines `_init`, and forwards `loadURL` to its web contents: see [[Windows, Views and WebContents]].

Sources: [lib/browser/api/native-theme.ts:1-3](repo://lib/browser/api/native-theme.ts#L1-L3), [lib/browser/api/browser-window.ts:1-31](repo://lib/browser/api/browser-window.ts#L1-L31), [lib/browser/api/browser-window.ts:133-139](repo://lib/browser/api/browser-window.ts#L133-L139)

`module-list.ts` lists every main-process module as `{ name, loader }`, with a `require` inside the loader so nothing is loaded until it is used. The file's header comment warns that updating it also requires updating a module-keys file.

Sources: [lib/browser/api/module-list.ts:1-43](repo://lib/browser/api/module-list.ts#L1-L43)

`defineProperties` turns each entry into an enumerable getter, unwrapping ES module defaults. `exports/electron.ts` applies it for the common list and the browser list, so `require('electron').app` is evaluated on first access.

Sources: [lib/common/define-properties.ts:7-17](repo://lib/common/define-properties.ts#L7-L17), [lib/browser/api/exports/electron.ts:1-8](repo://lib/browser/api/exports/electron.ts#L1-L8)

```ts
const handleESModule = (loader: ElectronInternal.ModuleLoader) => () => {
  const value = loader();
  if (value.__esModule && value.default) return value.default;
  return value;
};
```

Sources: [lib/common/define-properties.ts:1-17](repo://lib/common/define-properties.ts#L1-L17), [lib/browser/api/exports/electron.ts:1-8](repo://lib/browser/api/exports/electron.ts#L1-L8)

Every process type has its own list and export file. The renderer exposes `clipboard`, `contextBridge`, `crashReporter`, `ipcRenderer`, `webFrame` and `webUtils` plus the common modules; the common list holds `nativeImage` and `shell`. The sandboxed renderer builds from one list of its own: `contextBridge`, `crashReporter`, `ipcRenderer`, `nativeImage`, `webFrame` and `webUtils`, with no `clipboard` or `shell`. The webpack aliases that point `electron` at the right export file for each bundle are described in [[JavaScript Bundles and the GN Build Pipeline]].

Sources: [lib/common/api/module-list.ts:1-5](repo://lib/common/api/module-list.ts#L1-L5), [lib/renderer/api/module-list.ts:1-9](repo://lib/renderer/api/module-list.ts#L1-L9), [lib/sandboxed_renderer/api/module-list.ts:1-26](repo://lib/sandboxed_renderer/api/module-list.ts#L1-L26), [lib/renderer/api/exports/electron.ts:1-8](repo://lib/renderer/api/exports/electron.ts#L1-L8)

All the name variants (`electron`, `electron/main`, `electron/renderer`, `electron/common`, `electron/utility`) resolve to this one module at runtime: see [[Node.js and Chromium Event Loop Integration]].

Sources: [lib/common/init.ts:92-119](repo://lib/common/init.ts#L92-L119)

## Example: the `screen` module

`Screen` is a `DeprecatedWrappable` with `EventEmitterMixin` and a `display::DisplayObserver`. Its object template lists the methods and the platform-conditional ones, and `Create` refuses to run before the app is ready or if no display screen exists.

Sources: [shell/browser/api/electron_api_screen.cc:175-213](repo://shell/browser/api/electron_api_screen.cc#L175-L213), [shell/browser/api/electron_api_screen.h:27-38](repo://shell/browser/api/electron_api_screen.h#L27-L38)

Its binding does not export the object itself but a `createScreen` function. Since the screen cannot be created before `ready`, `screen.ts` exports a `Proxy` that calls `createScreen` on first property access and forwards `get`, `set`, `ownKeys`, `has` and `getOwnPropertyDescriptor` to it, binding methods on the way. Its `getPrototypeOf` trap returns `EventEmitter.prototype`, which the comment attributes to the interaction between `EventEmitterMixin` and the function template.

Sources: [shell/browser/api/electron_api_screen.cc:215-233](repo://shell/browser/api/electron_api_screen.cc#L215-L233), [lib/browser/api/screen.ts:1-48](repo://lib/browser/api/screen.ts#L1-L48)

Because C++ drives the display observer, change notifications are posted as tasks that emit named events later, rather than being emitted synchronously from inside the observer callback.

Sources: [shell/browser/api/electron_api_screen.cc:120-135](repo://shell/browser/api/electron_api_screen.cc#L120-L135)
