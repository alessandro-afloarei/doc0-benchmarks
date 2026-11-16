---
type: concept
title: Router Selection and Matching
description: The Router contract that every Hono router implements, the five router implementations (RegExpRouter, TrieRouter, LinearRouter, PatternRouter, SmartRouter), the build-once matching model and the UnsupportedPathError fallback that lets SmartRouter pick a router on the first request, the default router chain of each preset, and the shape of the match result consumed by dispatch.
tags: [routing, router, regexp, trie, linear, pattern, smart-router, matching, presets]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T10:23:45.579Z
sources:
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-aeafc812676cb9e06a3065ab
    resource: repo://src/preset/quick.ts
  - id: openwiki-source-117f1edff7a7c593d32fbc14
    resource: repo://src/preset/tiny.ts
  - id: openwiki-source-9da6594296f4b30b9cdfad4c
    resource: repo://src/router.ts
  - id: openwiki-source-19f59037af69fc63452ad634
    resource: repo://src/router/linear-router/router.ts
  - id: openwiki-source-0ae7920a04cee4b2a2fce27c
    resource: repo://src/router/pattern-router/router.ts
  - id: openwiki-source-6963434523d24c18fc4c46f3
    resource: repo://src/router/reg-exp-router/router.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
  - id: openwiki-source-d04794538a9045465e3d0b2b
    resource: repo://src/router/trie-router/node.ts
  - id: openwiki-source-672d264b822b6c603fe1adc8
    resource: repo://src/router/trie-router/router.ts
generated: { by: "claude-code", at: "2026-11-16T10:23:45.579Z" }
---

# Router Selection and Matching

<!-- openwiki: broken internal link [/openwiki/routing/route-registration.md] link "/openwiki/routing/route-registration.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
A router maps `(method, path)` to the handlers registered for it and returns them in the form the dispatch loop expects. Hono has one contract, `Router<T>`, and five implementations with different cost profiles. The default preset does not pick one router at construction time; it uses `SmartRouter`, which selects the first implementation that accepts the application's routes. This page covers the contract, each implementation, the selection logic, and the result shape. Route insertion and the routes table are covered in [Route Registration, Grouping and Mounting](/openwiki/routing/route-registration.md).

## The Router Contract

`src/router.ts` defines the interface:

- `name` identifies the implementation (for example `SmartRouter + RegExpRouter`), which the dev helper prints.
- `add(method, path, handler)` records a route. Handlers are opaque values of type `T`; in Hono the type is the pair `[handler, RouterRoute]`.
- `match(method, path)` returns a `Result<T>`.

The result is one of two shapes. The first is `[[T, ParamIndexMap][], ParamStash]`, where each parameter map records the index into the stash of the parameter's value. The second is `[[T, Params][]]`, where the parameter values are already materialized. Dispatch and `HonoRequest` accept both. The list is ordered so that middleware and handlers appear in the order they should run. Constants shared by all routers (`METHODS`, `METHOD_NAME_ALL`, `MESSAGE_MATCHER_IS_ALREADY_BUILT`) and the `UnsupportedPathError` class are also defined in `src/router.ts`.

An implementation must reject paths it cannot handle by throwing `UnsupportedPathError`, not a generic error. That exception is the signal that drives `SmartRouter`'s fallback.

## Implementations

**RegExpRouter** (`src/router/reg-exp-router/`) is the fastest for typical applications. It keeps per-method tables of handlers, with middleware tables built up as routes are added. On the first `match`, `buildAllMatchers` compiles the tables into one regular expression per method, plus a static map for paths that contain no parameters or wildcards. Matching runs one `RegExp.exec` per request, then maps the captured groups to handlers and parameter indices. Because the matcher is compiled once, `add` throws `Can not add a route since the matcher is already built.` after the first match. The compilation step, which runs on that first match, builds a path trie in `trie.ts`; a path it cannot represent raises `UnsupportedPathError`, which `SmartRouter` treats as a signal to try the next router. The module also exports `PreparedRegExpRouter`, `buildInitParams`, and `serializeInitParams`, which let a precompiled matcher be serialized as source text and loaded without rebuilding it at startup.

**TrieRouter** (`src/router/trie-router/`) stores routes in a tree of `Node` objects keyed by path segment. `search` walks the request path segment by segment through the tree, collects the handlers stored at matching nodes for the requested method, and records parameter values as it passes parameter nodes. It accepts every path form Hono supports, so it is the fallback in the default chain. Its cost grows with the number of matched segments rather than with the number of routes.

**LinearRouter** (`src/router/linear-router/`) keeps a flat list of `[method, path, handler]` entries and checks each one in order. A route with no parameters or wildcards is compared directly; wildcard and parameter routes are matched by splitting the request path. It has the lowest startup cost and no compilation step, so it suits small applications and the `quick` preset, but its cost grows linearly with the number of routes.

**PatternRouter** (`src/router/pattern-router/`) converts each route into a single anchored regular expression at insertion time and tests every expression in registration order on each request. Its only requirement is that each path can be converted to a regular expression; a conversion that fails throws `UnsupportedPathError`. It is the router of the `tiny` preset, which keeps the bundle small by avoiding the trie and the regular-expression compiler.

**SmartRouter** (`src/router/smart-router/router.ts`) is a meta-router. Its constructor takes an ordered list of candidate routers. On the first `match`, it replays every registered route into each candidate in turn:

- If a candidate accepts all routes, `SmartRouter` replaces its candidate list with that router, clears its own route list, and rebinds `match` to the chosen router's `match`. All later requests go directly to that router, and `name` becomes `SmartRouter + <chosen router name>`.
- If a candidate throws `UnsupportedPathError`, `SmartRouter` tries the next candidate. Any other exception is re-thrown.
- If no candidate accepts the routes, `SmartRouter` throws `Fatal error`. The default chain ends in `TrieRouter`, which accepts every path, so this does not occur in the presets.

`activeRouter` returns the chosen router after selection and throws `No active router has been determined yet.` before that.

## Preset Chains

Each preset in `src/` picks a router set:

- The default `Hono` class (`src/hono.ts`) uses `SmartRouter` over `RegExpRouter` and `TrieRouter`. Applications with paths that the regular-expression router rejects automatically fall back to the trie.
- `quick` (`src/preset/quick.ts`) uses `SmartRouter` over `LinearRouter` and `TrieRouter`.
- `tiny` (`src/preset/tiny.ts`) uses `PatternRouter` alone, without a fallback, so a path it cannot convert fails at registration.

The `router` option of `HonoOptions` replaces the default `SmartRouter` chain in the default `Hono` class (`src/hono.ts`). Custom routers must implement `Router<[H, RouterRoute]>`.

## Matching Semantics Shared by All Routers

All implementations apply the same rules, which the common test suite (`src/router/common.case.test.ts`) checks against each one:

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- Static paths match exactly, and in strict mode a trailing slash is significant (see [Request Lifecycle](/openwiki/architecture/request-lifecycle.md)).
- `:name` captures one path segment. `PatternRouter` also accepts a custom pattern in braces (for example `:id{[0-9]+}`), which it compiles into the regular expression.
- Middleware registered with `use` (method `ALL`) is included for each method that matches its path.

## Invariants

- Once a router has built its matcher, it rejects new routes. In `SmartRouter` this happens on the first request.
- Selection is permanent for an application instance. The chosen router is used for the lifetime of the process.
- A router that accepted the route table at selection time keeps accepting it, because the route table is replayed exactly once.

## Failure Behavior

- A route added after the first request fails with the matcher-built message in every router.
- A path that no candidate can represent produces the `Fatal error` from `SmartRouter` for a custom chain that omits the trie. The default chains are safe because the trie accepts every path.

## Tests

<!-- openwiki: broken internal link [/openwiki/operations/testing-and-quality.md] link "/openwiki/operations/testing-and-quality.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`src/router/*/router.test.ts` exercise each implementation, `src/router/trie-router/node.test.ts` covers the trie nodes, `src/router/reg-exp-router/prepared-router.test.ts` covers serialization, and `src/router/common.case.test.ts` runs shared cases against every router. Benchmarks for the routers are in `benchmarks/routers` (see [Testing, Runtime Matrix and Quality Gates](/openwiki/operations/testing-and-quality.md)).
