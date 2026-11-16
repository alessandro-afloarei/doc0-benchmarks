---
type: subsystem
title: Routers
description: The Router interface and its two Result formats, and how Hono's five router implementations — RegExpRouter, TrieRouter, SmartRouter, LinearRouter and PatternRouter — register and match routes, their trade-offs, the UnsupportedPathError fallback, and the shared conformance suite.
tags: [routing, router, regexp-router, trie-router, smart-router, performance]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T16:39:44.364Z
sources:
  - id: openwiki-source-9da6594296f4b30b9cdfad4c
    resource: repo://src/router.ts
  - id: openwiki-source-86d2a3b40a9ba67ac42a59d7
    resource: repo://src/router/common.case.test.ts
  - id: openwiki-source-19f59037af69fc63452ad634
    resource: repo://src/router/linear-router/router.ts
  - id: openwiki-source-0ae7920a04cee4b2a2fce27c
    resource: repo://src/router/pattern-router/router.ts
  - id: openwiki-source-0bf513eef7e628cf93e0998a
    resource: repo://src/router/reg-exp-router/matcher.ts
  - id: openwiki-source-5c610df654eb4e3e940cc992
    resource: repo://src/router/reg-exp-router/node.ts
  - id: openwiki-source-6963434523d24c18fc4c46f3
    resource: repo://src/router/reg-exp-router/router.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
  - id: openwiki-source-d04794538a9045465e3d0b2b
    resource: repo://src/router/trie-router/node.ts
  - id: openwiki-source-ee6f9e0e88c16e0a26b8cdb5
    resource: repo://src/router/trie-router/router.test.ts
generated: { by: "claude-code", at: "2026-11-16T16:39:44.364Z" }
---

# Routers

The routers decide which handlers and middleware run for a `(method, path)` pair. They are pluggable: `HonoBase` only depends on the `Router<T>` interface in `src/router.ts`, and the presets choose an implementation (see [Architecture Overview](../architecture/overview.md)). The results are consumed by `#dispatch` and `compose` (see [Request Lifecycle](../architecture/request-lifecycle.md)).

## Contract

```ts
interface Router<T> {
  name: string
  add(method: string, path: string, handler: T): void
  match(method: string, path: string): Result<T>
}
type Result<T> =
  | [[T, ParamIndexMap][], ParamStash]   // index form (RegExpRouter)
  | [[T, Params][]]                      // object form (others)
```

- `T` is `[handler, RouterRoute]` in `HonoBase`.
- **Every** matching handler is returned (middleware *and* handlers), **in registration order**. Ordering is what makes the onion model and "first response wins" work.
- `method` is upper-cased. `ALL` (`METHOD_NAME_ALL`) matches every method.
- In the index form, the router returns one param stash (the regex match array) plus a per-handler map from param name to stash index. This avoids building one params object per handler. `HonoRequest.param()` handles both forms (see [Context and HonoRequest](../architecture/context-and-request.md)).
- A router may throw `UnsupportedPathError` for a route pattern it cannot represent. After the first match, the RegExp and Smart routers throw `MESSAGE_MATCHER_IS_ALREADY_BUILT` if you call `add()` again.

### Path syntax supported by all routers

The syntax is static segments, `:name` params, `:name{regex}` constrained params, optional trailing params `:name?` (expanded by `checkOptionalParameter` into two routes), and wildcards `*` (one or more segments) and trailing `/*`. `src/router/common.case.test.ts` exports `runTest({ newRouter, skip })`, a conformance suite that every router's `router.test.ts` runs. Known gaps are listed in `skip` with a reason.

## Implementations

### RegExpRouter (`src/router/reg-exp-router`)

This is the default fast path. Registration only records routes. On the **first `match()`**, `buildAllMatchers()` compiles a single regular expression per HTTP method:

- Static routes (no `*` or `/:`) go into a `staticMap`, so they are answered with a hash lookup before any regex runs.
- Dynamic routes are inserted into a `Trie` that emits one combined regex. Each route ends in an empty capture group, and `match.indexOf('', 1)` finds which route matched in a single `exec`.
- Middleware (wildcard paths) is merged into every concrete route it covers when the route is registered (`findMiddleware`). One match therefore returns the route's complete handler list.
- After the build, the registration maps are released and `match` is replaced by a closure that does no further setup.

Limitation: patterns that one deterministic regex cannot express throw `PATH_ERROR` → `UnsupportedPathError`. Examples are two different param regexes at the same position, a param next to a conflicting static sibling, a `.*` param pattern, or capturing groups inside `{…}`. `PreparedRegExpRouter`, together with `buildInitParams`/`serializeInitParams`, can pre-compute the matcher at build time so that cold starts skip compilation.

### TrieRouter (`src/router/trie-router`)

This router handles every pattern. Each `add` inserts the route into a segment trie (`node.ts`) with a sequence number (`score`). `search` walks the trie, collects every matching handler set (static, param, wildcard), and **sorts them by score**, which restores registration order. It is slower than RegExpRouter on large route tables, but it never throws `UnsupportedPathError` and has no build step.

### SmartRouter (`src/router/smart-router`)

SmartRouter is a meta-router. It buffers `add()` calls. On the first `match()`, it replays all routes into each candidate router in order, and uses the **first one that does not throw `UnsupportedPathError`**. Then it:

- replaces its own `match` with the chosen router's bound `match`, so later requests pay nothing extra;
- drops the other routers and the buffered routes;
- renames itself, for example `SmartRouter + RegExpRouter`. `hono/dev`'s `getRouterName(app)` reports this name, and tests assert on it.

Other errors propagate. If no candidate accepts the routes, it throws `Fatal error`.

### LinearRouter (`src/router/linear-router`)

`add` is a plain array push, and `match` scans every route with hand-written string matching (no regex compilation, except for `{…}` constraints). Registration is very cheap and matching is O(routes). This suits environments that build the app on every request (`hono/quick`). Routes that combine `*` and `:param` throw `UnsupportedPathError` at match time, and SmartRouter then falls back to TrieRouter.

### PatternRouter (`src/router/pattern-router`)

Each route is compiled to its own `RegExp` with named groups. `match` tests all of them in order. This is the smallest implementation (`hono/tiny`). Optional params register two routes, and an invalid regex throws `UnsupportedPathError`.

## Choosing and extending

| Preset | Router | Optimised for |
| --- | --- | --- |
| `hono` | `SmartRouter[RegExpRouter, TrieRouter]` | Long-lived processes: matching throughput |
| `hono/quick` | `SmartRouter[LinearRouter, TrieRouter]` | Short-lived isolates: registration cost |
| `hono/tiny` | `PatternRouter` | Bundle size |

You can pass a custom router with `new Hono({ router })`. It must keep insertion order across method and wildcard matches, and it should run the shared `runTest` suite. Router benchmarks live in `benchmarks/routers` and `benchmarks/routers-deno` (see [Build, Packaging and Release](../operations/build-and-release.md)).
