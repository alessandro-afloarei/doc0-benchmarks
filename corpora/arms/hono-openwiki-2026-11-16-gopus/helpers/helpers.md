---
type: reference
title: Helpers
description: The non-middleware helper modules under src/helper — cookie, factory, streaming (stream, streamText, streamSSE), proxy, SSG (toSSG, ssgParams), testing (testClient), dev (showRoutes, getRouterName), route, accepts and css — what they do and how they interact with Context and the app.
tags: [helpers, cookie, streaming, sse, proxy, ssg, factory, testing, css]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-8b8b0e6691c2db687dee0885
    resource: repo://src/helper/accepts/accepts.ts
  - id: openwiki-source-c2f00f3388df41550f8e1be3
    resource: repo://src/helper/cookie/index.ts
  - id: openwiki-source-3f907dd5d3367ef4be8829b4
    resource: repo://src/helper/dev/index.ts
  - id: openwiki-source-078e424275628129af3d399b
    resource: repo://src/helper/factory/index.ts
  - id: openwiki-source-74d5a36263746a532479616f
    resource: repo://src/helper/proxy/index.ts
  - id: openwiki-source-e408144592bb9f8eeca54b23
    resource: repo://src/helper/ssg/middleware.ts
  - id: openwiki-source-b754619017173a238365c1a8
    resource: repo://src/helper/ssg/plugins.ts
  - id: openwiki-source-0fe126e6c9385affa2b50eb6
    resource: repo://src/helper/ssg/ssg.ts
  - id: openwiki-source-d6a55cbd155814ed0340548e
    resource: repo://src/helper/ssg/utils.ts
  - id: openwiki-source-03552d4b400a4485be6e5ac2
    resource: repo://src/helper/streaming/sse.ts
  - id: openwiki-source-8025a55f0c82c98b2ca3f551
    resource: repo://src/helper/streaming/stream.ts
  - id: openwiki-source-f316cf3c3646484fce3f9d04
    resource: repo://src/helper/streaming/text.ts
  - id: openwiki-source-877a31a73fadd9d3f8972d6d
    resource: repo://src/helper/testing/index.ts
  - id: openwiki-source-a49b959930b2834e410ba9de
    resource: repo://src/utils/cookie.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Helpers

Helpers are plain functions that take a `Context`, or an app, and are published under their own subpaths (`hono/cookie`, `hono/streaming`, and so on). Middleware is registered with `app.use()`; helpers are called from inside handlers, or from build scripts. Two neighbouring topics have their own pages: runtime-specific helpers (`conninfo`, `ws`, `adapter`) are covered in [Runtime adapters](../integrations/runtime-adapters.md), and `html`/`raw` are covered in [JSX engine](../jsx/jsx.md).

## Cookie (`hono/cookie`)

The helper is in `src/helper/cookie/index.ts`; parsing and serialization are in `src/utils/cookie.ts`.

- `getCookie(c, key?, prefix?)` parses the request `Cookie` header. `prefix: 'secure' | 'host'` reads `__Secure-key` or `__Host-key` instead of `key`.
- `setCookie(c, name, value, opt)` *appends* a `Set-Cookie` header through `c.header(..., { append: true })`. The default path is `/`.
  - `prefix: 'secure'` forces `secure`.
  - `prefix: 'host'` forces `secure`, `path=/`, and no `domain`.
- `deleteCookie` sets an empty value with `maxAge: 0` and returns the previous value.
- `getSignedCookie` / `setSignedCookie` sign the value with HMAC-SHA-256 through Web Crypto. A cookie whose signature does not verify is returned as `false`.
- `serialize` enforces the RFC rules. It throws on:
  - an invalid cookie name;
  - `;`, CR or LF in attribute values;
  - `__Secure-`/`__Host-` prefix rules being violated;
  - `Partitioned` without `Secure`;
  - `Max-Age` or `Expires` more than 400 days ahead.

Because `c.res` preserves `Set-Cookie` values when a later handler replaces the response (see [Context](../concepts/context-and-request.md)), cookies set in middleware before `next()` survive.

## Factory (`hono/factory`)

`createFactory<Env>({ initApp?, defaultAppOptions? })` returns a `Factory` with these methods:

- `createApp(options?)`: a new `Hono` with the default options merged in, after which `initApp(app)` runs.
- `createMiddleware(fn)`: an identity function that exists to carry the `Env`, `Input` and response types.
- `createHandlers(...handlers)`: returns the handlers as an array, removing `undefined` entries, while keeping the full type inference of an inline `app.get(path, ...handlers)` call.

A standalone `createMiddleware` is also exported. These helpers matter for typing, not for runtime behaviour: they keep `c.var` and validator inputs typed in handlers defined outside the route chain.

## Streaming (`hono/streaming`)

`stream(c, cb, onError?)`, `streamText(c, cb, onError?)` and `streamSSE(c, cb, onError?)` wrap a `TransformStream` in a `StreamingApi` (`src/utils/stream.ts`). The API offers `write`, `writeln`, `sleep`, `pipe`, `close`, `abort` and `onAbort`.

- Each helper returns `c.newResponse(readable)` **immediately**, then runs `cb` asynchronously. The stream is always closed in `finally`.
- An `Error` thrown inside `cb` is passed to `onError` if one was given. Otherwise it is logged with `console.error`. `stream()` ignores an `undefined` rejection, which is what happens when the reader cancels.
- `streamSSE` sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive` and `Transfer-Encoding: chunked`. `writeSSE({ data, event, id, retry })`:
  - splits multi-line data into separate `data:` lines;
  - throws if `event`, `id` or `retry` contain CR or LF;
  - resolves `HtmlEscapedString` or Promise data, so JSX can be streamed.

  After `onError` handles an error, `streamSSE` also sends an `event: error` message.
- The `Context` is held in a `WeakMap` keyed by the readable stream, so Bun does not destroy it while streaming. On Bun versions before 1.1.27, the stream is aborted when the request signal aborts.

## Proxy (`hono/proxy`)

`proxy(input, init?)` forwards a request with `fetch`, or with `init.customFetch` if given. It is typically called as `proxy(url, c.req)` or `proxy(url, { ...c.req, headers: {...} })`.

- It copies method, body (with `duplex: 'half'`), headers and signal from `init.raw`.
- In both directions it strips hop-by-hop headers: `connection`, `keep-alive`, `proxy-*`, `te`, `trailer`, `transfer-encoding` and `upgrade`.
- With `strictConnectionProcessing: true`, it also removes the headers listed in `Connection`. It throws `HTTPException(400)` for names that are not valid RFC 9110 tokens.
- Header values given as `null` or `undefined` in a record delete that header.
- It removes `accept-encoding` from the outgoing request. If the upstream response has `content-encoding`, it drops `content-encoding` and `content-length`, because the runtime's fetch has already decompressed the body.

## Static site generation (`hono/ssg`)

`toSSG(app, fs, { dir = './static', concurrency, extensionMap, plugins, beforeRequestHook, afterResponseHook, afterGenerateHook })` renders an app to files.

1. `filterStaticGenerateRoutes` keeps `GET`/`ALL` routes whose real handler, found through `findTargetHandler`, is not middleware (a function with more than one parameter counts as middleware).
2. For each route it sends one "info" request with env `{ HONO_SSG_CONTEXT: true }`. The `ssgParams(paramsOrFn)` middleware on a dynamic route attaches `ssgParams` to the raw request and returns `notFound`, so the handler does not run. Dynamic routes without `ssgParams` are skipped.
3. It then requests every concrete path (`replaceUrlParam`) through `app.request`, with concurrency limited by `createPool`.
4. Hooks and plugins run in this order: `beforeRequestHook` → `afterResponseHook` → `afterGenerateHook`.
   - The default plugin drops responses that are not 200.
   - `redirectPlugin()` turns 301/302/303/307/308 responses into meta-refresh HTML.
5. The output file extension is chosen by MIME type (`defaultExtensionMap`). `ensureWithinOutDir` rejects paths that would traverse outside the output directory.

`disableSSG()` marks a response with `x-hono-disable-ssg` so it is skipped. `onlySSG()` returns 404 outside SSG. `isSSGContext(c)` checks the env flag. Errors are collected into `{ success: false, error }`; `toSSG` returns them instead of throwing.

## Testing (`hono/testing`)

`testClient(app, env?, executionCtx?, options?)` is `hc<typeof app>('http://localhost')` with a custom `fetch` that calls `app.request(...)` in-process. It gives typed RPC-style tests without a network (see [Type system and RPC client](../concepts/types-and-rpc-client.md)).

## Dev (`hono/dev`)

- `inspectRoutes(app)` returns `{ path, method, name, isMiddleware }` for each route.
- `showRoutes(app, { verbose?, colorize? })` prints the routing table. Middleware is shown only in verbose mode.
- `getRouterName(app)` forces a `match('GET', '/')` so that SmartRouter commits to a router, then returns `app.router.name`.

## Route (`hono/route`)

These helpers report where the current handler sits in the route tree. Each accepts an optional index and defaults to `c.req.routeIndex`.

- `matchedRoutes(c)`: the routes that matched the request.
- `routePath(c, i?)`: the matched route's path pattern.
- `baseRoutePath(c, i?)`: the `basePath` pattern the route was registered under.
- `basePath(c, i?)`: the concrete prefix of the request path that corresponds to that base pattern. Results are cached per context.

## Accepts (`hono/accepts`)

`accepts(c, { header, supports, default, match? })` parses an `Accept*` header with q-values (`src/utils/accept.ts`). It returns the supported value with the highest q, or `default` when the header is missing or nothing matches. A custom `match` function can replace the selection logic.

## CSS (`hono/css`)

`css`, `cx`, `keyframes`, `viewTransition` and `<Style />` produce hashed class names for CSS-in-JS that works with Hono JSX. `createCssContext({ id, classNameSlug?, onInvalidSlug? })` creates an isolated context; the default `id` is `hono-css`. During server rendering, the styles a page uses are collected through `HtmlEscapedCallback`s and injected into `<style id="...">`. If the style tag has already been streamed, the CSS is appended with an inline `<script>` instead. Nonces are supported. On the client, `jsx/dom/css` supplies the DOM implementation.

## Tests

Each helper has colocated tests: `cookie/index.test.ts`, `streaming/sse.test.tsx`, `proxy/index.test.ts`, `ssg/ssg.test.tsx`, `ssg/plugins.test.tsx`, `css/common.case.test.tsx`, `testing/index.test.ts`, and so on.
