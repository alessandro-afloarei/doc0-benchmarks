---
type: architecture
title: TrieRouter, LinearRouter and PatternRouter
description: Algorithms and trade-offs of Hono's TrieRouter (segment tree with scored handlers), LinearRouter (sequential scan, no build step) and PatternRouter (one regexp per route), including supported patterns, ordering rules and when each is selected.
tags: [router, trie-router, linear-router, pattern-router, routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-19f59037af69fc63452ad634
    resource: repo://src/router/linear-router/router.ts
  - id: openwiki-source-0ae7920a04cee4b2a2fce27c
    resource: repo://src/router/pattern-router/router.ts
  - id: openwiki-source-d04794538a9045465e3d0b2b
    resource: repo://src/router/trie-router/node.ts
  - id: openwiki-source-672d264b822b6c603fe1adc8
    resource: repo://src/router/trie-router/router.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# TrieRouter, LinearRouter and PatternRouter

These three routers implement the [Router contract](router-contract-and-smart-router.md) without compiling all routes into a single regexp as [RegExpRouter](regexp-router.md) does. All of them return the `[[handler, params][]]` result shape, with parameter values embedded per handler (no shared stash), and all use shared helpers from `src/utils/url.ts` (`splitPath`, `splitRoutingPath`, `getPattern`, `checkOptionalParameter`).

| Router | Build step | Where used | Strength | Limitation |
| --- | --- | --- | --- | --- |
| `TrieRouter` | none (incremental tree) | Fallback in the default and `quick` presets | Supports every pattern Hono allows | Slower per match than RegExpRouter |
| `LinearRouter` | none | `quick` preset (first choice) | Zero start-up cost, tiny code | Scans every route per request; rejects some patterns |
| `PatternRouter` | none (a regexp per route) | `tiny` preset | Smallest code | Linear scan; limited syntax |

## Shared path syntax

Route paths may contain static segments, `:name` parameters, `:name{regex}` constrained parameters, `*` wildcards, and optional trailing parameters `:name?`. `checkOptionalParameter` expands `/api/animals/:type?` into two concrete paths (`/api/animals` and `/api/animals/:type`); Trie and Linear routers register both, so optional params are really just two routes.

## TrieRouter (`src/router/trie-router/`)

`TrieRouter` wraps a tree of `Node`s. **Insertion** splits the path into segments (`splitRoutingPath` protects `{...}` regex groups that contain slashes) and, for each segment, creates or reuses a child keyed by the segment text (for parameters, the key encodes the label and the next segment as computed by `getPattern`, with results cached in `patternCache`). Parameter and wildcard segments are additionally recorded in the node's `#patterns` list. At the terminal node it appends a `{ [method]: { handler, possibleKeys, score } }` entry, where `score` is a monotonically increasing insertion counter (`#order`) and `possibleKeys` lists the param names reachable on that path.

**Search** (`search(method, path)`) walks the path segments keeping a frontier of candidate nodes (`curNodes`): for each segment, for each node, it follows (a) the exact-text child, (b) wildcard children, and (c) each registered pattern: unconstrained labels match any non-empty segment; regex-constrained labels (`:filename{[a-z]+.js}`) are matched against the **rest of the path** (so they can span slashes) and queue the child into `curNodesQueue` keyed by how many segments were consumed. Handlers are collected on arrival at nodes that terminate the path, including special cases such as `/hello/*` matching `/hello` itself and `/:id{[0-9]+}/*` matching `/123`. Collected handler sets are finally **sorted by `score`**, which reproduces registration order across middleware and routes regardless of tree shape. A handler registered for the matched method or for `ALL` is selected from each entry (`m[method] || m[ALL]`).

Parameter values are accumulated on nodes during the walk and merged into each handler set's `params` using `possibleKeys` (so a handler only sees params declared on its own path, even when middleware paths share nodes). The node-local `#params` field is mutated during `search`; searches are synchronous, so this is safe for ordinary use.

TrieRouter's insert and search paths contain no `UnsupportedPathError` throws (unlike the other routers), which is why it is placed last as the universal fallback for [SmartRouter](router-contract-and-smart-router.md).

## LinearRouter (`src/router/linear-router/router.ts`)

`add` stores `[method, path, handler]` tuples (expanding optional params). `match` iterates all tuples in registration order (which is naturally the required execution order), filtering by method (or `ALL`) and testing the path with hand-written scanning code instead of regexps for the common cases:

- `*` / `/*` always match.
- Static path: string equality (with or without a trailing slash).
- Wildcards without labels: the path is split on `*` and each part must appear in sequence at the correct position via `indexOf`; a trailing `/*` matches the prefix and anything below.
- Labels without wildcards: segments are parsed with `splitPathRe`; each `:label` captures up to the next `/`, while `:label{pattern}` compiles the pattern (with a lookahead on the following literal) using the `d` flag to learn match indices, and must start at the current position.
- **Labels combined with wildcards throw `UnsupportedPathError`** at match time. Under SmartRouter this makes LinearRouter step aside for the TrieRouter.

The throw happening in `match` (not `add`) is why SmartRouter performs its router test on the first request rather than at registration.

## PatternRouter (`src/router/pattern-router/router.ts`)

Each route becomes a single regexp at `add` time: segments are escaped; `:name` becomes a named group `(?<name>[^/]+)` (or the supplied `{regex}`); `/*` in the middle becomes `/[^/]+`; a trailing `*` leaves the regexp un-anchored at the end so it matches any suffix, otherwise it anchors with `/?$`. A trailing `?` registers the parent path as well. An invalid regexp raises `UnsupportedPathError`. `match` loops over all routes in order, collects those whose method is equal or `ALL` and whose regexp matches, returning `match.groups` as params. It does no optimisation, which is why it is smallest.

## Choosing and verifying

- Prefer the default preset for throughput on long-lived servers; `quick` for serverless/cold-start workloads with few routes; `tiny` when bundle size dominates ([Quickstart](../quickstart.md)).
- Behavioural parity across all routers is enforced by one shared test suite (`src/router/common.case.test.ts`), with per-router `skip` lists for features a router deliberately lacks ([Testing](../operations/testing.md)). Router micro-benchmarks live in `benchmarks/routers`.
