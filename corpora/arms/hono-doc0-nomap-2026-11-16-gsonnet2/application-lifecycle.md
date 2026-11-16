---
title: "Application and Request Lifecycle"
---
## Overview

`HonoBase` in `src/hono-base.ts` is the application class. It records routes in a router, and when a request arrives it matches the path, builds a `Context`, and runs the handlers. It is the glue between the router ([[Router Interface and SmartRouter]]), the handler chain ([[Middleware Composition and Error Handling]]) and the per-request object ([[Context and Responses]]).

Sources: [src/hono-base.ts:98-126](repo://src/hono-base.ts#L98-L126)

`HonoBase` has no router of its own. Its comment calls it "like an abstract class": a subclass must assign `this.router` in its constructor. The exported `Hono` class in `src/hono.ts` does that with a `SmartRouter` over `RegExpRouter` and `TrieRouter`, unless `options.router` is given.

Sources: [src/hono-base.ts:114-118](repo://src/hono-base.ts#L114-L118), [src/hono.ts:16-34](repo://src/hono.ts#L16-L34)

## Registering routes

The constructor builds the registration methods at runtime. For each of `get`, `post`, `put`, `delete`, `options`, `patch` and `all`, it defines a function that accepts either `(path, ...handlers)` or `(...handlers)`. A string first argument sets the private `#path`; handlers without a path reuse the last path, which is what makes chained calls like `app.get('/a', h1).post(h2)` target the same path.

Sources: [src/hono-base.ts:126-141](repo://src/hono-base.ts#L126-L141), [src/router.ts:17](repo://src/router.ts#L17)

`app.on(method, path, ...handlers)` accepts arrays for both method and path and registers every combination, upper-casing the method. `app.use` registers handlers under the method `ALL`; without a path it uses `*`.

Sources: [src/hono-base.ts:143-168](repo://src/hono-base.ts#L143-L168)

Every method ends in `#addRoute`. It upper-cases the method, prefixes the path with the app's `_basePath` through `mergePath`, builds a `RouterRoute` record (`basePath`, `path`, `method`, `handler`), calls `router.add(method, path, [handler, r])` and pushes the record to `this.routes`.

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

```ts
#addRoute(method: string, path: string, handler: H, baseRoutePath?: string): void {
  method = method.toUpperCase()
  path = mergePath(this._basePath, path)
  const r: RouterRoute = { basePath: /* … */, path, method, handler }
  this.router.add(method, path, [handler, r])
  this.routes.push(r)
}
```

Sources: [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

`mergePath` joins segments with exactly one slash and treats a sub path of `/` as empty, so `mergePath('/api', '/')` is `/api`.

Sources: [src/utils/url.ts:158-169](repo://src/utils/url.ts#L158-L169)

## Options

`HonoOptions` has three fields. `router` replaces the default router, `getPath` customises how the path is derived from the request (for example to route on the host header), and `strict` (default `true`) controls whether a trailing slash matters. In the constructor `strict` is separated from the other options, which are copied onto the instance with `Object.assign`; `getPath` becomes the default `getPath` from `src/utils/url.ts` when strict, or `getPathNoStrict` when not.

Sources: [src/hono-base.ts:46-87](repo://src/hono-base.ts#L46-L87), [src/hono-base.ts:170-173](repo://src/hono-base.ts#L170-L173)

`getPath` reads the path straight out of `request.url` by scanning for the first `/` after the scheme and stopping at `?` or `#`. Only when it meets a `%` does it fall back to slicing and decoding with `tryDecodeURI`, which keeps the common, unencoded case cheap.

Sources: [src/utils/url.ts:106-134](repo://src/utils/url.ts#L106-L134)

## Grouping, base paths and mounting

`basePath(path)` returns a clone of the app (`#clone`) that shares the same router, `routes` array and error/not-found handlers but has `_basePath` set to the merged path. Routes added on the clone therefore land in the shared router with the prefix already applied.

Sources: [src/hono-base.ts:175-184](repo://src/hono-base.ts#L175-L184), [src/hono-base.ts:247-253](repo://src/hono-base.ts#L247-L253)

`route(path, app)` copies another app's routes under a prefix. It takes `this.basePath(path)` and replays each entry of `app.routes` through `#addRoute`, passing the route's own `basePath` as the fourth argument. If the sub-app has a custom `onError` handler, each handler is wrapped so errors thrown inside it are handled by the sub-app's handler first; the original is kept under the `COMPOSED_HANDLER` symbol. See [[Middleware Composition and Error Handling]] for what that wrapper does.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232)

`mount(path, applicationHandler, options)` attaches a handler written for another framework. It registers one `ALL` route at `path + '*'`. That route strips the mount prefix from the URL (unless `replaceRequest` is given, or is `false` to pass the request unchanged), calls the foreign handler with the options it computes, and returns its response; when the foreign handler returns nothing it calls `next()`. By default the extra arguments are `[c.env, executionContext]`, where reading `c.executionCtx` is wrapped in `try/catch` because it throws when absent.

Sources: [src/hono-base.ts:328-383](repo://src/hono-base.ts#L328-L383), [src/context.ts:391-397](repo://src/context.ts#L391-L397)

## Entry points

`fetch(request, env, executionCtx)` is the integration point: it calls `#dispatch(request, rest[1], rest[0], request.method)`. `request(input, init, env, executionCtx)` is a test helper that builds a `Request` — a path becomes `http://localhost` plus the merged path — and calls `fetch`. `fire()` registers a service-worker `fetch` listener and is marked deprecated in favour of `fire` from `hono/service-worker`.

Sources: [src/hono-base.ts:479-542](repo://src/hono-base.ts#L479-L542)

## Dispatch

```mermaid
flowchart TD
  start["#dispatch"] --> head{"method is HEAD?"}
  head -->|yes| getRun["dispatch as GET, drop body"]
  head -->|no| path["getPath + router.match"]
  path --> ctx["new Context"]
  ctx --> one{"one matched handler?"}
  one -->|yes| call["call handler with notFound as next"]
  one -->|no| comp["compose then check finalized"]
  call --> out["Response"]
  comp --> out
```

Sources: [src/hono-base.ts:406-466](repo://src/hono-base.ts#L406-L466)

A `HEAD` request is re-dispatched as `GET`, and the resulting response is rewrapped as `new Response(null, response)`, so handlers written for `GET` answer `HEAD` with headers only.

Sources: [src/hono-base.ts:412-416](repo://src/hono-base.ts#L412-L416)

Otherwise `#dispatch` computes `path = this.getPath(request, { env })`, calls `this.router.match(method, path)` and constructs a `Context` with the path, the match result, `env`, the execution context and the not-found handler. The match result is `[handlers, paramStash?]`; each entry is `[[handler, route], params]`, which is why the code indexes `matchResult[0][0][0][0]` to reach the first handler function.

Sources: [src/hono-base.ts:418-428](repo://src/hono-base.ts#L418-L428), [src/router.ts:98](repo://src/router.ts#L98)

When exactly one handler matched, `compose` is skipped. The handler is called with a `next` that stores the not-found response in `c.res`. A synchronous throw goes to `#handleError`. If the handler returns a promise, the result is its resolved `Response`; if it resolved to nothing, the code uses `c.res` when `c.finalized` is true and calls the not-found handler otherwise. A synchronous return of `undefined` also becomes the not-found response.

Sources: [src/hono-base.ts:429-448](repo://src/hono-base.ts#L429-L448)

With more than one handler the code builds `compose(matchResult[0], this.errorHandler, this.#notFoundHandler)` and awaits it with the context. If the chain ends without `context.finalized`, it throws an error reading "Context is not finalized. Did you forget to return a Response object or `await next()`?", which `#handleError` turns into a response. Otherwise it returns `context.res`.

Sources: [src/hono-base.ts:450-465](repo://src/hono-base.ts#L450-L465)

## Errors and not-found

`onError(handler)` and `notFound(handler)` replace the defaults, which return `404 Not Found` as text and, for errors, either an `HTTPException`'s own response or `Internal Server Error` with status 500 after `console.error`. `#handleError` passes an `Error` to `this.errorHandler` and rethrows anything that is not an `Error`.

Sources: [src/hono-base.ts:31-42](repo://src/hono-base.ts#L31-L42), [src/hono-base.ts:271-294](repo://src/hono-base.ts#L271-L294), [src/hono-base.ts:399-404](repo://src/hono-base.ts#L399-L404)
