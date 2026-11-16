---
type: architecture
title: TrieRouter, LinearRouter, and PatternRouter
description: How Hono's three non-RegExp routers work and when they are used — TrieRouter's segment tree with breadth-first search and insertion-order scoring (the SmartRouter fallback), LinearRouter's zero-cost registration with per-request string scanning (hono/quick), and PatternRouter's one-regexp-per-route design (hono/tiny).
tags: [routing, trie-router, linear-router, pattern-router]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-15T17:08:50.203Z
sources:
  - id: openwiki-source-19f59037af69fc63452ad634
    resource: repo://src/router/linear-router/router.ts
  - id: openwiki-source-0ae7920a04cee4b2a2fce27c
    resource: repo://src/router/pattern-router/router.ts
  - id: openwiki-source-d04794538a9045465e3d0b2b
    resource: repo://src/router/trie-router/node.ts
  - id: openwiki-source-672d264b822b6c603fe1adc8
    resource: repo://src/router/trie-router/router.ts
generated: { by: "claude-code", at: "2026-11-15T17:08:50.203Z" }
---

# TrieRouter, LinearRouter, and PatternRouter

Besides [RegExpRouter](reg-exp-router.md), Hono ships three routers implementing the same [Router contract](router-interface.md). All three return the **value form** of `Result` (`[[handler, params][]]`) and accept routes at any time (no build step), so they can be used without `SmartRouter`.

| Router | Registration cost | Match cost | Used by | Notable limits |
| --- | --- | --- | --- | --- |
| `TrieRouter` | Tree insert per segment | Walks tree segment by segment | Fallback in `hono` and `hono/quick` | Supports the full syntax; slower than RegExpRouter |
| `LinearRouter` | Just pushes to an array | Scans every route per request | First choice in `hono/quick` | Throws `UnsupportedPathError` for routes mixing `:param` and `*`; tolerates a trailing `/` |
| `PatternRouter` | Compiles one RegExp per route | Tests every route regexp | `hono/tiny` | Smallest code; tolerates a trailing `/`; duplicate param names in one path are unsupported |

## TrieRouter (`src/router/trie-router/`)

`TrieRouter.add` expands optional params (`checkOptionalParameter`) and inserts each path into a tree of `Node`s.

**Insertion** (`Node.insert`): the path is split into routing segments (`splitRoutingPath`, which keeps regex params containing `/` intact). For each segment, `getPattern` decides whether it's a literal, a `:param` (optionally with regex, and with a lookahead to the next literal segment when the regex can span slashes), or `*`. Pattern children are recorded in the parent's `#patterns` list; all children live in `#children` keyed by the literal or pattern key. At the end node, a `{ [method]: { handler, possibleKeys, score } }` entry is appended, where `score` is a **global insertion counter** and `possibleKeys` are the param names along the path.

**Search** (`Node.search`) is breadth-first over path segments, keeping a set of current nodes (multiple nodes can be live because patterns and literals may both match):

- Literal child match → continue (or, at the last segment, collect handlers of the child and of its `*` child, so `/a/*` also matches `/a`).
- `*` pattern → collect the `*` node's handlers immediately and keep it alive for deeper segments.
- `:param` with a plain label → matches any non-empty segment.
- `:param{regex}` → executed against the **rest of the path** (offsets are computed lazily), so a regex can consume several segments; the matched child is queued for the segment index after the consumed part.
- Each collected handler set gets a fresh params object populated from the params accumulated along that branch.

Finally all collected handler sets are **sorted by score**, which restores registration order across branches — the property that [Middleware Composition](../core/middleware-composition.md) relies on. Handlers are looked up per node with `m[method] || m['ALL']`.

TrieRouter is the universal fallback: in the default `SmartRouter([RegExpRouter, TrieRouter])`, it is used whenever RegExpRouter rejects a route set with `UnsupportedPathError`.

## LinearRouter (`src/router/linear-router/router.ts`)

Designed for apps that are constructed per request (e.g. some edge/serverless setups) where registration cost dominates. `add` only expands optional params and pushes `[method, path, handler]`.

`match` iterates **every** route in registration order, filters by method (`ALL` matches all), and classifies the route path:

- `*` / `/*` → always matches.
- Static → equal to the path, or equal with a trailing `/`.
- Wildcards only → the pieces between `*`s must appear at the expected positions (`indexOf`-based scan); a trailing `/*` allows any remainder.
- Params only → split with a regex into literal pieces and `:name` / `:name{regex}` pieces; plain params take the segment up to the next `/`; regex params are evaluated with the `d` (indices) flag against the rest of the path with a lookahead to the next literal piece. The first value for a duplicate name wins.
- Params **and** wildcard in the same path → `UnsupportedPathError` (thrown at match time, which `SmartRouter` treats as "use TrieRouter").

## PatternRouter (`src/router/pattern-router/router.ts`)

The smallest implementation, used by `hono/tiny`. `add` converts each path into a single regular expression:

- `:name` → `(?<name>[^/]+)`, `:name{re}` → `(?<name>re)` (named capture groups), a `*` segment → `[^/]+`, other text escaped.
- A trailing `*` removes the end anchor (prefix match); otherwise the regexp ends in `/?$` (so a trailing slash is tolerated).
- A trailing `?` (optional param) also registers the path without the last segment.
- If the regexp can't be constructed — e.g. the same param name twice, which is an invalid duplicate named group — it throws `UnsupportedPathError`.

`match` tests every route of the method (or `ALL`) in order and returns `match.groups` as params.

## Tests

Each router runs the shared suite in `src/router/common.case.test.ts` with an explicit skip list (see [Router Contract and SmartRouter](router-interface.md#shared-test-suite)). `src/router/trie-router/node.test.ts` tests the trie directly, including ordering and regex params spanning segments. Performance comparisons are in `benchmarks/routers`.
