---
type: subsystem
title: Router Implementations
description: The Router contract and Result shapes plus the SmartRouter, RegExpRouter, PreparedRegExpRouter, TrieRouter, LinearRouter and PatternRouter implementations — trade-offs, lazy matcher building, UnsupportedPathError fallback, wildcard/ordering semantics and which preset uses which.
tags: [routing, router, regexp, trie, smart-router, performance]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T09:09:53.543Z
sources:
  - id: openwiki-source-9da6594296f4b30b9cdfad4c
    resource: repo://src/router.ts
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
  - id: openwiki-source-6963434523d24c18fc4c46f3
    resource: repo://src/router/reg-exp-router/router.ts
  - id: openwiki-source-605d30553e8eb34f1f62fdc6
    resource: repo://src/router/reg-exp-router/trie.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
  - id: openwiki-source-d04794538a9045465e3d0b2b
    resource: repo://src/router/trie-router/node.ts
  - id: openwiki-source-672d264b822b6c603fe1adc8
    resource: repo://src/router/trie-router/router.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T09:09:53.543Z" }
---

# Router Implementations

Hono's `HonoBase` delegates all path matching to a pluggable `Router<T>` (`src/router.ts`). Routers are independent public entries (`hono/router/reg-exp-router`, `.../trie-router`, `.../smart-router`, `.../linear-router`, `.../pattern-router`), and can be injected with `new Hono({ router })`. The tests share a behavioural suite (`src/router/common.case.test.ts`, see [Testing Strategy](../testing/testing.md)).

## Contract (`src/router.ts`)

```ts
interface Router<T> {
  name: string
  add(method: string, path: string, handler: T): void
  match(method: string, path: string): Result<T>
}
type Result<T> = [[T, ParamIndexMap][], ParamStash] | [[T, Params][]]
```

- `T` is `[handler, RouterRoute]` in Hono. `method` is upper-case; `ALL` (`METHOD_NAME_ALL`) matches every method.
- Two result shapes: **indexed** (`[ [handler, {paramName: stashIndex}][], stash ]` — used by RegExpRouter, where params are capture-group positions in the regex match array) and **direct** (`[ [handler, {name: value}][] ]`). `HonoRequest.param()` handles both (see [Context and HonoRequest](../core/context-and-request.md)).
- The handler list contains **all** matching entries (middleware and endpoint) **in registration order**, which `compose` then runs (see [Request Lifecycle](../architecture/request-lifecycle.md)).
- `UnsupportedPathError` signals "this router cannot represent this route" and `MESSAGE_MATCHER_IS_ALREADY_BUILT` is the error for adding routes after matching has started.

## Path syntax every router must understand
`/static`, `/:label`, `/:label{regex}`, optional `/:label?`, wildcard `*` (including mid-path `/a/*/b` and tail `/a/*`, where `/a/*` also matches `/a`), and `/*` or `*` for everything. Optional-parameter paths are expanded by `checkOptionalParameter` (`utils/url.ts`): `/api/animals/:type?` registers both `/api/animals` and `/api/animals/:type`. Regex groups with braces are protected during splitting (`splitRoutingPath`, `extractGroupsFromPath`). A trailing slash on the request path matches only when `strict: false` or the route allows it (PatternRouter/LinearRouter also tolerate a trailing `/`).

## SmartRouter (`smart-router/router.ts`)

A router of routers. `add` only records `[method, path, handler]`. On the **first `match`**, it tries each candidate in order: replays all routes into the candidate, then calls its `match`. If any `add` or the build throws `UnsupportedPathError`, it moves to the next candidate. The first candidate that succeeds is locked in: `this.match` is rebound to its `match`, the other routers and the recorded routes are dropped, and `name` becomes `SmartRouter + <active router name>`. If none works it throws `Fatal error`. After selection, `add` throws "matcher is already built". `activeRouter` exposes the chosen one, and `hono/dev`'s `getRouterName(app)` forces a `match('GET', '/')` so the name reflects the selected router. Default `Hono` uses `[RegExpRouter, TrieRouter]`; `hono/quick` uses `[LinearRouter, TrieRouter]`.

## RegExpRouter (`reg-exp-router/*`)

The fastest matcher for typical apps — it compiles all routes for a method into **one regular expression** plus lookup tables, so matching is a single `RegExp.exec` (or a static-map hit).

*Registration (`router.add`)* keeps two per-method tables, `routes` (endpoint handlers by path) and `middleware` (handlers registered with trailing `*`). A wildcard route is propagated into every already-registered path it covers (`re.test(p)`), and new paths inherit the handlers of any wildcard that covers them (`findMiddleware`, longest key first) — this is how ordering between middleware and endpoints is preserved without runtime sorting. `ALL`-method entries are copied into each concrete method's table the first time that method appears. `/*` is normalised to `*`. Optional params are expanded.

*Build (lazy, on first `match`)* — `match()` in `matcher.ts` calls `buildAllMatchers()`, then replaces itself with a closure over the built matchers, and the builder discards the routes/middleware tables and wildcard regexp cache. `#buildMatcher(method)` assembles the method's route list (falling back to `ALL` when the method has no entries; returns `null` if there are none), and `buildMatcherFromPreprocessedRoutes`:
- sorts routes so non-static ones come in length order, and marks purely static paths (no `*`, no `/:`) — those go into a `staticMap` for O(1) lookup but are still inserted into the trie for **conflict detection** (`pathErrorCheckOnly`);
- inserts each path into a character `Trie` (`trie.ts`, `node.ts`) that tokenises into literal chars, labels, and tail wildcards, and builds a combined regex with children ordered literal → special pattern → `:label` → wildcard (`compareKey`) so more specific alternatives win;
- translates `#<handlerIndex>` and `@<paramIndex>` placeholders into real capture-group numbers (`indexReplacementMap`, `paramReplacementMap`), appending an empty capture `$()` per handler set; at match time `match.indexOf('', 1)` finds which handler set matched, and `paramIndexMap` maps names to capture indexes.
Ambiguous routes (e.g. `/:a` and `/:b` at the same position — the trie raises `PATH_ERROR`) are rejected with `UnsupportedPathError`, triggering SmartRouter's fallback to `TrieRouter`.

*Result*: `[ [ [handler, paramIndexMap]… ], matchArray ]` (indexed), or for static paths the precomputed entry with an `emptyParam` stash.

### PreparedRegExpRouter (`prepared-router.ts`)
For startup-sensitive environments: `buildInitParams({ paths })` builds the matchers ahead of time (empty handler lists plus a `relocateMap` from path to slots), and `serializeInitParams` emits JavaScript source (regexes embedded via `toString()`) that can be pasted into code. `new PreparedRegExpRouter(matchers, relocateMap)` then only needs to `add()` handlers into the pre-built slots; adding a path not in the prepared list throws `Path … is not registered`. It reuses the shared `match` function and `buildAllMatchers` just returns the prebuilt matchers.

## TrieRouter (`trie-router/*`)

A segment-based radix tree (`Node`) that supports **every** pattern (so it is the universal fallback). `insert` splits the path into segments, creating children keyed by literal or pattern key, and stores per-method `HandlerSet { handler, possibleKeys, score }` at the leaf, where `score` is an increasing insertion order. `search` walks all candidate nodes level by level (`curNodes`), expanding literal children, `:param` / regex patterns (regex segments may consume several path segments, tracked via `curNodesQueue`), and wildcards; `/hello/*` also matches `/hello`. Param values are carried per candidate node and merged in `#pushHandlerSets`. Finally matched handler sets are **sorted by `score`** to restore registration order. Result shape: direct `[ [ [handler, params]… ] ]`. Slower than RegExpRouter on large static route sets, but has no build step.

## LinearRouter (`linear-router/router.ts`)
Stores routes in an array and, on each match, loops through them in order, doing per-route string logic (static compare with optional trailing `/`; wildcard split-and-`indexOf`; label routes via a segment regex with `:name{regex}` support). No build step, so initialization is the cheapest — good for short-lived instances such as per-request apps — but matching is O(routes). Throws `UnsupportedPathError` for patterns it can't handle so SmartRouter falls back.

## PatternRouter (`pattern-router/router.ts`)
The smallest implementation: each route becomes one `RegExp` (`/:id` → named group `(?<id>[^/]+)`, `:id{re}` uses the supplied regex, `*` tail → prefix match, `/*` mid → `[^/]+`) stored in an array and tested in order; the direct result carries `match.groups`. Optional segments register an extra path. Used by `hono/tiny` for minimal bundle size; invalid regexes raise `UnsupportedPathError`.

## Choosing and extending
- Default (`hono`): best steady-state throughput; build cost paid on the first request.
- `hono/quick`: lowest init cost.
- `hono/tiny`: smallest bundle.
- Custom router: implement `Router<[H, RouterRoute]>` and pass it in `HonoOptions.router`; return handlers in registration order and honour `ALL`.
- Benchmarks comparing routers live in `benchmarks/routers` (see the testing page).
