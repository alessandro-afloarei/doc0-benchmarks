---
title: "Context Bridge"
---
## Overview

With context isolation on, the page and the preload script run in different JavaScript worlds, each with its own globals. `contextBridge` is the only sanctioned way to pass a value from the preload's world into the page's. The JavaScript API is a thin wrapper, and the work happens in a native binding that copies or proxies each value across the boundary. This page covers the target world, the rules for copying values, and the proxies for functions. The renderer setup that turns on isolation is described in [[Renderer Initialization]], and the preload that calls the API is in [[Preload Scripts and Sandboxing]].

Sources: [lib/renderer/api/context-bridge.ts:1-22](repo://lib/renderer/api/context-bridge.ts#L1-L22)

## JavaScript surface

`contextBridge.exposeInMainWorld` and `exposeInIsolatedWorld` check that context isolation is on, and then call the binding's `exposeAPIInWorld` with a world ID. The main world is ID 0. `executeInMainWorld` runs a script string in the main world through `executeInWorld`.

Sources: [lib/renderer/api/context-bridge.ts:1-22](repo://lib/renderer/api/context-bridge.ts#L1-L22)

The file also exports an internal bridge, used by the renderer's own setup, which overrides globals in the isolated world. It is attached to the public object only in debug builds.

Sources: [lib/renderer/api/context-bridge.ts:24-39](repo://lib/renderer/api/context-bridge.ts#L24-L39)

## Choosing the target

`GetTargetContext` maps a world ID to a V8 context. In a page the ID is 0 for the main world, or any other ID for an isolated world. In a service worker Electron supports only the worker's main context and one isolated context, so any other ID is rejected.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:770-807](repo://shell/renderer/api/electron_api_context_bridge.cc#L770-L807)

`ExposeAPIInWorld` reads the calling context as the source, looks up the target, and passes both to `ExposeAPI`.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:808-822](repo://shell/renderer/api/electron_api_context_bridge.cc#L808-L822)

## Exposing a value

`ExposeAPI` refuses a key that already exists on the target `window`, which stops an API from replacing a page global. It then converts the value to a proxy in the target world with `PassValueToOtherContext`.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:733-752](repo://shell/renderer/api/electron_api_context_bridge.cc#L733-L752)

The proxy is attached to `window` read-only and non-configurable, with every object reachable from it deep-frozen. The `ContextBridgeMutability` feature, which is off by default, skips the freeze and makes the property writable.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:753-766](repo://shell/renderer/api/electron_api_context_bridge.cc#L753-L766)

Sources: [shell/renderer/api/electron_api_context_bridge.cc:36-39](repo://shell/renderer/api/electron_api_context_bridge.cc#L36-L39)

## How values cross

`PassValueToOtherContextInner` decides how each value is handled. Primitives such as strings, numbers, `null` and `undefined` pass through unchanged, because they have no identity. Any other value is looked up in the object cache first, so the same source object always gives the same proxy. A function is wrapped so that a call in the target world runs the source function. Plain objects and arrays are copied key by key, and a recursion limit stops deep or cyclic structures.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:153-200](repo://shell/renderer/api/electron_api_context_bridge.cc#L153-L200)

`PassValueToOtherContext` creates a fresh object cache for each call unless the caller passes one in. The cache is what keeps a repeated value, or a cycle, pointing at one proxy.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:469-490](repo://shell/renderer/api/electron_api_context_bridge.cc#L469-L490)

`ObjectCache` maps each source object to its proxy. It stores only objects, not primitives, and `CacheProxiedObject` replaces an earlier entry for the same key.

Sources: [shell/renderer/api/context_bridge/object_cache.cc:9-30](repo://shell/renderer/api/context_bridge/object_cache.cc#L9-L30)

## Function proxies

When the target world calls a proxied function, `ProxyFunctionWrapper` runs in the calling context. It converts the arguments back to the source world, calls the original function there, and converts the result the other way. The wrapper reads the flag for dynamic properties from its data object, and records the context it was called from.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:492-512](repo://shell/renderer/api/electron_api_context_bridge.cc#L492-L512)

`CreateProxyForAPI` builds the proxy object itself. It caches the new proxy before it copies any property, so a property that refers back to the object resolves to the same proxy.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:631-660](repo://shell/renderer/api/electron_api_context_bridge.cc#L631-L660)

## Overriding page globals

`OverrideGlobalValueFromIsolatedWorld` lets the renderer's own code replace a page global in the main world. `window.close` and `window.prompt` are replaced this way when context isolation is on, so the page sees the Electron version.

Sources: [shell/renderer/api/electron_api_context_bridge.cc:834-866](repo://shell/renderer/api/electron_api_context_bridge.cc#L834-L866)

Sources: [lib/renderer/window-setup.ts:7-25](repo://lib/renderer/window-setup.ts#L7-L25)
