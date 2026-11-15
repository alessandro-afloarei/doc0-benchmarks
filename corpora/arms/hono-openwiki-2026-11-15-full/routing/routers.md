---
type: subsystem
title: Routers
description: Hono's pluggable Router interface and its five implementations — RegExpRouter (single compiled regex per method), TrieRouter, SmartRouter (first router that accepts all routes), LinearRouter and PatternRouter — with path syntax, match result formats, ordering guarantees, UnsupportedPathError fallbacks, PreparedRegExpRouter and the shared router test suite.
tags: [router, routing, regexp, trie, performance]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T08:25:20.453Z
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
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-15T08:25:20.453Z" }
---

# Routers

Routing is isolated behind the `Router<T>` interface in `src/router.ts`. `HonoBase` stores `[handler, RouterRoute]` pairs in a router and calls `router.match(method, path)` once per request (see [Request Lifecycle](../architecture/request-lifecycle.md)). Which router an app uses is decided by the class or preset (see [Architecture Overview](../architecture/overview.md#honobase-vs-hono-and-presets)) or by `new Hono({ router })`.

## Interface and result formats

```ts
interface Router<T> {
  name: string
  add(method: string, path: string, handler: T): void
  match(method: string, path: string): Result<T>
}
type Result<T> =
  | [[T, ParamIndexMap][], ParamStash] // indexes into a shared param array
  | [[T, Params][]]                    // params object per handler
```

- Every matching handler is returned (middleware and endpoints alike) **in registration order**; `compose()` runs them in that order.
- Params are per handler, because different routes matching the same URL may name segments differently (`/:id/*` vs `/:id/:action`). `HonoRequest` selects the entry for the current `routeIndex`.
- RegExpRouter returns the first (stash) form; the others return the second form. `HonoRequest#param` handles both.
- `METHOD_NAME_ALL` (`'ALL'`) routes match every method. `UnsupportedPathError` signals that a router cannot represent a path; `MESSAGE_MATCHER_IS_ALREADY_BUILT` is thrown by routers that freeze after their first match.

## Path syntax (shared)

| Syntax | Meaning |
| --- | --- |
| `/users/:id` | Named param (one segment). |
| `/posts/:id{[0-9]+}` | Param constrained by a regex. |
| `/api/animal/:type?` | Optional param — expanded into `/api/animal` and `/api/animal/:type` by `checkOptionalParameter` (`src/utils/url.ts`). |
| `/wild/*` | Wildcard; `/wild/*` also matches `/wild`. |
| `*` / `/*` | Everything. |
| `/files/:name{.+\.png}` | Regex params may span slashes in routers that support it. |

## RegExpRouter (`src/router/reg-exp-router`)

The default primary router and the fastest at match time.

- **Registration** collects routes per method in plain maps. Wildcard middleware (`path` ending in `*`) is propagated to every already-registered and future route whose path it matches, so each route path carries its full ordered handler list.
- **First match** calls `buildAllMatchers()`, which for each method:
  - places routes without params/wildcards in a **static map** (exact-string lookup, no regex);
  - inserts dynamic routes into a `Trie` (`trie.ts`/`node.ts`) and compiles **one regular expression per method** where each route ends with an empty capture group used as a marker. A successful `path.match(regexp)` locates the route by `match.indexOf('', 1)`, and the match array itself becomes the param stash.
- After building, the route maps are released and `match` is replaced by the compiled matcher; further `add()` calls throw `MESSAGE_MATCHER_IS_ALREADY_BUILT`.
- Paths that would make the combined regex ambiguous throw `UnsupportedPathError` during building: e.g. two routes needing the same position as both a static segment and a param, duplicate param names on one path, unescaped capture groups in a param regex (`(a|b)` is rewritten to `(?:a|b)` when possible), or a `{.*}` param regex.

`PreparedRegExpRouter` with `buildInitParams({ paths })` / `serializeInitParams()` lets build tools precompute the matcher for known paths and construct the router without paying the build cost at runtime (useful for cold starts).

## TrieRouter (`src/router/trie-router`)

A segment trie that supports every path pattern, used as the fallback.

- `insert` splits the route path with `splitRoutingPath` (keeping `{...}` regex groups intact) and creates child nodes keyed by static segment or by pattern (`getPattern` caches `[key, name, RegExp | true]` per label).
- Each handler gets a `score` = global insertion order. `search` walks all candidate nodes breadth-first (static children, params, wildcards, multi-segment regex params via an offset queue), collects every matching handler with its params, and **sorts by score**, restoring registration order.
- `/path/*` matches `/path` as well, and `/:id{[0-9]+}/*` matches `/123`.

## SmartRouter (`src/router/smart-router`)

`new SmartRouter({ routers: [...] })` buffers `add()` calls. On the first `match()` it tries each router in order: it replays all routes into it and performs the match; if that router throws `UnsupportedPathError`, it moves to the next. The first router that accepts every route becomes permanent: `match` is rebound to it, the buffered routes are dropped, and `name` becomes e.g. `SmartRouter + RegExpRouter` (exposed via `activeRouter`). If no router accepts the routes, it throws `Fatal error`. Routes cannot be added after the first match.

The default `Hono` uses `[RegExpRouter, TrieRouter]`; `hono/quick` uses `[LinearRouter, TrieRouter]`.

## LinearRouter (`src/router/linear-router`)

Stores routes in an array (optional params expanded at `add` time) and evaluates them one by one at match time with string scanning and small per-route regexes. Registration is O(1), which makes it suitable when the app is constructed on every request (cold-start-heavy environments). Paths combining a param and a wildcard throw `UnsupportedPathError` (SmartRouter then falls back to TrieRouter). A trailing slash on the request path is tolerated for static and param routes.

## PatternRouter (`src/router/pattern-router`)

The smallest implementation, used by `hono/tiny`. Each route is compiled into its own `RegExp` with named groups (`/(?<id>[^/]+)`), and matching tests every route of the method in order. Optional params register the parent path too; routes ending with `*` match prefixes; others accept an optional trailing slash. Invalid regexes become `UnsupportedPathError`.

## Choosing a router

| Router | Add cost | Match cost | Supports all paths | Typical use |
| --- | --- | --- | --- | --- |
| RegExpRouter | low (deferred build on first match) | very low | no | long-lived servers (default) |
| TrieRouter | moderate | moderate | yes | fallback / complex patterns |
| LinearRouter | very low | linear in routes | no (param + wildcard) | per-request app construction |
| PatternRouter | low | linear in routes | most | minimal bundle size |

`getRouterName(app)` from `hono/dev` reports the active router.

## Tests

- `src/router/common.case.test.ts` exports `runTest({ newRouter, skip })`, a shared behavioral suite (basic usage, reserved words, regex params, registration order, multi-match, duplicate param names, optional params, capture groups, ...). Each router's `router.test.ts` runs it and lists the cases it intentionally skips — e.g. RegExpRouter skips cases that are `UnsupportedPath` for it — plus router-specific tests.
- `src/router/reg-exp-router/prepared-router.test.ts` checks that a prepared router matches the same as a regular one.
- `benchmarks/` contains router benchmarks (see [Testing Strategy](../testing/testing-strategy.md)).
