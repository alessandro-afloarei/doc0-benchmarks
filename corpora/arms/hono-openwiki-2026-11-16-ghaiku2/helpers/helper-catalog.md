---
type: reference
title: Helper Modules Catalog
description: Catalog of the src/helper modules (accepts, adapter, conninfo, cookie, css, dev, factory, html, proxy, route, ssg, streaming, testing, websocket) with what each provides, how it depends on Context and the core, and deeper notes on the SSG, streaming, testing, and proxy subsystems.
tags: [hono, helpers, ssg, streaming, cookie, testing, proxy, websocket, factory]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-c2f00f3388df41550f8e1be3
    resource: repo://src/helper/cookie/index.ts
  - id: openwiki-source-078e424275628129af3d399b
    resource: repo://src/helper/factory/index.ts
  - id: openwiki-source-74d5a36263746a532479616f
    resource: repo://src/helper/proxy/index.ts
  - id: openwiki-source-b754619017173a238365c1a8
    resource: repo://src/helper/ssg/plugins.ts
  - id: openwiki-source-0fe126e6c9385affa2b50eb6
    resource: repo://src/helper/ssg/ssg.ts
  - id: openwiki-source-8025a55f0c82c98b2ca3f551
    resource: repo://src/helper/streaming/stream.ts
  - id: openwiki-source-877a31a73fadd9d3f8972d6d
    resource: repo://src/helper/testing/index.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Helper Modules Catalog

<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Helpers live in `src/helper/` and are published as `hono/<name>` subpaths. Unlike middleware, most helpers are plain functions or classes that an application calls from its handlers; they do not register themselves with an app. Some, such as `hono/testing` and `hono/ssg`, depend on the core `Hono` class and are only used at development or build time. The shared runtime-facing helpers (`adapter`, `conninfo`, `websocket`) are re-used by the runtime adapters (see [Runtime Adapters](/openwiki/adapters/runtime-adapters.md)).

## Inventory

| Helper | Subpath | Role |
| --- | --- | --- |
| `accepts` | `hono/accepts` | Negotiate the best media type, language, or encoding from the `Accept*` headers. |
| `adapter` | `hono/adapter` | `env(c)` for reading environment variables per runtime, and `getRuntimeKey()`. |
| `conninfo` | `hono/conninfo` | Types for client address info (`ConnInfo`, `GetConnInfo`) that adapters implement. |
| `cookie` | `hono/cookie` | Get, set, delete, and signed-cookie helpers on `Context`. |
| `css` | `hono/css` | CSS-in-JS helpers: `css`, `cx`, `keyframes`, `viewTransition`, and `Style`, created from a default context by `createCssContext`. |
| `dev` | `hono/dev` | `inspectRoutes`, `showRoutes`, `getRouterName` for debugging route tables. |
| `factory` | `hono/factory` | `createFactory`, `Factory`, and `createMiddleware` for typed handlers and apps. |
| `html` | `hono/html` | `html` tagged template with escaping, and `raw` to mark trusted strings. |
| `proxy` | `hono/proxy` | A `fetch`-compatible proxy that forwards a request to another origin. |
| `route` | `hono/route` | Inspect the matched route from `Context`: `matchedRoutes`, `routePath`, `baseRoutePath`, `basePath`. |
| `ssg` | `hono/ssg` | Static site generation: `toSSG`, plugins, `ssgParams`, and SSG-aware middleware. |
| `streaming` | `hono/streaming` | `stream`, `streamText`, and `streamSSE` for chunked and server-sent responses. |
| `testing` | `hono/testing` | `testClient(app)`, a typed client that calls `app.request` in-process. |
| `websocket` | `hono/ws` | `defineWebSocketHelper`, `WSContext`, and the event types used by adapter WebSocket helpers. |

## Dependencies on Context and the core

Helpers fall into three groups:

<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Context-bound.** `cookie`, `route`, `streaming`, `accepts`, and `conninfo` read from or write to a `Context`. Cookie setters call `c.header` for `Set-Cookie` (see [Context and HonoRequest](/openwiki/architecture/context-and-request.md)).
- **App-bound.** `dev`, `factory`, `testing`, and `ssg` take a `Hono` app as input and inspect its `routes` list or call `app.fetch` / `app.request`.
- **Standalone.** `html`, `css`, and `proxy` work with strings, `Request` and `Response` objects, and do not require a context.

## Cookies

`src/helper/cookie/index.ts` provides `getCookie`, `setCookie`, `deleteCookie`, and the signed variants. Signed cookies use `generateSignedCookie` and `setSignedCookie`, which are async because the signature is computed asynchronously. The `prefix: 'secure'` option prepends `__Secure-` to the cookie name and forces `secure: true` and `path: '/'`. These helpers only compute and emit header values; the parsing side is shared with the request side of `Context`.

## Factory

`Factory` (`src/helper/factory/index.ts`) holds an optional `initApp` function and default app options. `createApp(options)` merges the defaults with the call's options, constructs a `Hono`, and runs `initApp(app)` on it. `createFactory()` returns a factory with typed `createHandlers` and `createMiddleware`, which is the usual way to share environment and variable types across files without repeating generics.

## SSG

`toSSG` in `src/helper/ssg/ssg.ts` generates static files from an app. It works in these steps:

1. Gather the list of routes to render from the app's routes, plus any parameter values supplied by `ssgParams` middleware. `fetchRoutesContent` (line 205) issues requests through `app.fetch` with an environment flag `SSG_CONTEXT` set, so handlers can detect generation with `isSSGContext(c)`.
2. Run each request through the configured plugins. Plugins supply hooks: `beforeRequestHook`, `afterResponseHook`, and `afterGenerateHook`. Hooks are combined in order, and a hook can return `false` to skip the output for that route.
3. Write each response to the output directory through the supplied file-system module (`denoFileSystemModule` and `bunFileSystemModule` in the adapters). The file extension is looked up in `extensionMap`, which defaults to `defaultExtensionMap`.

Two plugins ship with the module. `defaultPlugin()` skips any response whose status is not `200`. `redirectPlugin()` handles redirect status codes (301, 302, 303, 307, 308), and its doc comment says it must be listed before `defaultPlugin` because `defaultPlugin` would otherwise skip the redirect first. `disableSSG()` and `onlySSG()` are middleware that check the `SSG_CONTEXT` flag, and a handler can opt out by setting the `x-hono-disable-ssg` response header.

## Streaming

`src/helper/streaming/stream.ts` exports `stream(c, callback, onError?)`. It creates a `TransformStream`, wraps the writable side in a `StreamingApi`, stores the context in a `WeakMap` keyed by the readable side, because the source comment notes that Bun destroys the context once the response is returned, so the context is held until streaming ends. The callback runs inside an async function that is not awaited by `stream` itself. The returned `Response` is built from the readable side. An error inside the callback is passed to `onError` when provided.

`streamSSE` in `sse.ts` builds on `StreamingApi` with `SSEStreamingApi`, which formats `SSEMessage` values (`event`, `data`, `id`, `retry`) as server-sent event frames. `streamText` in `text.ts` is the same pattern for `text/plain`. `isOldBunVersion()` in `utils.ts` enables an abort listener on older Bun releases that did not cancel streams when the client disconnected.

## Testing

<!-- openwiki: broken internal link [/openwiki/client/hc-rpc-client.md] link "/openwiki/client/hc-rpc-client.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`testClient(app, env?, executionCtx?, options?)` in `src/helper/testing/index.ts` builds an `hc` client whose `fetch` is `app.request(input, init, env, executionCtx)`. It therefore exercises the full dispatch path in process, with no network. The base URL is `http://localhost`. Type inference is the same as the RPC client (see [Typed RPC Client (hc)](/openwiki/client/hc-rpc-client.md)).

## Proxy

`proxy(input, init?)` in `src/helper/proxy/index.ts` forwards a request to an upstream URL. Before sending, it removes hop-by-hop headers listed in RFC 2616 section 13.5.1 (`connection`, `keep-alive`, `transfer-encoding`, and others), and checks header names against the RFC 9110 token pattern. `strictConnectionProcessing` removes the headers named in `Connection` as well. A custom `customFetch` replaces the network call, which is useful for tests and for routing through another handler.

## Routes and development

<!-- openwiki: broken internal link [/openwiki/architecture/routing.md] link "/openwiki/architecture/routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/helper/route/index.ts` reads the matched route through `Context`: `matchedRoutes(c)` returns every route that matched, `routePath(c, index)` returns the route pattern (for example `/posts/:id`), and `baseRoutePath` and `basePath` return the mounting prefix. `src/helper/dev/index.ts` provides `inspectRoutes(app)` and `showRoutes(app)`, which print the route table and the active router name (`getRouterName` returns `SmartRouter + RegExpRouter` style names; see [Routing and Router Implementations](/openwiki/architecture/routing.md)).

## Invariants and consequences

<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Helpers that write headers (`cookie`, `streaming`) call through `Context`, so they inherit the rules for finalized responses described in [Context and HonoRequest](/openwiki/architecture/context-and-request.md).
- SSG requests carry the `SSG_CONTEXT` env flag, so code that behaves differently at build time must check `isSSGContext` rather than an environment variable.
- The `proxy` helper removes hop-by-hop headers by default; applications that need them must opt in through `strictConnectionProcessing` or by setting them explicitly.

## Related pages

<!-- openwiki: broken internal link [/openwiki/middleware/middleware-catalog.md] link "/openwiki/middleware/middleware-catalog.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Built-in Middleware Catalog](/openwiki/middleware/middleware-catalog.md)
<!-- openwiki: broken internal link [/openwiki/adapters/runtime-adapters.md] link "/openwiki/adapters/runtime-adapters.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Runtime Adapters](/openwiki/adapters/runtime-adapters.md)
