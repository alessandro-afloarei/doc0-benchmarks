---
type: concept
title: Router Contract and SmartRouter
description: The Router interface every Hono router implements (add/match, the two Result shapes, ALL method, UnsupportedPathError), the supported path syntax, how SmartRouter picks a concrete router on the first request, which router each preset uses, and the shared router test suite.
tags: [routing, router, smart-router, path-syntax]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-9da6594296f4b30b9cdfad4c
    resource: repo://src/router.ts
  - id: openwiki-source-86d2a3b40a9ba67ac42a59d7
    resource: repo://src/router/common.case.test.ts
  - id: openwiki-source-9cec9357b7e8b5786653a61b
    resource: repo://src/router/linear-router/router.test.ts
  - id: openwiki-source-03df3f6bfba94c0fd0184136
    resource: repo://src/router/pattern-router/router.test.ts
  - id: openwiki-source-c473e43628b09e3860c1573f
    resource: repo://src/router/reg-exp-router/router.test.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# Router Contract and SmartRouter

Routing in Hono is pluggable. `HonoBase` only depends on the `Router<T>` interface from `src/router.ts`; concrete routers live under `src/router/*` and are exported individually (`hono/router/reg-exp-router`, `.../trie-router`, `.../smart-router`, `.../linear-router`, `.../pattern-router`).

## The interface

```ts
interface Router<T> {
  name: string
  add(method: string, path: string, handler: T): void
  match(method: string, path: string): Result<T>
}
```

- `T` is, in practice, `[handler, RouterRoute]` (see [Application Object and Request Dispatch](../core/application.md)).
- Method `ALL` (`METHOD_NAME_ALL`) matches every method; `app.use()` and `app.all()` register under it. `METHODS` lists the methods that get shortcut functions (`get`, `post`, `put`, `delete`, `options`, `patch`); others are registered with `app.on()`.
- `match` must return **all** matching entries — middleware and handlers — in **registration order**, which becomes the execution order in [Middleware Composition](../core/middleware-composition.md).

### Result shapes

```ts
type Result<T> =
  | [[T, ParamIndexMap][], ParamStash] // index form: params are indices into the stash
  | [[T, Params][]]                    // value form: params are values
```

`RegExpRouter` (and `PreparedRegExpRouter`) return the index form, where the stash is the regex match array shared by all handlers. `TrieRouter`, `LinearRouter` and `PatternRouter` return the value form. Each handler has its **own** param map — `/user/:id/*` middleware and a `/user/:id/:action` handler see different keys. [HonoRequest](../core/request.md) understands both shapes.

### Errors

- `UnsupportedPathError` — thrown by a router that cannot represent a path (or combination of paths). `SmartRouter` uses it as the signal to try the next router.
- `MESSAGE_MATCHER_IS_ALREADY_BUILT` (`Can not add a route since the matcher is already built.`) — thrown by routers that compile on first match when routes are added afterwards.

## Path syntax

Supported by the default router combination (individual routers have gaps, listed below):

| Pattern | Meaning |
| --- | --- |
| `/posts` | static |
| `/posts/:id` | named param, one segment (`[^/]+`) |
| `/posts/:id{[0-9]+}` | param with custom regex |
| `/posts/:file{.+\\.png}` | regex params may span slashes |
| `/api/animals/:type?` | optional param — registers `/api/animals` and `/api/animals/:type` |
| `/wild/*/card` | `*` inside a path matches one segment |
| `/posts/*` | trailing wildcard — matches `/posts` and anything below |
| `*` or `/*` | everything |
| `www1.example.com/hello` | host-based routing when a custom `getPath` includes the host |

Optional-param expansion is done by `checkOptionalParameter` and param/regex parsing by `getPattern` in `src/utils/url.ts` (cached per label and next segment).

## SmartRouter

`SmartRouter({ routers })` (`src/router/smart-router/router.ts`) defers the choice of router to the first request:

1. `add()` only buffers `[method, path, handler]` tuples.
2. On the first `match()`, it tries each candidate in order: replay **all** buffered routes into it, then call its `match`. If that throws `UnsupportedPathError`, it moves on to the next candidate; other errors propagate.
3. The first router that succeeds becomes permanent: `this.match` is rebound to that router's `match`, the buffer is dropped (later `add()` throws `MESSAGE_MATCHER_IS_ALREADY_BUILT`), and `name` becomes e.g. `SmartRouter + RegExpRouter`. `activeRouter` exposes it (and throws before selection).
4. If no candidate accepts the routes, it throws `Fatal error`.

Implications:

- **All routes must be registered before the first request.** This is the norm for Hono apps; registering lazily inside a handler will fail.
- Unsupported-path errors surface on the first request, not at registration.
- `getRouterName(app)` from `hono/dev` forces a match to reveal the active router.

## Router selection by entry point

| Entry | Router(s) | Choose when |
| --- | --- | --- |
| `hono` | `SmartRouter([RegExpRouter, TrieRouter])` (overridable via `new Hono({ router })`) | Default; fastest matching for long-lived processes. |
| `hono/quick` | `SmartRouter([LinearRouter, TrieRouter])` | App is constructed per request (cheap registration matters more than match speed). |
| `hono/tiny` | `PatternRouter` | Bundle size is the priority. |

Router internals: [RegExpRouter and PreparedRegExpRouter](reg-exp-router.md), [TrieRouter, LinearRouter, and PatternRouter](trie-linear-pattern-routers.md).

## Shared test suite

`src/router/common.case.test.ts` exports `runTest({ newRouter, skip })`, a battery of cases (registration order, multi-match, duplicate param names, optional routes, wildcards, regex params with slashes, capture groups, trailing slashes, hostnames, non-ASCII paths, unknown methods) run against every router. Each router's `router.test.ts` lists the cases it skips and why, which documents each router's limitations:

- **RegExpRouter** skips duplicate param names in parent/child routes, complex capture groups, some multi-directory regex captures, `{.*}` params, and an ambiguous `:label` vs. static file case (all `UnsupportedPath`).
- **LinearRouter** skips per-handler params for certain multi-match cases, regex params followed by a wildcard, and `{.*}` params; it also tolerates trailing slashes.
- **PatternRouter** rejects the same param name twice in one path and tolerates trailing slashes.
