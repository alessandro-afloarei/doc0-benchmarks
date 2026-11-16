---
title: "Helpers Catalogue"
---
## Overview

Helpers are functions, not middleware: a handler calls them with the context or the app when it needs them. The larger helpers have their own pages ([[Cookies]], [[Streaming Responses]], [[WebSockets]], [[Static Site Generation]], [[CSS Helper]], [[Writing Middleware and Factories]] for `hono/factory`, and `hono/conninfo` on [[Runtime Adapters]]). This page covers the small ones, each a separate subpath import.

Sources: [package.json:38-60](repo://package.json#L38-L60)

| Import | Main exports | Choose it when |
| --- | --- | --- |
| `hono/accepts` | `accepts(c, options)` | Content negotiation on `Accept`, `Accept-Language` or `Accept-Encoding` |
| `hono/adapter` | `env(c)`, `getRuntimeKey()` | Reading environment variables or branching on the runtime |
| `hono/dev` | `showRoutes`, `inspectRoutes`, `getRouterName` | Listing routes at startup or debugging router selection |
| `hono/proxy` | `proxy(url, init)` | Forwarding a request to another server |
| `hono/route` | `matchedRoutes`, `routePath`, `baseRoutePath`, `basePath` | Middleware that needs to know which route pattern matched |
| `hono/testing` | `testClient(app)` | Typed tests without a network |

Sources: [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/helper/adapter/index.ts:10-90](repo://src/helper/adapter/index.ts#L10-L90), [src/helper/dev/index.ts:27-79](repo://src/helper/dev/index.ts#L27-L79), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190), [src/helper/route/index.ts:32-141](repo://src/helper/route/index.ts#L32-L141), [src/helper/testing/index.ts:15-27](repo://src/helper/testing/index.ts#L15-L27)

## accepts

`accepts(c, { header, supports, default, match? })` reads the named header and returns the best supported value, or `default` when the header is missing or nothing matches. The default `match` sorts the parsed entries by `q` and returns the first type listed in `supports`; a custom `match(accepts, config)` can implement wildcards or language fallbacks.

Sources: [src/helper/accepts/accepts.ts:11-49](repo://src/helper/accepts/accepts.ts#L11-L49)

The parsing is done by `parseAccept` in `utils/accept`, shared with the `compress` and `language` middleware. It scans the header character by character into `{ type, params, q }` entries, skipping malformed parameters, treats a missing or invalid `q` as 1 (and `NaN` as 0), and sorts only when the entries are not already in descending order, which is the common case.

Sources: [src/utils/accept.ts:1-40](repo://src/utils/accept.ts#L1-L40), [src/utils/accept.ts:211-266](repo://src/utils/accept.ts#L211-L266)

## adapter

`getRuntimeKey()` identifies the runtime: from `navigator.userAgent` when available (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`), then by globals (`EdgeRuntime` for Vercel Edge as `edge-light`, `fastly`, `process.release.name === 'node'` for older Node), else `other`.

Sources: [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

`env<T>(c, runtime?)` returns environment variables wherever they live: `process.env` on Node, Bun and Edge, `Deno.env.toObject()` on Deno, `c.env` (the bindings) on Workers, and `{}` on Fastly and unknown runtimes. Code that must run on several platforms uses it instead of reading `process.env` or `c.env` directly.

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

## dev

`inspectRoutes(app)` maps `app.routes` to `{ path, method, name, isMiddleware }`, unwrapping handlers wrapped by `route()` so names are the original functions'. A function with two declared parameters counts as middleware. `showRoutes(app, { verbose, colorize })` prints them aligned by method, hiding middleware unless `verbose`, with colour following the `NO_COLOR` convention.

Sources: [src/helper/dev/index.ts:11-74](repo://src/helper/dev/index.ts#L11-L74), [src/utils/handler.ts:1-15](repo://src/utils/handler.ts#L1-L15)

`getRouterName(app)` calls `app.router.match('GET', '/')` to force `SmartRouter` to choose, then returns the router's name, for example `SmartRouter + RegExpRouter`. It is the quickest way to see whether an app's routes pushed it onto `TrieRouter`; [[Routers and Route Syntax]] explains the selection.

Sources: [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79), [src/router/smart-router/router.ts:46-61](repo://src/router/smart-router/router.ts#L46-L61)

## proxy

`proxy(url, init)` is `fetch` adapted for forwarding. Passing `{ ...c.req, headers: {...} }` or `{ raw: c.req.raw }` copies the incoming method, body (streamed with `duplex: 'half'`), headers and abort signal. Header values given as `undefined` are removed.

Sources: [src/helper/proxy/index.ts:24-48](repo://src/helper/proxy/index.ts#L24-L48), [src/helper/proxy/index.ts:50-113](repo://src/helper/proxy/index.ts#L50-L113), [src/helper/proxy/index.ts:160-171](repo://src/helper/proxy/index.ts#L160-L171)

Hop-by-hop headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade` and others) are stripped in both directions, as a proxy must. With `strictConnectionProcessing`, headers named in `Connection` are removed too, and an invalid name there is a 400. The outgoing `Accept-Encoding` is dropped and the response's `Content-Encoding` and `Content-Length` removed, because the runtime's `fetch` decompresses the body. `customFetch` replaces `fetch`, for example with a service binding.

Sources: [src/helper/proxy/index.ts:9-22](repo://src/helper/proxy/index.ts#L9-L22), [src/helper/proxy/index.ts:58-91](repo://src/helper/proxy/index.ts#L58-L91), [src/helper/proxy/index.ts:172-189](repo://src/helper/proxy/index.ts#L172-L189)

```ts
import { proxy } from 'hono/proxy'

app.get('/api/*', (c) =>
  proxy(`https://backend.example.com${c.req.path}`, {
    ...c.req,
    headers: { ...c.req.header(), 'X-Forwarded-For': '127.0.0.1', Authorization: undefined },
  })
)
```

Sources: [src/helper/proxy/index.ts:93-113](repo://src/helper/proxy/index.ts#L93-L113), [src/helper/proxy/index.ts:160-171](repo://src/helper/proxy/index.ts#L160-L171)

## route

These read the router's match result stored on the request, which lists every matched handler with its `RouterRoute` (see [[HonoRequest]]):

Sources: [src/helper/route/index.ts:1-4](repo://src/helper/route/index.ts#L1-L4), [src/request.ts:389-391](repo://src/request.ts#L389-L391)

| Function | Returns |
| --- | --- |
| `matchedRoutes(c)` | All matched routes, middleware included, in execution order |
| `routePath(c, index?)` | The pattern of the current route (`/posts/:id`), or of another index |
| `baseRoutePath(c, index?)` | The base path pattern the route was registered under (from `basePath()` or `route()`) |
| `basePath(c, index?)` | That base path with its parameters filled in from the actual request path |

Sources: [src/helper/route/index.ts:32-141](repo://src/helper/route/index.ts#L32-L141)

"Current" means `c.req.routeIndex`, which `compose` sets per handler, so a logging middleware calling `routePath(c)` after `await next()` still gets its own pattern; pass `-1` to get the last matched route instead. `basePath` matches each pattern segment against the request path and caches the result per context.

Sources: [src/helper/route/index.ts:58-60](repo://src/helper/route/index.ts#L58-L60), [src/helper/route/index.ts:106-141](repo://src/helper/route/index.ts#L106-L141), [src/compose.ts:42-45](repo://src/compose.ts#L42-L45)

## testing

`testClient(app, env?, executionCtx?)` returns an [[RPC Client]] for `http://localhost` whose `fetch` is `app.request`, passing the given bindings and execution context. Tests call routes as typed methods (`await client.posts.$get()`) without starting a server, and type errors appear when a route changes.

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27)
