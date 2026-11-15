---
title: "Factory, Testing and Utility Helpers"
---
## Overview

Besides the larger helpers (cookies, streaming, WebSockets, SSG), Hono ships a set of small single-purpose modules under `src/helper`. Most are a few dozen lines and add no runtime cost unless imported. This page covers the ones that help structure and test an app (`hono/factory`, `hono/testing`, `hono/dev`, `hono/route`) and the ones that smooth over runtime and protocol details (`hono/adapter`, `hono/conninfo`, `hono/accepts`, `hono/proxy`).

Sources: [src/helper/factory/index.ts:1-18](repo://src/helper/factory/index.ts#L1-L18), [src/helper/testing/index.ts:1-27](repo://src/helper/testing/index.ts#L1-L27), [src/helper/dev/index.ts:1-10](repo://src/helper/dev/index.ts#L1-L10), [src/helper/adapter/index.ts:1-8](repo://src/helper/adapter/index.ts#L1-L8)

| Import | Exports | Purpose |
| --- | --- | --- |
| `hono/factory` | `createFactory`, `Factory`, `createMiddleware` | Typed handlers and middleware defined apart from the app. |
| `hono/testing` | `testClient` | A typed RPC client that calls the app in memory. |
| `hono/dev` | `inspectRoutes`, `showRoutes`, `getRouterName` | Route listing and router introspection. |
| `hono/route` | `matchedRoutes`, `routePath`, `baseRoutePath`, `basePath` | Which routes matched the current request. |
| `hono/adapter` | `env`, `getRuntimeKey` | Environment variables and runtime detection. |
| `hono/conninfo` | `ConnInfo`, `NetAddrInfo`, `GetConnInfo` types | The shared shape of each adapter's `getConnInfo`. |
| `hono/accepts` | `accepts` | Content negotiation over `Accept*` headers. |
| `hono/proxy` | `proxy` | A `fetch` wrapper for reverse proxying. |

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375), [src/helper/dev/index.ts:27-79](repo://src/helper/dev/index.ts#L27-L79), [src/helper/route/index.ts:32-107](repo://src/helper/route/index.ts#L32-L107), [src/helper/conninfo/index.ts:1-6](repo://src/helper/conninfo/index.ts#L1-L6), [src/helper/accepts/index.ts:1-6](repo://src/helper/accepts/index.ts#L1-L6), [src/helper/proxy/index.ts:160-160](repo://src/helper/proxy/index.ts#L160-L160)

## Factory helper

### Why it exists

Handlers written inline in `app.get(...)` get their types (env, path params, validated input) inferred from the call. Handlers written in another file lose that context. The factory helper exists to carry the `Env` type to code defined away from the app: every function in it is an identity function at run time and only adds types. See [[Type System]] for how those types flow.

Sources: [src/helper/factory/index.ts:353-375](repo://src/helper/factory/index.ts#L353-L375)

### createFactory and Factory

`createFactory<E, P>(init?)` returns a `Factory<E, P>`. Its members are arrow-function properties, so they can be destructured without losing `this`.

Sources: [src/helper/factory/index.ts:332-366](repo://src/helper/factory/index.ts#L332-L366)

| Member | Behaviour |
| --- | --- |
| `createApp(options?)` | Builds `new Hono<E>()`. When both `options` and `init.defaultAppOptions` exist they are merged with `options` winning; otherwise whichever is set is used. Then `init.initApp(app)` runs, so shared middleware or variables can be registered on every app the factory makes. |
| `createMiddleware(mw)` | Returns `mw` unchanged, typed as `MiddlewareHandler<E, P, I, R>`. |
| `createHandlers(...handlers)` | Returns the handlers with `undefined` entries filtered out. Overloads for 1 to 10 handlers chain the env and input types from one handler to the next, so a validator's output type reaches the final handler. |

Sources: [src/helper/factory/index.ts:336-360](repo://src/helper/factory/index.ts#L336-L360), [src/helper/factory/index.ts:20-36](repo://src/helper/factory/index.ts#L20-L36)

```ts
import { createFactory } from 'hono/factory'
import { logger } from 'hono/logger'

type Env = { Variables: { user: string } }
const factory = createFactory<Env>({
  initApp: (app) => app.use(logger()),
})

const auth = factory.createMiddleware(async (c, next) => {
  c.set('user', 'alice')
  await next()
})
const handlers = factory.createHandlers(auth, (c) => c.text(c.var.user))

const app = factory.createApp()
app.get('/me', ...handlers)
```

Sources: [src/helper/factory/index.ts:332-366](repo://src/helper/factory/index.ts#L332-L366)

### Standalone createMiddleware

The top-level `createMiddleware<E, P, I, R>` is the same identity function without a factory, and defaults `E` to `any`. When the middleware's return type `R` is `void` it is typed as returning `Response`. [[Middleware and Composition]] covers how middleware runs.

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375)

## Testing helper

`testClient(app, Env?, executionCtx?, options?)` creates an [[RPC Client]] (`hc`) pointed at `http://localhost` whose `fetch` is replaced by `app.request(input, init, Env, executionCtx)`. Requests never touch the network, but they go through the full routing, middleware and validation path, and responses are typed from the app's schema. `options` accepts every client option except `fetch`.

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27)

```ts
import { testClient } from 'hono/testing'

const app = new Hono().get('/search', (c) => c.json({ q: c.req.query('q') }))
const client = testClient(app)

const res = await client.search.$get({ query: { q: 'hono' } })
expect(await res.json()).toEqual({ q: 'hono' })
```

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

> [!TIP]
> The client type is only precise when routes are chained on one expression (`new Hono().get(...).post(...)`), because the schema is carried in the returned type. [[Building and Testing Hono]] covers the project's own tests.

Sources: [src/helper/testing/index.ts:13-21](repo://src/helper/testing/index.ts#L13-L21)

## Dev helper

### Listing routes

`inspectRoutes(app)` maps `app.routes` to `{ path, method, name, isMiddleware }`. It unwraps composed handlers with `findTargetHandler`, and classifies a function as middleware when it declares more than one parameter (`handler.length > 1`). Anonymous functions are named `[middleware]` or `[handler]`.

Sources: [src/helper/dev/index.ts:11-37](repo://src/helper/dev/index.ts#L11-L37), [src/utils/handler.ts:8-15](repo://src/utils/handler.ts#L8-L15)

`showRoutes(app, { verbose?, colorize? })` prints one line per method and path, aligned by the longest method. Without `verbose`, middleware entries are hidden; with it, every handler name for that method and path is printed underneath. Colour (green methods) defaults to `getColorEnabled()`.

Sources: [src/helper/dev/index.ts:39-74](repo://src/helper/dev/index.ts#L39-L74)

### getRouterName

`getRouterName(app)` calls `app.router.match('GET', '/')` before reading `app.router.name`. The match is needed because the default `SmartRouter` only picks its concrete router on the first match and changes its reported name then. [[Router Implementations]] explains that choice.

Sources: [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79)

## Route helper

### Matched routes

Every function in `hono/route` reads the router's match result that `HonoRequest` exposes under the `GET_MATCH_RESULT` symbol. `matchedRoutes(c)` returns the `RouterRoute` of every handler that matched, in execution order, middleware included; `c.req.routeIndex` points at the one running now.

Sources: [src/helper/route/index.ts:1-34](repo://src/helper/route/index.ts#L1-L34), [src/request.ts:389-389](repo://src/request.ts#L389-L389), [src/request.ts:55-55](repo://src/request.ts#L55-L55)

| Function | Returns |
| --- | --- |
| `matchedRoutes(c)` | `RouterRoute[]` for the request. |
| `routePath(c, index?)` | The registered path of route `index` (default `c.req.routeIndex`; negative counts from the end, like `Array.prototype.at`). In `app.use('*')` it is `'*'`; `routePath(c, -1)` gives the final handler's pattern. |
| `baseRoutePath(c, index?)` | The `basePath` pattern the route was mounted under, e.g. `'/:sub'` for `app.route('/:sub', subApp)`. |
| `basePath(c, index?)` | That base path with parameters filled in from the actual request path. |

Sources: [src/helper/route/index.ts:36-107](repo://src/helper/route/index.ts#L36-L107)

### How basePath fills parameters

`basePath` returns the pattern unchanged when it has no `:` or `*`. Otherwise it splits the pattern with `splitRoutingPath` and walks the request path segment by segment: a literal segment advances by its length, and a parameter advances by the length of what its regular expression (or `[^/]+` for plain params and `*`) matches. The prefix of `c.req.path` up to that length is the result, cached per context and index in a `WeakMap`.

Sources: [src/helper/route/index.ts:106-141](repo://src/helper/route/index.ts#L106-L141)

## Adapter helper

### getRuntimeKey

`getRuntimeKey()` returns a `Runtime`: `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`. It first compares `navigator.userAgent` with the prefixes in `knownUserAgents` (`Deno`, `Bun`, `Cloudflare-Workers`, `Node.js`), then checks `globalThis.EdgeRuntime` for Vercel Edge, `globalThis.fastly` for Fastly, and `process.release.name === 'node'` for Node versions before 21.1 that have no `navigator.userAgent`.

Sources: [src/helper/adapter/index.ts:8-8](repo://src/helper/adapter/index.ts#L8-L8), [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

### env

`env(c, runtime?)` returns environment variables the same way on every runtime, using `getRuntimeKey()` when `runtime` is omitted.

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

| Runtime | Source of values |
| --- | --- |
| `node`, `bun`, `edge-light` | `globalThis.process.env` |
| `deno` | `Deno.env.toObject()` |
| `workerd` | `c.env` (the Worker bindings) |
| `fastly`, `other` | `{}`; on Fastly use a ConfigStore |

Sources: [src/helper/adapter/index.ts:20-41](repo://src/helper/adapter/index.ts#L20-L41)

```ts
import { env, getRuntimeKey } from 'hono/adapter'

app.get('/env', (c) => {
  const { API_KEY } = env<{ API_KEY: string }>(c)
  return c.text(`${getRuntimeKey()}: ${API_KEY ? 'set' : 'missing'}`)
})
```

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

## Connection info types

`hono/conninfo` exports only types; each runtime adapter supplies its own `getConnInfo` of type `GetConnInfo = (c: Context) => ConnInfo`. A `ConnInfo` has one field, `remote: NetAddrInfo`, with optional `transport` (`'tcp' | 'udp'`), `port`, `address` and `addressType` (`'IPv4' | 'IPv6' | undefined`). The union in `NetAddrInfo` makes `address` and `addressType` appear together when an adapter knows both.

Sources: [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45)

On Cloudflare Workers, for example, the address comes from the `cf-connecting-ip` header, with no port or type. Adapters for AWS Lambda, Lambda@Edge, Bun, Deno, Cloudflare Pages, Netlify and Vercel each provide their own; see [[Runtime Adapters]].

Sources: [src/adapter/cloudflare-workers/conninfo.ts:1-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L1-L7)

## Accepts helper

`accepts(c, { header, supports, default, match? })` reads the named header (`Accept`, `Accept-Language`, `Accept-Encoding` and so on). With no header it returns `default`. Otherwise it parses the value with `parseAccept` into `{ type, params, q }` entries and calls `match`. `defaultMatch` sorts by `q`, highest first, and returns the first type listed in `supports`, or `default` when none is.

Sources: [src/helper/accepts/accepts.ts:5-49](repo://src/helper/accepts/accepts.ts#L5-L49)

```ts
import { accepts } from 'hono/accepts'

app.get('/', (c) => {
  const lang = accepts(c, { header: 'Accept-Language', supports: ['en', 'ja'], default: 'en' })
  return c.text(lang === 'ja' ? 'こんにちは' : 'Hello')
})
```

Sources: [src/helper/accepts/accepts.ts:27-49](repo://src/helper/accepts/accepts.ts#L27-L49)

## Proxy helper

### Request side

`proxy(input, init?)` has the signature of `fetch` and returns a `Response` a handler can return directly. The init may hold `raw` (an incoming `Request`, which is what spreading `...c.req` supplies), `headers`, `customFetch` and `strictConnectionProcessing`; a bare `Request` as `init` is treated as `{ raw }`. The outgoing request is built in the three steps below.

Sources: [src/helper/proxy/index.ts:24-48](repo://src/helper/proxy/index.ts#L24-L48), [src/helper/proxy/index.ts:160-166](repo://src/helper/proxy/index.ts#L160-L166)

1. `buildRequestInitFromRequest(raw)` copies method, body (with `duplex: 'half'` when there is a body), headers and abort signal from the raw request, removing the RFC 2616 hop-by-hop headers (`connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding`, `upgrade`).
2. `preprocessRequestInit` turns a plain `headers` object into `Headers`, dropping keys whose value is `null` or `undefined`. Because it is spread last, a `headers` option replaces the raw request's headers entirely, which is how `Authorization: undefined` keeps a credential from being forwarded.
3. `accept-encoding` is deleted, so the upstream sends an encoding the runtime's `fetch` can decode.

Sources: [src/helper/proxy/index.ts:9-113](repo://src/helper/proxy/index.ts#L9-L113), [src/helper/proxy/index.ts:160-172](repo://src/helper/proxy/index.ts#L160-L172)

> [!WARNING]
> With `strictConnectionProcessing: true` the headers listed in the incoming `Connection` header are removed too, as RFC 9110 requires, and a name that is not a valid token raises `HTTPException(400)`. It is off by default because a client could list headers such as `Authorization` there to strip them on the way to the origin; enable it only for trusted clients.

Sources: [src/helper/proxy/index.ts:21-44](repo://src/helper/proxy/index.ts#L21-L44), [src/helper/proxy/index.ts:58-78](repo://src/helper/proxy/index.ts#L58-L78)

### Response side

The response is fetched with `customFetch` or the global `fetch`. Hop-by-hop headers are removed from a copy of its headers, and when `content-encoding` is present both it and `content-length` are removed, since `fetch` has already decompressed the body and the original length no longer applies. A new `Response` with the same body, status and status text is returned.

Sources: [src/helper/proxy/index.ts:174-190](repo://src/helper/proxy/index.ts#L174-L190)

```ts
import { proxy } from 'hono/proxy'

app.all('/api/*', (c) =>
  proxy(`https://origin.example.com${c.req.path}`, {
    ...c.req,
    headers: { ...c.req.header(), 'X-Forwarded-Host': c.req.header('host'), Authorization: undefined },
  })
)
```

Sources: [src/helper/proxy/index.ts:115-160](repo://src/helper/proxy/index.ts#L115-L160)
