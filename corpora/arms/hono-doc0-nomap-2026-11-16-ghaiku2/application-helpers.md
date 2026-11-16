---
title: "Response and Application Helpers"
---
## Overview

These helpers either produce a response or support the app around its handlers: `hono/streaming` sends a body in parts, `hono/html` and `hono/css` build markup and styles, `hono/websocket` defines socket handlers, `hono/factory` creates typed handlers and middleware, `hono/route` reads the matched route, `hono/testing` calls an app without a server, `hono/dev` prints the route table, and `hono/ssg` renders a site to files. The request-reading helpers are in [[Request and Connection Helpers]], and the response object they return to is in [[Context]].

Sources: [src/helper/streaming/index.ts:6-9](repo://src/helper/streaming/index.ts#L6-L9), [src/helper/html/index.ts:11-20](repo://src/helper/html/index.ts#L11-L20), [src/helper/websocket/index.ts:111-116](repo://src/helper/websocket/index.ts#L111-L116)

## Streaming

`stream(c, cb)` creates a `TransformStream`, runs the callback with a `StreamingApi` that writes to its writable side, and returns a `Response` whose body is the readable side. The callback runs without being awaited, so the response starts before the body is complete. `streamText` does the same and sets `Content-Type` to plain text with `X-Content-Type-Options: nosniff`.

Sources: [src/helper/streaming/stream.ts:7-16](repo://src/helper/streaming/stream.ts#L7-L16), [src/helper/streaming/text.ts:6-12](repo://src/helper/streaming/text.ts#L6-L12)

`streamSSE(c, cb)` works the same way with an `SSEStreamingApi`, whose `writeSSE` method writes `data`, `event`, `id` and `retry` fields in the `text/event-stream` format. An error thrown by `cb` is passed to `onError` when one is given.

Sources: [src/helper/streaming/sse.ts:72-82](repo://src/helper/streaming/sse.ts#L72-L82), [src/helper/streaming/index.ts:7-8](repo://src/helper/streaming/index.ts#L7-L8)

Older Bun versions do not call `cancel()` on a stream returned from `Bun.serve()`, so both helpers listen for the request's `abort` signal in that case and close the stream themselves.

Sources: [src/helper/streaming/stream.ts:13-16](repo://src/helper/streaming/stream.ts#L13-L16), [src/helper/streaming/sse.ts:78-82](repo://src/helper/streaming/sse.ts#L78-L82)

## HTML and CSS

`html` is a tagged template. Each interpolated value is escaped unless it is marked with `raw()`, and arrays and promises are resolved into the same buffer, so the result is a single string-like value that `c.html()` accepts.

Sources: [src/helper/html/index.ts:11-20](repo://src/helper/html/index.ts#L11-L20), [src/utils/html.ts:40-44](repo://src/utils/html.ts#L40-L44), [src/utils/html.ts:90-92](repo://src/utils/html.ts#L90-L92)

`hono/css` creates a context with `createCssContext`, which generates class names for styles written with `css`, `keyframes` and `viewTransition`. The `cx` function joins class names, and `Style` renders the collected rules into a `<style>` element. The module exports a default context, so these names are ready without a setup call.

Sources: [src/helper/css/index.ts:72-74](repo://src/helper/css/index.ts#L72-L74), [src/helper/css/index.ts:234-262](repo://src/helper/css/index.ts#L234-L262)

## WebSockets

`defineWebSocketHelper` builds an `upgradeWebSocket` function for one runtime. The handler it receives is the runtime-specific part, and the result takes a function that creates the event handlers for each request. The Bun, Deno and Cloudflare Workers adapters each call `defineWebSocketHelper` with their own upgrade logic, so application code calls `upgradeWebSocket` the same way on each of them.

Sources: [src/helper/websocket/index.ts:111-125](repo://src/helper/websocket/index.ts#L111-L125), [src/helper/websocket/index.ts:70-92](repo://src/helper/websocket/index.ts#L70-L92)

## Factory

`createFactory()` returns a `Factory` whose `createHandlers` and `createMiddleware` methods have the environment and path types already set, so handlers written with them share one type. `createMiddleware` is also exported on its own for middleware that do not need a factory.

Sources: [src/helper/factory/index.ts:332-336](repo://src/helper/factory/index.ts#L332-L336), [src/helper/factory/index.ts:363-366](repo://src/helper/factory/index.ts#L363-L366), [src/helper/factory/index.ts:368-372](repo://src/helper/factory/index.ts#L368-L372)

## Route information

`matchedRoutes(c)` returns the list of routes that matched the request. `routePath(c, index)` returns the path of the route at `index`, defaulting to the current route index, and `baseRoutePath` and `basePath` return the same values for the route's base path. They read the match result that [[Request Dispatch]] stored on the context.

Sources: [src/helper/route/index.ts:32-33](repo://src/helper/route/index.ts#L32-L33), [src/helper/route/index.ts:58-60](repo://src/helper/route/index.ts#L58-L60), [src/helper/route/index.ts:82-84](repo://src/helper/route/index.ts#L82-L84), [src/helper/route/index.ts:107-110](repo://src/helper/route/index.ts#L107-L110)

## Testing

`testClient(app)` returns the typed `hc` client for an app, with its `fetch` replaced by `app.request`. Requests from the client therefore go through the app's own dispatch without a server, and the client keeps the types of the app's schema, as [[Typed Client]] describes.

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

## Dev and SSG

`inspectRoutes(app)` returns one record per route, and `showRoutes(app, options)` prints them. `getRouterName` matches one dummy `GET /` request so that a `SmartRouter` settles on its router, then returns the router's `name`, which shows which implementation the app is using.

Sources: [src/helper/dev/index.ts:27-39](repo://src/helper/dev/index.ts#L27-L39), [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79)

The SSG helper exports the `ssgParams`, `disableSSG` and `onlySSG` middleware and the `defaultPlugin` and `redirectPlugin` plugins. The rendering itself is done by a runtime's `toSSG`, which reads the file system through that runtime's module, as [[Runtime Adapters]] lists.

Sources: [src/helper/ssg/index.ts:6-14](repo://src/helper/ssg/index.ts#L6-L14), [src/adapter/bun/ssg.ts:25-27](repo://src/adapter/bun/ssg.ts#L25-L27)
