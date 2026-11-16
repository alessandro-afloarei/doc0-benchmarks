---
title: "Renderer APIs and Context Bridge"
---
## Overview

Preload scripts run in a realm next to the page, and they reach the page only through `contextBridge`. This page covers the renderer-side JavaScript API that preload code sees, and the C++ code that copies values from the preload realm into the page's main world or an isolated world. The realm setup is on [[Renderer Startup and Realms]], and the IPC calls that preload code makes are on [[Inter-process Communication]].

Sources: [lib/renderer/api/context-bridge.ts:1-22](repo://lib/renderer/api/context-bridge.ts#L1-L22)

## The JavaScript API

`contextBridge` has three methods. `exposeInMainWorld` and `executeInMainWorld` pass world `0`, the page's own world, to the native binding. `exposeInIsolatedWorld` takes a caller-chosen world ID. Every method first checks that context isolation is on, and throws `contextBridge API can only be used when contextIsolation is enabled` otherwise.

Sources: [lib/renderer/api/context-bridge.ts:3-20](repo://lib/renderer/api/context-bridge.ts#L3-L20)

The internal object exposes `contextIsolationEnabled` and two helpers, `overrideGlobalValueFromIsolatedWorld` and its dynamic-properties variant. The second argument of the native call selects whether dynamic properties are supported.

Sources: [lib/renderer/api/context-bridge.ts:24-30](repo://lib/renderer/api/context-bridge.ts#L24-L30)

## Choosing the target world

`ExposeAPIInWorld` takes the caller's context as the source and finds the target context with `GetTargetContext`, which returns the context for the given world ID. If no target exists, the call returns without doing anything. The API then goes through `ExposeAPI`.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:808-822](repo://shell/renderer/api/electron_api_context_bridge.cc#L808-L822), [shell/renderer/api/electron_api_context_bridge.cc:775-783](repo://shell/renderer/api/electron_api_context_bridge.cc#L775-L783)

`ExposeAPI` refuses a key that already exists on the target window and throws `Cannot bind an API on top of an existing property`. It then copies the API object into the target context, passing the source global as the parent value.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:733-758](repo://shell/renderer/api/electron_api_context_bridge.cc#L733-L758)

By default the copied value is set as a read-only, non-configurable property. An object proxy is deep-frozen first, so page code cannot change the API surface the preload exposed. The `ContextBridgeMutability` feature, which is disabled by default, skips the freeze and makes the property writable.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:36-38](repo://shell/renderer/api/electron_api_context_bridge.cc#L36-L38), [shell/renderer/api/electron_api_context_bridge.cc:760-772](repo://shell/renderer/api/electron_api_context_bridge.cc#L760-L772)

## Copying values

`PassValueToOtherContext` creates a new object cache for the copy unless the caller passes one, and it then calls `PassValueToOtherContextInner` with the recursion depth at zero. The cache records each copy by its source object.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:469-490](repo://shell/renderer/api/electron_api_context_bridge.cc#L469-L490)

Plain objects are proxied rather than copied. `IsPlainObject` excludes null and undefined, dates, arguments objects, boxed primitives, errors, regular expressions, promises, maps and sets, so those kinds of values are not treated as plain. A plain object becomes a proxy that forwards each property access to the source, which means the page sees the preload's current state, not a snapshot.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:91-101](repo://shell/renderer/api/electron_api_context_bridge.cc#L91-L101), [shell/renderer/api/electron_api_context_bridge.cc:432-441](repo://shell/renderer/api/electron_api_context_bridge.cc#L432-L441)

A function is wrapped by a new V8 function that calls `ProxyFunctionWrapper`. The wrapper keeps the original function, its receiver and a flag for dynamic properties in private keys on a state object. When the page calls the wrapper, each argument and the return value is passed through `PassValueToOtherContext` again, so values crossing in either direction are copied or proxied.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:218-232](repo://shell/renderer/api/electron_api_context_bridge.cc#L218-L232), [shell/renderer/api/electron_api_context_bridge.cc:492-493](repo://shell/renderer/api/electron_api_context_bridge.cc#L492-L493), [shell/renderer/api/electron_api_context_bridge.cc:531-535](repo://shell/renderer/api/electron_api_context_bridge.cc#L531-L535)

Values that are neither plain objects nor functions go through the serializer. Those values are converted to a `CloneableMessage` and rebuilt in the target context, so they arrive as copies.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:443-446](repo://shell/renderer/api/electron_api_context_bridge.cc#L443-L446)

When an object is marked to support dynamic properties, its getters and setters are also passed through `PassValueToOtherContext`, so property reads and writes in the page reach the preload's functions.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:886-906](repo://shell/renderer/api/electron_api_context_bridge.cc#L886-L906)

## webFrame

`webFrame` is the renderer's view of the current frame. The module reads `mainFrame` and `WebFrame` from the `electron_renderer_web_frame` binding and sets the `WebFrame` prototype from the binding. It defines a deprecation warning for `routingId`, which points code to `frameToken`.

Sources: [lib/renderer/api/web-frame.ts:1-12](repo://lib/renderer/api/web-frame.ts#L1-L12)
