---
title: "Overview"
---
## Overview

Hono is a web framework built on the Web Standards `Request` and `Response` objects. An app is an object whose `fetch` method takes a `Request`, finds the routes that match it, runs the matched handlers as a chain of middleware, and returns a `Response`. The package entry point exports the `Hono` class, the `Context` class and the types that handlers use.

Sources: [src/index.ts:1-53](repo://src/index.ts#L1-L53)

The `Hono` class is a small subclass of `HonoBase`, which holds all the registration and dispatch code. `Hono` installs the default router: a `SmartRouter` over a `RegExpRouter` and a `TrieRouter`, unless the caller passes its own `router` option. The presets in `src/preset` replace that router with a different one.

Sources: [src/hono.ts:16-33](repo://src/hono.ts#L16-L33)

## The parts

The repository is one package with a directory per part. The table names each part and the page that explains it.

| Part | What it does | Page |
| --- | --- | --- |
| App | Holds the router, the routes list, the error and not-found handlers, and `fetch` | [[The Hono Class]] |
| Registration | `get`, `post` and the other method helpers, `on`, `use`, `route`, `basePath`, `mount` | [[Registering Routes]] |
| Dispatch | Turns one `fetch` call into a match, a `Context` and a `Response` | [[Request Dispatch]] |
| Composition | Runs the matched handlers in order, with `next()` | [[Middleware Composition]] |
| Errors | Default error and not-found responses, `HTTPException` | [[Error Handling]] |
| Context | The `c` object: response builders, headers, variables, rendering | [[Context]] |
| Request | `c.req`: parameters, query, headers, body readers | [[HonoRequest]] |
| Validation | The `validator` middleware and its input targets | [[Validation]] |
| Routers | `SmartRouter`, `RegExpRouter`, `TrieRouter`, `LinearRouter`, `PatternRouter` | [[Router Interface and SmartRouter]] |
| Client | `hc`, a typed fetch client built from the app type | [[Typed Client]] |
| JSX | Server JSX rendering and the browser renderer under `hono/jsx/dom` | [[JSX Rendering]] |
| Middleware | Built-in middleware for auth, responses, requests and static files | [[Authentication Middleware]] |
| Helpers | Cookies, streaming, WebSockets, static site generation, testing | [[Cookies]] |
| Adapters | One entry point per runtime: Lambda, Cloudflare, Vercel, Deno, Bun | [[Runtime Adapters]] |
| Build and tests | The build script, export checks and the test suites | [[Build and Package Exports]] |

Sources: [src/hono-base.ts:126-173](repo://src/hono-base.ts#L126-L173), [src/compose.ts:15-73](repo://src/compose.ts#L15-L73), [src/context.ts:293-361](repo://src/context.ts#L293-L361), [src/request.ts:36-55](repo://src/request.ts#L36-L55), [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/client/client.ts:133-136](repo://src/client/client.ts#L133-L136), [src/jsx/base.ts:140-166](repo://src/jsx/base.ts#L140-L166), [src/helper/cookie/index.ts:99-99](repo://src/helper/cookie/index.ts#L99-L99), [src/helper/ssg/ssg.ts:368-368](repo://src/helper/ssg/ssg.ts#L368-L368), [src/adapter/cloudflare-workers/index.ts:6-8](repo://src/adapter/cloudflare-workers/index.ts#L6-L8), [src/middleware/cors/index.ts:63-63](repo://src/middleware/cors/index.ts#L63-L63)

## Main flow

A request enters at `fetch` and leaves as a `Response`. The diagram shows the path for one request.

Sources: [src/hono-base.ts:406-466](repo://src/hono-base.ts#L406-L466)

```mermaid
flowchart TD
  fetch["fetch(request)"] --> match["router.match(method, path)"]
  match --> ctx["new Context(request, match)"]
  ctx --> count{"one handler?"}
  count -->|yes| call["call the handler directly"]
  count -->|no| compose["compose() runs the chain"]
  compose --> call
  call --> res["c.res holds the Response"]
  call -->|throws| err["onError handler"]
```

Sources: [src/hono-base.ts:406-466](repo://src/hono-base.ts#L406-L466), [src/compose.ts:32-71](repo://src/compose.ts#L32-L71)

Each step in the diagram, in order:

1. `fetch` gives the request to `#dispatch`, which turns `HEAD` into a `GET` and computes the path. [[Request Dispatch]] follows this step.
2. The router returns the handler list for the method and path. [[Router Interface and SmartRouter]] explains the first call, which picks the router.
3. A new `Context` wraps the request and the match result, so each handler reads the same route parameters. [[Context]] lists what it holds.
4. With one handler the app calls it directly. With more, `compose` runs them in order, and each `next()` starts the following handler. [[Middleware Composition]] traces this.
5. A handler sets `c.res`, or returns a `Response`. A throw goes to the error handler, and [[Error Handling]] lists its outcomes.

Sources: [src/hono-base.ts:418-448](repo://src/hono-base.ts#L418-L448), [src/compose.ts:42-65](repo://src/compose.ts#L42-L65)

## Design decisions

These choices affect every part. Each one cites the code that shows it.

**A handler with two parameters is middleware.** `isMiddleware` treats any function whose `length` is above 1 as middleware, and `compose` passes it a `next` function. A handler that takes only `c` ends the chain by returning a response.

Sources: [src/utils/handler.ts:8-8](repo://src/utils/handler.ts#L8-L8), [src/compose.ts:49-51](repo://src/compose.ts#L49-L51)

**The router is chosen on first use.** `SmartRouter` stores the routes until the first `match`, replays them into each candidate router in turn, and keeps the first one that does not throw `UnsupportedPathError`. After that it calls that router's `match` directly, so the choice is paid once per app.

Sources: [src/router/smart-router/router.ts:21-48](repo://src/router/smart-router/router.ts#L21-L48)

**Every registration is recorded.** `#addRoute` gives the router the handler and also pushes a route record onto `routes`, so `app.routes` lists every route in the order it was registered.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

**Two fields are not private `#` fields.** The code says `#` cannot be used for these fields because it needs visibility at JavaScript runtime, so `_basePath` and `errorHandler` are ordinary properties.

Sources: [src/hono-base.ts:119-122](repo://src/hono-base.ts#L119-L122), [src/hono-base.ts:186-188](repo://src/hono-base.ts#L186-L188)

**Percent-encoded paths take a slower branch.** `getPath` scans the URL once and falls back to `indexOf` only when it sees `%`. The code says this is a deliberate trade-off, because most paths contain no percent encoding.

Sources: [src/utils/url.ts:112-116](repo://src/utils/url.ts#L112-L116)

**Strict matching is the default.** The `strict` option defaults to `true`, which keeps a trailing slash significant. With `strict: false` the app uses `getPathNoStrict`, which drops one trailing slash, so `/hello/` and `/hello` match the same route.

Sources: [src/hono-base.ts:46-54](repo://src/hono-base.ts#L46-L54), [src/hono-base.ts:170-172](repo://src/hono-base.ts#L170-L172)
