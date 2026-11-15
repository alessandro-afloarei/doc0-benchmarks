---
type: architecture
title: RegExpRouter and PreparedRegExpRouter
description: How RegExpRouter precomputes per-method handler lists, compiles all dynamic routes into one regular expression whose empty capture groups identify the matched route, serves static paths from a map, rejects ambiguous patterns with UnsupportedPathError, and how PreparedRegExpRouter ships prebuilt matchers.
tags: [routing, regexp-router, performance, prepared-router]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-0bf513eef7e628cf93e0998a
    resource: repo://src/router/reg-exp-router/matcher.ts
  - id: openwiki-source-5c610df654eb4e3e940cc992
    resource: repo://src/router/reg-exp-router/node.ts
  - id: openwiki-source-72a70287fb9670bc0929a9f1
    resource: repo://src/router/reg-exp-router/prepared-router.ts
  - id: openwiki-source-6963434523d24c18fc4c46f3
    resource: repo://src/router/reg-exp-router/router.ts
  - id: openwiki-source-605d30553e8eb34f1f62fdc6
    resource: repo://src/router/reg-exp-router/trie.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# RegExpRouter and PreparedRegExpRouter

`RegExpRouter` (`src/router/reg-exp-router/`) is Hono's fastest router and the first choice inside the default `SmartRouter`. Instead of walking a tree per request, it compiles **all routes of a method into a single regular expression** and resolves a request with one `String.prototype.match`. It implements the [Router contract](router-interface.md) and returns results in the index-map + param-stash form.

## Registration phase (`router.ts`)

Routes are kept in two per-method maps until the first match:

- `#middleware[method][path]` — wildcard routes (paths ending in `*`).
- `#routes[method][path]` — all other routes.

Every entry is a **precomputed handler list**: `[handler, paramCount]` tuples in registration order, already including every earlier-registered wildcard handler that covers that path. Concretely, `add()`:

- normalizes `/*` to `*`;
- for a **wildcard path**, builds a regexp for it (cached; `/foo/*` matches `/foo` and `/foo/...`), seeds the wildcard's own list from the most specific existing wildcard covering it, and **appends the handler to every existing route/middleware list whose path it matches** (all methods for `ALL`);
- for a **normal path**, expands optional params (`/a/:b?` → `/a` and `/a/:b`, via `checkOptionalParameter`), seeds the list from the longest matching wildcard, and appends the handler.
- the first time a new method is seen, it copies the `ALL` lists into that method's maps so `ALL` handlers stay in order.

Because each list is final, matching never has to merge middleware and handlers at request time. The cost: **routes cannot be added after the first `match()`** — the maps are discarded and `add()` throws `Can not add a route since the matcher is already built.`

## Compilation (`buildAllMatchers` → `buildMatcherFromPreprocessedRoutes`)

On the first `match()` call (`matcher.ts`), every method's matcher is built, the instance's `match` is replaced by a closure over the built matchers, and the registration maps plus the wildcard-regexp cache are dropped. For each method (methods without own routes fall back to the `ALL` matcher):

1. Routes are sorted: dynamic routes first (shorter paths earlier), static routes last. Static paths (no `*` or `/:`) go into a **static map** `path → [handlers with empty params]` — a direct object lookup at request time — but are still inserted into the trie in "check only" mode so conflicts are detected.
2. Dynamic routes are inserted into a `Trie` (`trie.ts`) of `Node`s (`node.ts`). The path is tokenized into single characters, `:name` / `:name{regex}` params, and a trailing `/*`. Params get a global variable index.
3. `buildRegExpStr()` emits alternations of children sorted by specificity (literal characters before `[^/]+` labels before wildcards), with `(<pattern>)@<varIndex>` for params and `#<routeIndex>` at route ends.
4. `Trie.buildRegExp()` rewrites the markers: each `#i` becomes an **empty capture group `$()`** and param markers are mapped to their capture-group numbers. The result is one `^...` regexp plus two maps: capture index → route index, and param var index → capture index.
5. Each route's param maps are rewritten to point at capture indices.

Matching (`matcher.ts`):

```
static hit  → return staticMap[path]
regexp miss → return [[], []]
regexp hit  → index = match.indexOf('', 1)     // the first empty capture marks the route
              return [handlerMap[index], match] // params read as match[captureIndex]
```

`HonoRequest.param()` then dereferences the param index map against the match array (see [HonoRequest](../core/request.md)).

## Unsupported patterns

During insertion `Node` throws an internal `PATH_ERROR`, surfaced as `UnsupportedPathError`, when routes would be ambiguous in a single regexp:

- two routes ending at the same node (duplicate/equivalent paths with the same param positions),
- a custom param regex of `.*`, or one with capturing groups other than a single top-level group (that is automatically converted to `(?:...)`),
- a param or wildcard node next to sibling literal/param children that would make the alternation order-dependent.

`SmartRouter` catches this error and falls back to the next router (normally `TrieRouter`), so applications only see it when using `RegExpRouter` directly.

## PreparedRegExpRouter

`PreparedRegExpRouter` avoids the compilation cost at startup (useful on cold-start-sensitive platforms):

1. At build time, `buildInitParams({ paths })` registers each path with an internal `RegExpRouter` (using the path string itself as the handler), builds the matchers, records where each path's handler slots live (a **relocate map**: handler-list indices and static-map keys plus param maps), and empties the lists.
2. `serializeInitParams(params)` produces JavaScript source embedding the regexps literally, which can be written into the bundle.
3. At runtime, `new PreparedRegExpRouter(matchers, relocateMap)` is passed as the app's `router`. `add(method, path, handler)` just pushes the handler into the precomputed slots (wildcard `*` routes are pushed into every list); **adding a path that wasn't prepared throws** `Path <path> is not registered`. `match` is the same function as `RegExpRouter`'s.

## Tests and benchmarks

`src/router/reg-exp-router/router.test.ts`, `prepared-router.test.ts`, and the shared cases in `src/router/common.case.test.ts`. Router benchmarks live in `benchmarks/routers` (Node) and `benchmarks/routers-deno`.

See also: [TrieRouter, LinearRouter, and PatternRouter](trie-linear-pattern-routers.md).
