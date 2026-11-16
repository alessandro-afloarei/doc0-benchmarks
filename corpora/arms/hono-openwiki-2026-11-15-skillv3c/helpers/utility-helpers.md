---
type: reference
title: Utility Helpers
description: Behavior of Hono's smaller helper modules — hono/cookie (parsing, serialization rules, HMAC-signed cookies, __Secure-/__Host- prefixes), hono/accepts, hono/adapter (env, getRuntimeKey), hono/conninfo, hono/factory, hono/dev, hono/proxy, hono/route, and hono/testing.
tags: [helper, cookie, factory, proxy, route, testing, adapter, accepts]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-99fa14192088b275e041b38a
    resource: repo://src/helper/adapter/index.ts
  - id: openwiki-source-c2f00f3388df41550f8e1be3
    resource: repo://src/helper/cookie/index.ts
  - id: openwiki-source-3f907dd5d3367ef4be8829b4
    resource: repo://src/helper/dev/index.ts
  - id: openwiki-source-078e424275628129af3d399b
    resource: repo://src/helper/factory/index.ts
  - id: openwiki-source-74d5a36263746a532479616f
    resource: repo://src/helper/proxy/index.ts
  - id: openwiki-source-8d8b1d5204737a950c3145a4
    resource: repo://src/helper/route/index.ts
  - id: openwiki-source-877a31a73fadd9d3f8972d6d
    resource: repo://src/helper/testing/index.ts
  - id: openwiki-source-a49b959930b2834e410ba9de
    resource: repo://src/utils/cookie.ts
  - id: openwiki-source-b6e31ddca68e7ac800c3482e
    resource: repo://src/utils/handler.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Utility Helpers

Helpers under `src/helper/*` are standalone functions published as subpaths (`hono/cookie`, `hono/factory`, ...). They take a `Context` (or an app) and never require registration as middleware. Larger helpers have their own pages: [Streaming, SSE, and WebSocket](streaming-and-websocket.md), [SSG](ssg.md), and the `html`/`css` helpers in [JSX Server Rendering](../jsx/server-rendering.md).

## Cookies — `hono/cookie`

Built on `src/utils/cookie.ts`.

**Reading.** `getCookie(c)` returns all cookies; `getCookie(c, key, prefix?)` returns one, prepending `__Secure-` or `__Host-` when `prefix` is `'secure'`/`'host'`. The parser:

- fast-paths a missing key (`indexOf`) and stops at the first match when a name is requested;
- skips names that are not RFC 6265 tokens, and keeps the **first** occurrence of a duplicated name;
- strips surrounding double quotes, rejects values with characters outside the allowed set (`"`, `;`, `\` and control characters), and URI-decodes values containing `%`;
- returns a null-prototype object.

**Signed cookies.** `setSignedCookie` / `generateSignedCookie` append `.<base64 HMAC-SHA256 signature>` to the value and URI-encode the result. `getSignedCookie(c, secret, key?)` verifies each value with `crypto.subtle.verify`; a value that fails verification is returned as **`false`** (not `undefined`), while values that don't look signed (no `.`, or a signature not 44 chars ending in `=`) are omitted.

**Writing.** `setCookie(c, name, value, opt)` appends a `Set-Cookie` header (multiple cookies accumulate). Defaults to `Path=/`. The serializer enforces:

- `__Secure-` prefix requires `Secure`; `__Host-` requires `Secure`, `Path=/`, and no `Domain` (with `prefix: 'host'` these are forced automatically);
- `Max-Age` and `Expires` may not exceed 400 days;
- `Partitioned` requires `Secure`;
- invalid names and option values containing `;`, `\r`, or `\n` throw.

`deleteCookie(c, name, opt)` sets the cookie with `maxAge: 0` and returns the previous value. Note the same `path`/`domain`/`prefix` must be passed to delete a cookie set with them.

## Content negotiation — `hono/accepts`

`accepts(c, { header, supports, default, match? })` parses an `Accept*` header with `parseAccept` (q-values and params) and, by default, returns the supported type with the highest `q`, else `default`. A custom `match(accepts, config)` can replace the selection. The [language middleware](../middleware/request-response-middleware.md) performs its own negotiation.

## Runtime detection and env — `hono/adapter`

- `getRuntimeKey()` returns `'deno' | 'bun' | 'workerd' | 'node' | 'edge-light' | 'fastly' | 'other'`. It first checks `navigator.userAgent` prefixes (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`), then `globalThis.EdgeRuntime` (Vercel Edge), `globalThis.fastly`, and `process.release.name === 'node'`.
- `env(c, runtime?)` returns environment variables in a runtime-neutral way: `process.env` on Node/Bun/edge-light, `Deno.env.toObject()` on Deno, `c.env` on workerd, and `{}` on Fastly/other.

## Connection info — `hono/conninfo`

Only types live here (`ConnInfo`, `NetAddrInfo`, `GetConnInfo`); each adapter exports its own `getConnInfo`. See [Runtime Adapters](../adapters/runtime-adapters.md#connection-info-getconninfo).

## Factory — `hono/factory`

- `createMiddleware<E>(fn)` and `factory.createMiddleware(fn)` are identity functions that exist purely for typing (Env, path, input and response types).
- `createFactory({ initApp?, defaultAppOptions? })` returns a `Factory` whose `createApp(options?)` builds a `Hono<E>` from merged default and per-call options, then calls `initApp(app)` (useful to install shared middleware or variables).
- `factory.createHandlers(...handlers)` returns the handler array with types threaded through, so handlers defined outside `app.get(...)` keep param/validator inference. Its long overload list lives in `CreateHandlersInterface`.

See [Type System and Route Schema](../typing/type-system.md).

## Route inspection — `hono/dev`

- `inspectRoutes(app)` maps `app.routes` to `{ path, method, name, isMiddleware }`, unwrapping `route()`-wrapped handlers via `COMPOSED_HANDLER`. A handler is considered middleware when it declares more than one parameter (`handler.length > 1`).
- `showRoutes(app, { verbose?, colorize? })` prints a method/path table to the console (middleware hidden unless `verbose`; color defaults from `getColorEnabled()`, which respects `NO_COLOR`).
- `getRouterName(app)` forces a `match('GET', '/')` (so `SmartRouter` picks a concrete router) and returns `router.name`, e.g. `SmartRouter + RegExpRouter`.

## Request context of the matched route — `hono/route`

These read the router's match result via the private `GET_MATCH_RESULT` symbol on `HonoRequest`:

- `matchedRoutes(c)` — `RouterRoute[]` for every matched handler/middleware;
- `routePath(c, index?)` — registered path of the current (or given; negative allowed via `.at`) route, `''` if none;
- `baseRoutePath(c, index?)` — the route's registration base path pattern;
- `basePath(c, index?)` — the base path with params **filled in from the actual request path**, computed by walking the pattern segments and cached per context in a `WeakMap`.

## Reverse proxy — `hono/proxy`

`proxy(input, init?)` forwards a request and returns a new `Response`:

- `init.raw` (or passing a `Request` directly) copies method, body (`duplex: 'half'` for streams), headers and signal from the original request.
- Hop-by-hop headers (`Connection`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Transfer-Encoding`, `Upgrade`) are removed from both the outgoing request and the returned response. With `strictConnectionProcessing: true`, headers named in `Connection` are also removed and invalid tokens there cause an `HTTPException(400)`.
- Header record values of `undefined`/`null` in `init.headers` delete the header.
- `Accept-Encoding` is always dropped from the outgoing request, and if the upstream response is still encoded, `Content-Encoding` and `Content-Length` are removed (the runtime's `fetch` has already decoded the body).
- `customFetch` replaces the global `fetch`.

## Test client — `hono/testing`

`testClient(app, env?, executionCtx?, options?)` returns an [RPC client](../typing/rpc-client.md) for `http://localhost` whose `fetch` is `app.request(...)`, giving type-safe, network-free tests that exercise the full dispatch path.
