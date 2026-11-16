---
type: architecture
title: Routers
description: The Router interface and its two Result formats, and how SmartRouter, RegExpRouter, PreparedRegExpRouter, TrieRouter, PatternRouter and LinearRouter work, which path syntax each supports, and how they are tested against a shared case suite.
tags: [router, routing, regexp-router, trie-router, smart-router, performance]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T06:17:44.986Z
sources:
  - id: openwiki-source-9da6594296f4b30b9cdfad4c
    resource: repo://src/router.ts
  - id: openwiki-source-86d2a3b40a9ba67ac42a59d7
    resource: repo://src/router/common.case.test.ts
  - id: openwiki-source-9cec9357b7e8b5786653a61b
    resource: repo://src/router/linear-router/router.test.ts
  - id: openwiki-source-19f59037af69fc63452ad634
    resource: repo://src/router/linear-router/router.ts
  - id: openwiki-source-03df3f6bfba94c0fd0184136
    resource: repo://src/router/pattern-router/router.test.ts
  - id: openwiki-source-0ae7920a04cee4b2a2fce27c
    resource: repo://src/router/pattern-router/router.ts
  - id: openwiki-source-f8af1cdcb105299a62924a9b
    resource: repo://src/router/reg-exp-router/index.ts
  - id: openwiki-source-0bf513eef7e628cf93e0998a
    resource: repo://src/router/reg-exp-router/matcher.ts
  - id: openwiki-source-5c610df654eb4e3e940cc992
    resource: repo://src/router/reg-exp-router/node.ts
  - id: openwiki-source-72a70287fb9670bc0929a9f1
    resource: repo://src/router/reg-exp-router/prepared-router.ts
  - id: openwiki-source-c473e43628b09e3860c1573f
    resource: repo://src/router/reg-exp-router/router.test.ts
  - id: openwiki-source-6963434523d24c18fc4c46f3
    resource: repo://src/router/reg-exp-router/router.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
  - id: openwiki-source-d04794538a9045465e3d0b2b
    resource: repo://src/router/trie-router/node.ts
  - id: openwiki-source-ee6f9e0e88c16e0a26b8cdb5
    resource: repo://src/router/trie-router/router.test.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T06:17:44.986Z" }
---

# Routers

Routers map `(method, path)` to the ordered list of every registered handler that matches. That list includes middleware. Hono ships five router implementations behind a single interface in `src/router.ts`. The application chooses one when it is constructed (see [Architecture overview](overview.md)).

## Contract

```ts
interface Router<T> {
  name: string
  add(method: string, path: string, handler: T): void
  match(method: string, path: string): Result<T>
}
type Result<T> = [[T, ParamIndexMap][], ParamStash] | [[T, Params][]]
```

- In the app, `T` is `[handler, RouterRoute]` (see [Request lifecycle](request-lifecycle.md)).
- **Result format 1** (RegExpRouter): each handler carries a `ParamIndexMap` such as `{ id: 1 }`, which indexes into a shared `ParamStash` (the regexp match array). Parameter strings are extracted lazily.
- **Result format 2** (Trie, Pattern, Linear): each handler carries its own resolved `Params` object.
- `HonoRequest` understands both formats. Code that consumes a `Result` must check for a second element before reading params.
- Handlers must be returned in registration order. Middleware relies on this order.
- `METHOD_NAME_ALL` (`'ALL'`) routes match every method.
- A router throws `UnsupportedPathError` for a pattern it cannot represent. `SmartRouter` uses that error to fall back to the next router.
- `MESSAGE_MATCHER_IS_ALREADY_BUILT` is thrown when `add` is called after a router that compiles has built its matcher.

### Path syntax handled by the routers

| Syntax | Meaning |
| --- | --- |
| `/users/:id` | Named parameter (a single segment) |
| `/post/:id{[0-9]+}` | Parameter constrained by a regexp |
| `/api/animals/:type?` | Optional trailing parameter. `checkOptionalParameter` in `src/utils/url.ts` expands it into `['/api/animals', '/api/animals/:type']` |
| `/wild/*`, `*` | Wildcards. A trailing `/*` also matches the bare prefix |
| `/foo/*/bar` | Mid-path wildcard (not supported by every router) |

## SmartRouter (`src/router/smart-router/router.ts`)

SmartRouter is a meta-router. `add()` only buffers routes. On the first `match()`, it replays all buffered routes into each candidate router in turn and attempts the match. A candidate that throws `UnsupportedPathError` is skipped. The first one that succeeds is kept: SmartRouter replaces its own `match` with that router's bound `match`, drops the buffered routes, and renames itself `"SmartRouter + <Name>"` (`hono/dev`'s `getRouterName` reports this name). From then on, `add()` throws `MESSAGE_MATCHER_IS_ALREADY_BUILT`. `activeRouter` exposes the chosen router once a match has run.

The default `Hono` combines `[RegExpRouter, TrieRouter]`: RegExpRouter for speed, TrieRouter as the fallback that handles everything. `hono/quick` combines `[LinearRouter, TrieRouter]`.

## RegExpRouter (`src/router/reg-exp-router/`)

RegExpRouter is the fastest router at match time. It compiles every route for a method into **one big regular expression**.

- **During `add()`**, routes are kept in per-method maps, separated into `#middleware` (paths ending in `*`) and `#routes`. When a wildcard path is added, its handler is attached to every already-registered path that the wildcard's regexp matches. When a concrete path is added, it inherits copies of the middleware already registered for matching wildcards. Inheritance resolves eagerly, which keeps registration order intact. A new method map starts as a copy of the `ALL` map.
- **On the first `match()`**, `buildAllMatchers()` runs once per method. Static paths (no `*` or `/:`) go into a `staticMap` and are looked up by plain object key. Dynamic paths are inserted into a `Trie` (`trie.ts` and `node.ts`), which emits a single regexp. Each route ends in an empty capture group, so `match.indexOf('', 1)` identifies the matched route. The router then frees its build state and clears the wildcard regexp cache. Finally `match` is replaced by a closure that uses the prebuilt matchers (`matcher.ts`).
- **Unsupported paths**: patterns that would be ambiguous in one combined regexp make `node.ts` throw `PATH_ERROR`, which is rethrown as `UnsupportedPathError`. Examples are two dynamic siblings with different patterns at the same position, capture groups such as `(a|b)` that are not written as `(?:...)`, and `{.*}` parameters. Duplicate param names and some complex multi-directory captures are also rejected. Under SmartRouter, these send the app to TrieRouter.

`PreparedRegExpRouter`, with `buildInitParams` and `serializeInitParams`, lets build tools precompute the matchers and serialize them. At runtime the router is constructed straight from those params, which skips the build step.

## TrieRouter (`src/router/trie-router/`)

TrieRouter is a segment trie (`node.ts`). `insert` splits the route with `splitRoutingPath` and turns each label into a pattern with `getPattern`. It records a per-method handler set with an increasing `score`, the insertion order. `search` walks the trie, following static children, parameter and regexp children, and `*` children. It collects matching handler sets, then sorts them by `score` so the output follows registration order. TrieRouter supports every syntax in the shared suite: none of the shared common cases is skipped for it. That is why it is the universal fallback.

## PatternRouter (`src/router/pattern-router/router.ts`)

PatternRouter is the smallest router, used by `hono/tiny`. Each route becomes its own anchored `RegExp` with named groups (`/(?<id>[^/]+)`). `match` tests every route linearly and uses `match.groups` as the params. Routes without a trailing wildcard end in `/?$`, so this router **allows trailing slashes**. It throws `UnsupportedPathError` for regexps that fail to compile, such as a duplicate group name in `/:id/:id`.

## LinearRouter (`src/router/linear-router/router.ts`)

LinearRouter has no build step: `add()` just appends to an array, which makes registration cheap. `match` scans every route with hand-written string matching, separately for static, wildcard-only and label-only routes. It also tolerates trailing slashes. A route that mixes labels and `*` throws `UnsupportedPathError` **at match time**, and under `hono/quick` SmartRouter then falls back to TrieRouter. This router suits environments that rebuild the app for every request.

## Choosing and extending

- Pass `new Hono({ router: new X() })` to choose a router explicitly. Only the default `Hono` class honors this option (see [Architecture overview](overview.md)).
- A custom router implements `Router<[H, RouterRoute]>`. It must return handlers in registration order, and it should throw `UnsupportedPathError` when composing it under SmartRouter.

## Tests and benchmarks

`src/router/common.case.test.ts` exports `runTest({ newRouter, skip })`. It is a shared behavioral suite that every router's `router.test.ts` runs. Each router lists the cases it skips, with a reason:

- RegExpRouter skips duplicate param names, complex capture groups and `{.*}`, all as UnsupportedPath.
- LinearRouter skips some multi-match and regexp-with-wildcard cases, and accepts trailing slashes.
- PatternRouter skips `/:id/:id`, and accepts trailing slashes.

Router-specific tests (`node.test.ts`, `prepared-router.test.ts`) cover internals. Performance comparisons are in `benchmarks/routers` and `benchmarks/routers-deno` (see [Testing strategy](../testing/test-strategy.md)).
