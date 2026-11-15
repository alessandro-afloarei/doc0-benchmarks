---
title: "Helper Catalogue"
---
## Overview

Helpers are plain functions, imported from their own subpaths, that a handler calls when it needs them; unlike middleware they do not sit in the request chain. The larger helpers have their own pages: [[Cookies]], [[Streaming and Server-Sent Events]], [[WebSockets]], [[Static Site Generation]] and the [[CSS Helper]]. This page covers the small ones.

Sources: [package.json:99-112](repo://package.json#L99-L112), [package.json:400-414](repo://package.json#L400-L414)

| Helper | Import | Purpose | Choose it when |
| --- | --- | --- | --- |
| `accepts` | `hono/accepts` | Content negotiation from `Accept*` headers | One route serves several formats or languages |
| `env`, `getRuntimeKey` | `hono/adapter` | Runtime detection and environment variables | Code must run on several runtimes |
| `ConnInfo`, `GetConnInfo` | `hono/conninfo` | Types for client address information | Writing code against any adapter's `getConnInfo` |
| `inspectRoutes`, `showRoutes` | `hono/dev` | List registered routes | Debugging routing, printing a route table at start |
| `createFactory`, `createMiddleware` | `hono/factory` | Typed handlers and middleware outside the app | Splitting an app across files |
| `proxy` | `hono/proxy` | Forward a request to another server | Building a gateway or reverse proxy |
| `matchedRoutes`, `routePath`, `basePath` | `hono/route` | Which routes matched this request | Logging or metrics keyed by route pattern |
| `testClient` | `hono/testing` | Typed client over `app.request` | Tests that call routes as typed methods |

Sources: [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49), [src/helper/adapter/index.ts:10-50](repo://src/helper/adapter/index.ts#L10-L50), [src/helper/dev/index.ts:27-39](repo://src/helper/dev/index.ts#L27-L39), [src/helper/proxy/index.ts:160-160](repo://src/helper/proxy/index.ts#L160-L160), [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

## accepts

`accepts(c, { header, supports, default, match })` reads the named header (`Accept`, `Accept-Language`, `Accept-Encoding` and so on), parses it with `parseAccept` into types with parameters and quality values, and returns the supported value with the highest quality. Without the header, or when nothing matches, it returns `default`. A custom `match(accepts, config)` replaces the selection rule, for example to accept `en` for `en-US`.

Sources: [src/helper/accepts/accepts.ts:5-49](repo://src/helper/accepts/accepts.ts#L5-L49), [src/utils/accept.ts:211-221](repo://src/utils/accept.ts#L211-L221)

```ts
const lang = accepts(c, { header: 'Accept-Language', supports: ['en', 'ja'], default: 'en' })
```

Sources: [src/helper/accepts/accepts.ts:40-49](repo://src/helper/accepts/accepts.ts#L40-L49)

The same parser backs the `compress` and `languageDetector` middleware, described in [[Response Middleware]] and [[Request Utility Middleware]].

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/language/language.ts:74-76](repo://src/middleware/language/language.ts#L74-L76)

## adapter

`getRuntimeKey()` names the current runtime: `deno`, `bun`, `workerd` or `node` from `navigator.userAgent` when available, then `edge-light` (Vercel Edge), `fastly`, `node` from `process.release` (for Node.js older than 21.1), and otherwise `other`.

Sources: [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

`env(c)` returns environment variables in one shape on every runtime: `process.env` on Node.js, Bun and Edge Runtime, `Deno.env.toObject()` on Deno, `c.env` on Cloudflare Workers, and `{}` on Fastly and unknown runtimes. Its type parameter declares the expected variables.

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

## conninfo

`hono/conninfo` exports only types. `GetConnInfo` is `(c) => ConnInfo`, and `ConnInfo.remote` holds the client `address`, `addressType` (`IPv4` or `IPv6`), `port` and `transport` when the runtime knows them. Each adapter provides its own `getConnInfo`, listed in [[Runtime Adapters]], and `ipRestriction` in [[Access Control Middleware]] accepts any of them.

Sources: [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45)

## dev

`inspectRoutes(app)` returns one record per registration from `app.routes`: path, method, handler name (`[handler]` or `[middleware]` when anonymous) and whether it is middleware (two or more parameters). `showRoutes(app, { verbose, colorize })` prints them as a table, grouping repeated method and path pairs and hiding middleware unless `verbose`. `getRouterName(app)` runs one match so `SmartRouter` picks its router, then returns the router's name, such as `SmartRouter + RegExpRouter` (see [[Routers]]).

Sources: [src/helper/dev/index.ts:23-79](repo://src/helper/dev/index.ts#L23-L79)

> [!WARNING]
> `getRouterName` triggers the router build, after which routes can no longer be added. Call it only after every route is registered.

Sources: [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79), [src/router/smart-router/router.ts:13-19](repo://src/router/smart-router/router.ts#L13-L19)

## factory

`createMiddleware<Env>(fn)` returns `fn` unchanged; its value is the type: the middleware declares the `Env` it provides (for example `Variables: { user: User }`), and routes that use it see those variables, as explained in [[Typed Routes and Schemas]]. `createFactory<Env>({ initApp, defaultAppOptions })` returns a `Factory` bound to one `Env`, with `createApp` (a new `Hono`, with default options merged and `initApp` run on it), `createMiddleware` and `createHandlers`. `createHandlers(...handlers)` returns the handlers as an array typed as if they were written inline in `app.get(path, ...)`, so handlers defined in another file keep path parameter and validator types.

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

## proxy

`proxy(url, init)` forwards a request and returns a response that is safe to return from a handler. Passing `{ raw: c.req.raw, ... }` copies the incoming method, body, headers and abort signal. Hop-by-hop headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`, `Upgrade` and the others in RFC 2616) are removed in both directions, and with `strictConnectionProcessing` so are the headers named in `Connection`, after validating them. `Accept-Encoding` is dropped from the request; if the upstream response is still encoded, `Content-Encoding` and `Content-Length` are removed because the runtime's `fetch` has already decoded the body. Header values set to `undefined` in `init.headers` delete that header, and `customFetch` replaces `fetch`.

Sources: [src/helper/proxy/index.ts:9-113](repo://src/helper/proxy/index.ts#L9-L113), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190)

```ts
app.get('/api/*', (c) =>
  proxy(`https://upstream.example.com${c.req.path}`, {
    raw: c.req.raw,
    headers: { ...c.req.header(), 'X-Forwarded-For': '127.0.0.1', Authorization: undefined },
  })
)
```

Sources: [src/helper/proxy/index.ts:93-113](repo://src/helper/proxy/index.ts#L93-L113)

## route

These functions read the router's match result for the current request through the `GET_MATCH_RESULT` symbol on [[HonoRequest]]:

Sources: [src/helper/route/index.ts:32-34](repo://src/helper/route/index.ts#L32-L34)

| Function | Returns |
| --- | --- |
| `matchedRoutes(c)` | Every `RouterRoute` that matched, middleware included |
| `routePath(c, index?)` | The registered pattern of the running handler, such as `/posts/:id` |
| `baseRoutePath(c, index?)` | The base path pattern the route was grouped under, such as `/:lang/api` |
| `basePath(c, index?)` | That base path with parameters filled in from the actual request, such as `/en/api` |

Sources: [src/helper/route/index.ts:32-141](repo://src/helper/route/index.ts#L32-L141)

`index` defaults to `c.req.routeIndex`, so inside a middleware the functions describe that middleware's own registration; negative indexes count from the end, so `routePath(c, -1)` is the final handler. `basePath` caches its result per context and index.

Sources: [src/helper/route/index.ts:58-83](repo://src/helper/route/index.ts#L58-L83), [src/helper/route/index.ts:106-141](repo://src/helper/route/index.ts#L106-L141)

## testing

`testClient(app, env?, executionCtx?, options?)` builds the [[RPC Client]] with a `fetch` that calls `app.request`, so tests make typed calls without a server and with chosen bindings. Like the client, it sees only routes whose types were chained on the app.

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27)
