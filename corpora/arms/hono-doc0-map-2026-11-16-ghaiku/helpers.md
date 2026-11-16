---
title: "Helper Catalogue"
---
## Overview

Helpers are functions and objects that a handler or a setup script imports from `hono/<name>`. Each helper lives in its own folder under `src/helper`, and none of them is needed to run an app. This page groups them by what they do, says what each one is for, and links the helpers that have their own page. The runtime-specific helpers, such as `serveStatic` and `upgradeWebSocket`, are listed with their adapters in [[Runtime Adapters]].

Sources: [src/helper/streaming/index.ts:6-9](repo://src/helper/streaming/index.ts#L6-L9), [src/helper/cookie/index.ts:27-27](repo://src/helper/cookie/index.ts#L27-L27)

## Streaming

- `stream` runs a callback with a `StreamingApi` and returns a `Response` whose body the callback writes to.
- `streamText` is `stream` with a text content type.
- `streamSSE` sends server-sent events, and `SSEStreamingApi` is the object it passes to its callback.

Sources: [src/helper/streaming/index.ts:6-9](repo://src/helper/streaming/index.ts#L6-L9)

The `stream` helper sets up a `TransformStream` and hands its writable side to the callback. On old Bun versions it also aborts the stream when the request is aborted, because those versions did not call `cancel` on the response body.

Sources: [src/helper/streaming/index.ts:6-9](repo://src/helper/streaming/index.ts#L6-L9), [src/helper/streaming/stream.ts:7-20](repo://src/helper/streaming/stream.ts#L7-L20), [src/helper/streaming/sse.ts:72-80](repo://src/helper/streaming/sse.ts#L72-L80)

## Cookies and connection data

- `getCookie` and `setCookie` read and write cookies on the context, and `deleteCookie` removes one.
- `getSignedCookie` and `setSignedCookie` do the same for cookies that carry a signature.
- `getConnInfo` is exported by each adapter, and the core package exports only the types for it.

Sources: [src/helper/cookie/index.ts:27-27](repo://src/helper/cookie/index.ts#L27-L27), [src/helper/cookie/index.ts:50-50](repo://src/helper/cookie/index.ts#L50-L50), [src/helper/cookie/index.ts:99-99](repo://src/helper/cookie/index.ts#L99-L99), [src/helper/cookie/index.ts:130-141](repo://src/helper/cookie/index.ts#L130-L141), [src/helper/conninfo/index.ts:1-6](repo://src/helper/conninfo/index.ts#L1-L6)

## Content negotiation

`accepts` reads the request's `Accept` header and returns the best match from the list the caller gives.

Sources: [src/helper/accepts/accepts.ts:40-40](repo://src/helper/accepts/accepts.ts#L40-L40)

## Response markup and styles

- `html` is a tagged template that escapes interpolated values, and `raw` marks a string as already safe. The escaping is the same one the JSX renderer uses, which [[JSX Server Rendering]] describes.
- `css` and `cx` build class names from style objects. `Style` is exported beside them.

Sources: [src/helper/html/index.ts:9-27](repo://src/helper/html/index.ts#L9-L27), [src/helper/css/index.ts:234-262](repo://src/helper/css/index.ts#L234-L262)

## App structure

- `createFactory` returns a `Factory` whose `createMiddleware` and handler helpers carry the app's binding and variable types, so they can be reused across routes.
- `matchedRoutes`, `routePath`, `baseRoutePath` and `basePath` read the route that matched the request, as stored by [[Registering Routes]].
- `showRoutes` and `inspectRoutes` print or return the route table, and `getRouterName` reports which router the app uses.

Sources: [src/helper/factory/index.ts:363-368](repo://src/helper/factory/index.ts#L363-L368), [src/helper/route/index.ts:32-32](repo://src/helper/route/index.ts#L32-L32), [src/helper/dev/index.ts:27-39](repo://src/helper/dev/index.ts#L27-L39), [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79)

## WebSocket

`WSContext` is the class that wraps one WebSocket connection, and `defineWebSocketHelper` is exported beside it. The `upgradeWebSocket` functions that start a connection come from the adapters, as [[Runtime Adapters]] lists.

Sources: [src/helper/websocket/index.ts:70-92](repo://src/helper/websocket/index.ts#L70-L92), [src/helper/websocket/index.ts:111-111](repo://src/helper/websocket/index.ts#L111-L111), [src/adapter/bun/index.ts:8-8](repo://src/adapter/bun/index.ts#L8-L8)

## Testing and proxying

- `testClient` wraps an app in the typed client, as [[Typed Client]] describes.
- `proxy` forwards a request to another URL and returns its response, with options for the outgoing request.

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27), [src/helper/proxy/index.ts:160-160](repo://src/helper/proxy/index.ts#L160-L160)

## Pages

- [[Static Site Generation]] covers `toSSG`, which is also exported by the adapters.
- [[Built-in Middleware]] lists the middleware modules, which are separate from these helpers.

Sources: [src/helper/ssg/ssg.ts:368-368](repo://src/helper/ssg/ssg.ts#L368-L368)
