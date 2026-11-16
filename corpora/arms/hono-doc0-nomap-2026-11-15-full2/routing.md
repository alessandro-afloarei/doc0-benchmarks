---
title: "Routing and Path Patterns"
---
## Overview

Routing in Hono is a contract between three parts. The application turns each registration into `router.add(method, path, [handler, route])`; at request time `getPath` extracts the path from the URL and `router.match(method, path)` returns every handler whose pattern matches, in registration order, with the parameters each one captured. The path syntax described on this page is shared by all five routers; they differ in speed and in which patterns they accept, not in meaning. [[Router Implementations]] compares them.

Sources: [src/router.ts:24-52](repo://src/router.ts#L24-L52), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/hono-base.ts:418-419](repo://src/hono-base.ts#L418-L419)

A match result is a list, not a single winner. Its two shapes (handlers with indexes into a shared parameter array, or handlers with their own parameter objects) are documented on the `Result` type; both carry one parameter map per handler.

Sources: [src/router.ts:54-98](repo://src/router.ts#L54-L98)

## Path syntax

### Pattern reference

Each path segment is static text, a named parameter, a parameter with a regular expression, or a wildcard. `getPattern` classifies a segment: `*` is the wildcard, `:name` is a parameter that matches one segment, and `:name{regex}` is a parameter that must match `regex`.

Sources: [src/utils/url.ts:50-78](repo://src/utils/url.ts#L50-L78)

| Pattern | Example | Matches | Parameters |
| --- | --- | --- | --- |
| Static | `/about` | `/about` only | none |
| Named parameter | `/entry/:id` | `/entry/123`, not `/entry-123` | `id: '123'` |
| Several parameters | `/posts/:id/comments/:comment_id` | `/posts/1/comments/2` | `id`, `comment_id` |
| Optional parameter | `/api/animals/:type?` | `/api/animals` and `/api/animals/dog` | `type` is `undefined` when absent |
| Regex parameter | `/post/:date{[0-9]+}/:title{[a-z]+}` | `/post/20210101/hello`, not `/post/123/123` | `date`, `title` |
| Regex across slashes | `/js/:filename{[a-z0-9/]+.js}` | `/js/chunk/nest/123.js` | `filename: 'chunk/nest/123.js'` |
| Catch-all regex | `/files/:name{.*}` | `/files/a/b`, `/files/` | `name: 'a/b'` |
| Trailing wildcard | `/api/*` | `/api`, `/api/posts` | none |
| Inner wildcard | `/wild/*/card` | `/wild/xxx/card` | none |
| Everything | `*` | every path | none |

Sources: [src/router/common.case.test.ts:109-191](repo://src/router/common.case.test.ts#L109-L191), [src/router/common.case.test.ts:373-412](repo://src/router/common.case.test.ts#L373-L412), [src/router/common.case.test.ts:496-525](repo://src/router/common.case.test.ts#L496-L525)

### Named and regex parameters

`getPattern` parses a label with `^\:([^\{\}]+)(?:\{(.+)\})?$`: group 1 is the name and group 2 the optional regular expression. A plain parameter becomes `[label, name, true]`. A regex parameter becomes a `RegExp` anchored as `^regex$`, unless the next segment is static, in which case it is compiled as `^regex(?=/next)` so a greedy expression stops before that segment. Results are cached by `label#next`, so a pattern repeated across routes compiles once.

Sources: [src/utils/url.ts:50-78](repo://src/utils/url.ts#L50-L78)

Regular expressions may contain groups, including non-capturing ones, and the parameter still receives the whole segment:

Sources: [src/router/common.case.test.ts:804-889](repo://src/router/common.case.test.ts#L804-L889)

```ts
app.get('/foo/:capture{(bar|baz)}', (c) => c.text(c.req.param('capture'))) // 'bar' or 'baz'
app.get('/foo/:capture{ba(?:r|z)}', (c) => c.text(c.req.param('capture')))
app.get('/:dirs{.+}/file.html', (c) => c.text(c.req.param('dirs'))) // '/foo/bar/file.html' -> 'foo/bar'
```

Sources: [src/router/common.case.test.ts:527-538](repo://src/router/common.case.test.ts#L527-L538), [src/router/common.case.test.ts:830-878](repo://src/router/common.case.test.ts#L830-L878)

### Splitting a route path

A regular expression may contain `/`, so a route path cannot simply be split on slashes. `splitRoutingPath` first replaces every `{...}` group with a placeholder (`@` plus its index) in `extractGroupsFromPath`, splits the remaining path with `splitPath`, and puts the groups back with `replaceGroupMarks`. `TrieRouter` uses it to insert each route, and the `hono/route` helper uses it too.

Sources: [src/utils/url.ts:8-48](repo://src/utils/url.ts#L8-L48), [src/router/trie-router/node.ts:44-85](repo://src/router/trie-router/node.ts#L44-L85)

### Optional parameters

A trailing `?` marks a parameter as optional. Routers do not handle `?` while matching; instead `checkOptionalParameter` expands the route into every path it stands for and each is added separately. It returns `null` unless the path ends with `?` and contains `:`. Otherwise it walks the segments and, at each optional parameter, records the path so far and the path with the parameter.

Sources: [src/utils/url.ts:171-206](repo://src/utils/url.ts#L171-L206), [src/router/trie-router/router.ts:13-23](repo://src/router/trie-router/router.ts#L13-L23), [src/router/reg-exp-router/router.ts:189-200](repo://src/router/reg-exp-router/router.ts#L189-L200)

| Route | Expanded paths |
| --- | --- |
| `/api/animals/:type?` | `/api/animals`, `/api/animals/:type` |
| `/v1/:version?/:platform?` | `/v1`, `/v1/:version`, `/v1/:version/:platform` |
| `/:id?` | `/`, `/:id` |
| `/:prefix{.+}/contents/:id?` | `/:prefix{.+}/contents`, `/:prefix{.+}/contents/:id` |

Sources: [src/utils/url.ts:171-206](repo://src/utils/url.ts#L171-L206), [src/router/common.case.test.ts:373-412](repo://src/router/common.case.test.ts#L373-L412), [src/router/common.case.test.ts:604-624](repo://src/router/common.case.test.ts#L604-L624)

Because the check looks only at the last character, only trailing optional parameters are recognised. The type system follows the same rule: `c.req.param('type')` on `/api/:version/animal/:type?` is typed `string | undefined`, while `version` stays `string`.

Sources: [src/hono.test.ts:2520-2549](repo://src/hono.test.ts#L2520-L2549)

### Wildcards

`*` matches any remainder, including nothing, so `/api/*` also matches `/api`, and `/:id{[0-9]+}/*` matches `/123`. A bare `*`, which is what `app.use(handler)` registers, matches every path. Wildcards capture no parameter; use a regex parameter such as `:rest{.*}` to read the remainder, which yields an empty string for an empty remainder.

Sources: [src/router/common.case.test.ts:165-190](repo://src/router/common.case.test.ts#L165-L190), [src/router/common.case.test.ts:553-564](repo://src/router/common.case.test.ts#L553-L564), [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168), [src/hono.test.ts:3747-3759](repo://src/hono.test.ts#L3747-L3759)

## Methods

Routes are stored by upper-case method name. `app.get`, `app.post` and the other method functions cover the six methods in `METHODS`; `app.on` accepts any name, such as `PURGE`, or an array of names. `app.all` and `app.use` register under `ALL` (`METHOD_NAME_ALL`), which matches every method, including methods the app never registered.

Sources: [src/router.ts:5-17](repo://src/router.ts#L5-L17), [src/hono-base.ts:126-168](repo://src/hono-base.ts#L126-L168), [src/router/common.case.test.ts:891-907](repo://src/router/common.case.test.ts#L891-L907)

A `HEAD` request never reaches the router as `HEAD`: dispatch runs it as `GET` and strips the body, so every `GET` route answers `HEAD` too. `c.req.method` still reports `HEAD` inside the handler.

Sources: [src/hono-base.ts:412-416](repo://src/hono-base.ts#L412-L416), [src/hono.test.ts:2853-2882](repo://src/hono.test.ts#L2853-L2882)

## Ordering and multiple matches

### Registration order

The router returns every matching handler, middleware and route handlers alike, in the order they were registered, and `compose` runs them in that order. The chain stops at the first handler that returns a response without calling `next()`, so order is what decides which handler answers.

Sources: [src/router/common.case.test.ts:193-211](repo://src/router/common.case.test.ts#L193-L211), [src/compose.ts:32-71](repo://src/compose.ts#L32-L71)

```ts
app.get('/api/*', authMiddleware) // runs first for /api and /api/posts
app.get('/api', top)
app.get('/api/posts', posts)
app.get('/api/*', fallback)       // runs only if posts or top call next()
```

Sources: [src/router/common.case.test.ts:174-190](repo://src/router/common.case.test.ts#L174-L190)

> [!TIP]
> Register middleware before the routes it should wrap, and catch-all fallbacks after them. A `*` handler registered after a route that returns a response never runs for that route.

Sources: [src/router/common.case.test.ts:193-211](repo://src/router/common.case.test.ts#L193-L211)

### Parameters per handler

Each matched handler gets its own parameter map. For `/entry/123/show`, a `*` middleware sees no parameters, an `/entry/:id/*` middleware sees `id`, and the `/entry/:id/:action` handler sees both. `c.req.param()` reads the map of the handler currently running, using `c.req.routeIndex`, which `compose` updates before each call.

Sources: [src/router/common.case.test.ts:268-288](repo://src/router/common.case.test.ts#L268-L288), [src/request.ts:102-124](repo://src/request.ts#L102-L124), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

### Inspecting the matched route

The `RouterRoute` record stored with each handler is available at request time. `matchedRoutes(c)` from `hono/route` returns every matched record, and `routePath(c)` returns the registered pattern of the current handler, or of another one by index (`-1` for the last). The older `c.req.matchedRoutes` and `c.req.routePath` getters do the same and are deprecated.

Sources: [src/helper/route/index.ts:6-59](repo://src/helper/route/index.ts#L6-L59), [src/request.ts:418-442](repo://src/request.ts#L418-L442)

## Grouping and prefixes

### basePath and route

`app.basePath('/api')` returns an app whose registrations are prefixed with `/api`, and `app.route('/books', books)` copies another app's routes under `/books`. Both rely on `mergePath` in `#addRoute`, and both record the prefix as the route's `basePath`. [[The Hono Application]] describes how they share the router.

Sources: [src/hono-base.ts:208-253](repo://src/hono-base.ts#L208-L253), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

```ts
const book = new Hono().basePath('/book')
book.get('/:id', (c) => c.text('book'))

const app = new Hono()
app.route('/api', book) // GET /api/book/:id, route basePath '/api/book'
```

Sources: [src/hono.test.ts:522-536](repo://src/hono.test.ts#L522-L536)

### mergePath

`mergePath(base, sub, ...rest)` joins path pieces with exactly one slash between them, adds a leading slash when `base` has none, and treats a `sub` of `/` as empty, so a route registered as `/` under a prefix gets no trailing slash. This is why `app.basePath('/book').get('/', ...)` answers `/book` and not `/book/`, and why `user.basePath(':id')` works without a leading slash.

Sources: [src/utils/url.ts:148-169](repo://src/utils/url.ts#L148-L169), [src/hono.test.ts:425-472](repo://src/hono.test.ts#L425-L472)

| Call | Result |
| --- | --- |
| `mergePath('/api', '/users')` | `/api/users` |
| `mergePath('/api/', '/users')` | `/api/users` |
| `mergePath('/api', '/')` | `/api` |
| `mergePath('/api/', '/')` | `/api/` |
| `mergePath('/api', '*')` | `/api/*` |

Sources: [src/utils/url.ts:148-169](repo://src/utils/url.ts#L148-L169)

## Extracting the request path

### getPath

The default `getPath` avoids `new URL()` for speed. It finds the first `/` after the scheme (`url.indexOf('/', url.indexOf(':') + 4)`), then scans character codes until `?` or `#`. Only if it meets a `%` does it switch to `indexOf` for the end and decode the path with `tryDecodeURI`.

Sources: [src/utils/url.ts:106-134](repo://src/utils/url.ts#L106-L134)

Decoding happens once for the path and once more per parameter. `decodeURI` leaves reserved characters such as `%2F` encoded, so `/users/hono%2Fposts` matches `/users/:id` and `c.req.param('id')` decodes it to `hono/posts`. Before decoding, `getPath` doubles every `%25` so a literally encoded `%` is not decoded twice: `/users/%2525` yields the parameter `%25`. Invalid sequences are left as they are by `tryDecode` instead of throwing.

Sources: [src/utils/url.ts:80-104](repo://src/utils/url.ts#L80-L104), [src/utils/url.ts:126-127](repo://src/utils/url.ts#L126-L127), [src/request.ts:106-110](repo://src/request.ts#L106-L110), [src/hono.test.ts:791-848](repo://src/hono.test.ts#L791-L848)

### Strict mode

Strict mode is the default: `/hello` and `/hello/` are different routes. With `new Hono({ strict: false })` the app uses `getPathNoStrict`, which removes one trailing slash from any path longer than `/`, so both requests reach a `/hello` route. For redirects between the two forms instead, see the trailing-slash middleware in [[Utility Middleware]].

Sources: [src/utils/url.ts:141-146](repo://src/utils/url.ts#L141-L146), [src/hono-base.ts:170-172](repo://src/hono-base.ts#L170-L172), [src/hono.test.ts:310-360](repo://src/hono.test.ts#L310-L360)

### Custom getPath

The `getPath` option replaces path extraction entirely, which allows routing on more than the pathname. Prefixing the `Host` header makes the host part of every route:

Sources: [src/hono-base.ts:66-86](repo://src/hono-base.ts#L66-L86)

```ts
const app = new Hono({
  getPath: (req) =>
    '/' + req.headers.get('host') + req.url.replace(/^https?:\/\/[^/]+(\/[^?]*)/, '$1'),
})

app.get('/www1.example.com/hello', (c) => c.text('hello www1'))
```

Sources: [src/hono-base.ts:71-84](repo://src/hono-base.ts#L71-L84)

The function also receives the runtime bindings as `options.env`, because dispatch calls `this.getPath(request, { env })`. A custom `getPath` is ignored when `strict: false` is also set.

Sources: [src/hono-base.ts:44](repo://src/hono-base.ts#L44), [src/hono-base.ts:418](repo://src/hono-base.ts#L418), [src/hono.test.ts:736-760](repo://src/hono.test.ts#L736-L760)

## Query strings

Query parsing lives in the same module. `c.req.query(key)` calls `getQueryParam`, and `c.req.queries(key)` calls `getQueryParams` for repeated keys. For a single key without `%` or `+`, `_getQueryParam` scans the URL for `?key=` or `&key=` and decodes only that value; otherwise it walks all pairs, decodes `+` as a space and percent escapes through `tryDecode`, and keeps the first value of a repeated key (or every value, for `queries`).

Sources: [src/utils/url.ts:208-315](repo://src/utils/url.ts#L208-L315), [src/request.ts:148-172](repo://src/request.ts#L148-L172)

[[HonoRequest]] covers the request readers, and [[Validator]] turns query and path input into typed values.

Sources: [src/request.ts:94-110](repo://src/request.ts#L94-L110)
