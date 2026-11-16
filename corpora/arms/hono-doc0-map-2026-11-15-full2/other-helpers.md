---
title: "Factory, Testing, Proxy and Other Helpers"
---
## Overview

Besides the larger helpers with their own pages, Hono ships a set of small helpers under `src/helper`, each published as its own entry point so an app only bundles what it imports. This page covers the ones that shape how an app is organised and inspected rather than what it renders: typed factories, a typed test client, a reverse proxy wrapper, content negotiation, connection info, runtime detection, route listing and matched-route introspection.

Sources: [package.json:99-113](repo://package.json#L99-L113), [package.json:329-338](repo://package.json#L329-L338), [package.json:389-413](repo://package.json#L389-L413)

| Import | Exports | Purpose |
| --- | --- | --- |
| `hono/factory` | `createFactory`, `createMiddleware`, `Factory` | Typed apps, middleware and handler arrays sharing one `Env`. |
| `hono/testing` | `testClient` | RPC-style client that calls `app.request` directly. |
| `hono/proxy` | `proxy` | `fetch` wrapper for reverse proxying. |
| `hono/accepts` | `accepts` | Content negotiation on `Accept*` headers. |
| `hono/conninfo` | `ConnInfo`, `GetConnInfo` types | Shared shape for each adapter's `getConnInfo`. |
| `hono/adapter` | `env`, `getRuntimeKey` | Runtime-neutral environment variables and runtime detection. |
| `hono/dev` | `inspectRoutes`, `showRoutes`, `getRouterName` | Route listing for debugging. |
| `hono/route` | `matchedRoutes`, `routePath`, `baseRoutePath`, `basePath` | Which routes matched the current request. |

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375), [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27), [src/helper/proxy/index.ts:160-190](repo://src/helper/proxy/index.ts#L160-L190), [src/helper/accepts/index.ts:1-6](repo://src/helper/accepts/index.ts#L1-L6), [src/helper/conninfo/index.ts:1-6](repo://src/helper/conninfo/index.ts#L1-L6), [src/helper/adapter/index.ts:10-50](repo://src/helper/adapter/index.ts#L10-L50), [src/helper/dev/index.ts:27-79](repo://src/helper/dev/index.ts#L27-L79), [src/helper/route/index.ts:32-107](repo://src/helper/route/index.ts#L32-L107)

## Factory helper

### createFactory and Factory

Defining middleware or handlers outside `app.get(...)` loses the type inference Hono performs inline (see [[Type System and Schema Inference]]). `createFactory<Env>()` returns a `Factory` bound to one `Env` type, whose methods are typed identity functions: they return their arguments unchanged, but carry the `Env`, path and input types.

Sources: [src/helper/factory/index.ts:332-366](repo://src/helper/factory/index.ts#L332-L366)

| Member | Description |
| --- | --- |
| `createApp(options?)` | Creates `new Hono<E>()`, merging `options` over `defaultAppOptions`, then runs `initApp(app)` if given. |
| `createMiddleware(mw)` | Returns `mw` typed as `MiddlewareHandler<E, P, I, R>`. |
| `createHandlers(...handlers)` | Returns the handlers as a tuple, dropping `undefined` entries, with up to ten handlers typed individually. |

Sources: [src/helper/factory/index.ts:336-360](repo://src/helper/factory/index.ts#L336-L360)

`createHandlers` has an overload per arity, from one to ten handlers. Each overload threads input types (`I`, `I2 = I`, `I3 = I & I2`, ...) and environment types (`E3 = IntersectNonAnyTypes<[E, E2]>`, ...) through the list, so a validator in position one makes `c.req.valid()` typed in the final handler, and a middleware that sets a variable makes it visible in later handlers.

Sources: [src/helper/factory/index.ts:20-53](repo://src/helper/factory/index.ts#L20-L53)

```ts
import { createFactory } from 'hono/factory'
import { validator } from 'hono/validator'

type Env = { Bindings: { DB: D1Database }; Variables: { user: string } }

const factory = createFactory<Env>({
  initApp: (app) => {
    app.use(async (c, next) => {
      c.set('user', 'anonymous')
      await next()
    })
  },
})

const auth = factory.createMiddleware(async (c, next) => {
  c.set('user', c.req.header('x-user') ?? 'anonymous')
  await next()
})

const handlers = factory.createHandlers(
  validator('query', (v) => v as { q: string }),
  (c) => c.json({ q: c.req.valid('query').q, user: c.var.user })
)

const app = factory.createApp()
app.get('/search', auth, ...handlers)
```

Sources: [src/helper/factory/index.ts:336-366](repo://src/helper/factory/index.ts#L336-L366)

### Standalone createMiddleware

The top-level `createMiddleware<E, P, I, R>(mw)` is the same identity function without a factory. Its `E` defaults to `any`, so the middleware fits any app; give it an `Env` type to declare the variables it sets. When the response type `R` is left as `void` the middleware is typed as returning a plain `Response`.

Sources: [src/helper/factory/index.ts:368-375](repo://src/helper/factory/index.ts#L368-L375)

## Testing helper

`testClient(app, Env?, executionCtx?, options?)` builds an [[RPC Client (hc)]] against `http://localhost` whose `fetch` is replaced by `app.request(input, init, Env, executionCtx)`. Requests never touch the network, yet the client keeps the full route typing of `hc`, so tests call `client.posts[':id'].$get({ param: { id: '1' } })` with typed params and typed JSON responses. `options` accepts every `ClientRequestOptions` field except `fetch`, such as default `headers`.

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27)

```ts
import { testClient } from 'hono/testing'

const app = new Hono().get('/search', (c) => c.json({ hello: c.req.query('q') }))

it('searches', async () => {
  const res = await testClient(app, { API_KEY: 'test' }).search.$get({ query: { q: 'hono' } })
  expect(await res.json()).toEqual({ hello: 'hono' })
})
```

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

> [!TIP]
> Type inference needs the routes chained on the app instance (`new Hono().get(...)`), as with `hc`. Routes added in separate statements are still callable but not typed.

Sources: [src/helper/testing/index.ts:13-21](repo://src/helper/testing/index.ts#L13-L21)

## Proxy helper

### Building the upstream request

`proxy(input, init?)` has the signature of `fetch` and returns a `Response` a handler can return as is. The second argument may be a `Request` (shorthand for `{ raw: request }`) or a `ProxyRequestInit`. The upstream request is built in three layers:

Sources: [src/helper/proxy/index.ts:160-172](repo://src/helper/proxy/index.ts#L160-L172)

1. From `raw`, `buildRequestInitFromRequest` copies method, body (with `duplex: 'half'` when there is one), signal and headers, then deletes the hop-by-hop headers `connection`, `keep-alive`, `proxy-authenticate`, `proxy-authorization`, `te`, `trailer`, `transfer-encoding` and `upgrade`.
2. The remaining init fields are applied on top. A plain-object `headers` is converted by `preprocessRequestInit`, where a `null` or `undefined` value removes that header, which is how you strip `Authorization` while spreading `c.req.header()`.
3. `accept-encoding` is deleted so the upstream answers with an encoding the runtime's `fetch` decodes itself.

Sources: [src/helper/proxy/index.ts:9-19](repo://src/helper/proxy/index.ts#L9-L19), [src/helper/proxy/index.ts:50-113](repo://src/helper/proxy/index.ts#L50-L113), [src/helper/proxy/index.ts:160-172](repo://src/helper/proxy/index.ts#L160-L172)

```ts
import { proxy } from 'hono/proxy'

app.all('/api/:path{.+}', (c) =>
  proxy(`https://origin.example.com/${c.req.param('path')}`, {
    ...c.req,
    headers: {
      ...c.req.header(),
      'X-Forwarded-Host': c.req.header('host'),
      Authorization: undefined,
    },
  })
)
```

Sources: [src/helper/proxy/index.ts:115-159](repo://src/helper/proxy/index.ts#L115-L159)

### Options and the response

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `raw` | `Request` | none | Incoming request to copy method, body, headers and signal from. |
| `headers` | `HeadersInit \| Record<string, string \| undefined>` | none | Overrides; `undefined` deletes a header. |
| `customFetch` | `(request: Request) => Promise<Response>` | global `fetch` | Replacement fetch, for example a service binding. |
| `strictConnectionProcessing` | `boolean` | `false` | Also delete the headers named in the incoming `Connection` header (RFC 9110). |

Sources: [src/helper/proxy/index.ts:24-44](repo://src/helper/proxy/index.ts#L24-L44)

With `strictConnectionProcessing`, each name listed in `Connection` must be a valid RFC 9110 token, otherwise an `HTTPException(400)` is thrown. It is off by default because a client could otherwise list arbitrary headers, such as ones added by a trusted front proxy, and have them stripped; enable it only for trusted clients.

Sources: [src/helper/proxy/index.ts:21-22](repo://src/helper/proxy/index.ts#L21-L22), [src/helper/proxy/index.ts:60-78](repo://src/helper/proxy/index.ts#L60-L78)

On the way back, `proxy` copies the upstream headers, removes the hop-by-hop ones, and when `content-encoding` is present deletes it together with `content-length`, because `fetch` has already decompressed the body and the length no longer matches. It returns a new `Response` with the upstream status, status text and body stream.

Sources: [src/helper/proxy/index.ts:174-190](repo://src/helper/proxy/index.ts#L174-L190)

## Accepts helper

`accepts(c, { header, supports, default, match? })` reads the named header (`Accept`, `Accept-Language`, `Accept-Encoding`, ...), parses it with `parseAccept` into entries of `type`, `params` and `q`, and returns the chosen value. With no header it returns `default`. The default matcher sorts entries by descending `q` and returns the first `type` listed in `supports`, or `default`. A custom `match(accepts, config)` can implement other rules, such as wildcard handling.

Sources: [src/helper/accepts/accepts.ts:1-49](repo://src/helper/accepts/accepts.ts#L1-L49), [src/utils/accept.ts:211-214](repo://src/utils/accept.ts#L211-L214)

```ts
import { accepts } from 'hono/accepts'

app.get('/', (c) => {
  const lang = accepts(c, { header: 'Accept-Language', supports: ['en', 'ja'], default: 'en' })
  return c.text(lang === 'ja' ? 'こんにちは' : 'Hello')
})
```

Sources: [src/helper/accepts/accepts.ts:27-49](repo://src/helper/accepts/accepts.ts#L27-L49)

## Connection info

`hono/conninfo` defines only types; each adapter exports its own `getConnInfo(c)` returning a `ConnInfo` whose `remote` holds optional `address`, `addressType` (`'IPv4' | 'IPv6'`), `port` and `transport` (`'tcp' | 'udp'`).

Sources: [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45)

| Adapter | Source of the address |
| --- | --- |
| Cloudflare Workers and Pages | `cf-connecting-ip` header |
| Deno | `c.env.remoteAddr` (hostname, port, transport) |
| Bun | `server.requestIP(c.req.raw)`; throws if the server is not passed to `fetch` |
| AWS Lambda | `requestContext.identity.sourceIp` (API Gateway v1), `requestContext.http.sourceIp` (v2), else the last `x-forwarded-for` entry (ALB) |

Sources: [src/adapter/cloudflare-workers/conninfo.ts:1-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L1-L7), [src/adapter/cloudflare-pages/conninfo.ts:22-26](repo://src/adapter/cloudflare-pages/conninfo.ts#L22-L26), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43), [src/adapter/aws-lambda/conninfo.ts:45-73](repo://src/adapter/aws-lambda/conninfo.ts#L45-L73)

The IP restriction middleware takes a `GetConnInfo` function so it works on any of these runtimes (see [[Security Middleware]]); see [[Runtime Adapters]] and [[AWS Lambda and Lambda@Edge]] for the adapters themselves.

Sources: [src/helper/conninfo/types.ts:42-45](repo://src/helper/conninfo/types.ts#L42-L45), [src/middleware/ip-restriction/index.ts:216-240](repo://src/middleware/ip-restriction/index.ts#L216-L240)

## Adapter helper

### getRuntimeKey

`getRuntimeKey()` returns one of `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`. It first checks `navigator.userAgent` against the prefixes `Deno`, `Bun`, `Cloudflare-Workers` and `Node.js`, then a global `EdgeRuntime` string (Vercel Edge), then a global `fastly`, then `process.release.name === 'node'` for Node versions before 21.1 that lack `navigator.userAgent`.

Sources: [src/helper/adapter/index.ts:8-8](repo://src/helper/adapter/index.ts#L8-L8), [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

### env

`env<T>(c, runtime?)` returns environment variables in the form the runtime provides them, so one app can read configuration on any platform.

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

| Runtime | Source |
| --- | --- |
| `node`, `bun`, `edge-light` | `globalThis.process.env` |
| `deno` | `Deno.env.toObject()` |
| `workerd` | `c.env` (Workers bindings) |
| `fastly`, `other` | `{}` |

Sources: [src/helper/adapter/index.ts:25-40](repo://src/helper/adapter/index.ts#L25-L40)

```ts
import { env, getRuntimeKey } from 'hono/adapter'

app.get('/', (c) => {
  const { API_KEY } = env<{ API_KEY: string }>(c)
  return c.text(`${getRuntimeKey()}: ${API_KEY ? 'configured' : 'missing'}`)
})
```

Sources: [src/helper/adapter/index.ts:10-23](repo://src/helper/adapter/index.ts#L10-L23)

## Dev helper

`inspectRoutes(app)` maps `app.routes` to `{ path, method, name, isMiddleware }`. It unwraps composed handlers with `findTargetHandler`, treats a handler with more than one declared parameter as middleware, and names anonymous functions `[middleware]` or `[handler]`.

Sources: [src/helper/dev/index.ts:16-37](repo://src/helper/dev/index.ts#L16-L37), [src/utils/handler.ts:8-15](repo://src/utils/handler.ts#L8-L15)

`showRoutes(app, { verbose?, colorize? })` prints one line per method and path with the method padded to align paths and coloured green when colour is enabled (default from `getColorEnabled()`). Middleware is hidden unless `verbose` is set; with `verbose`, each handler name for that method and path is listed under it. `getRouterName(app)` triggers one `match('GET', '/')` so a `SmartRouter` settles on its concrete router, then returns `app.router.name` (see [[Routers and SmartRouter]]).

Sources: [src/helper/dev/index.ts:39-79](repo://src/helper/dev/index.ts#L39-L79)

## Route helper

### matchedRoutes and routePath

These functions read the router's match result stored on the request under the `GET_MATCH_RESULT` symbol. `matchedRoutes(c)` returns the `RouterRoute` of every middleware and handler that matched, in execution order. `c.req.routeIndex` is the position of the one currently running, which the [[Request Lifecycle and Middleware Composition]] advances as `next()` is called.

Sources: [src/helper/route/index.ts:1-34](repo://src/helper/route/index.ts#L1-L34), [src/request.ts:55-55](repo://src/request.ts#L55-L55)

`routePath(c, index?)` returns the registered pattern of the route at `index` (default: the current one), with negative indexes counting from the end as in `Array.prototype.at`. In a `'*'` middleware, `routePath(c)` is `'*'` and `routePath(c, -1)` is the final handler's pattern, such as `/posts/:id`, which makes it suitable as a low-cardinality metrics label.

Sources: [src/helper/route/index.ts:36-59](repo://src/helper/route/index.ts#L36-L59)

### baseRoutePath and basePath

`baseRoutePath(c, index?)` returns the `basePath` pattern under which the route was mounted via `app.route()`, for example `/:sub`. `basePath(c, index?)` returns the same prefix with parameters filled in from the actual request path. When the pattern has no `:` or `*`, it is returned as is; otherwise it splits the pattern into segments, and for each parameter segment matches its regex (or `[^/]+`) against the request path to measure how many characters it consumed. The result is cached per context and index in a `WeakMap`.

Sources: [src/helper/route/index.ts:61-141](repo://src/helper/route/index.ts#L61-L141)

```ts
import { routePath, basePath } from 'hono/route'

const sub = new Hono().get('/posts/:id', (c) =>
  c.json({ route: routePath(c), base: basePath(c) }) // { route: '/:sub/posts/:id', base: '/blog' } for GET /blog/posts/1
)
app.route('/:sub', sub)
```

Sources: [src/helper/route/index.ts:58-59](repo://src/helper/route/index.ts#L58-L59), [src/helper/route/index.ts:106-141](repo://src/helper/route/index.ts#L106-L141)
