---
type: architecture
title: Routing engines and registration lifecycle
description: Router selection, match-result contracts, registration freezing, path normalization, and the shared routing test suite.
tags: [routing, architecture, performance]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T07:36:56.362Z
sources:
  - id: openwiki-source-5b3210e04e23e6aecc8c0eb5
    resource: repo://src/hono-base.ts
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-aeafc812676cb9e06a3065ab
    resource: repo://src/preset/quick.ts
  - id: openwiki-source-117f1edff7a7c593d32fbc14
    resource: repo://src/preset/tiny.ts
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
  - id: openwiki-source-72a70287fb9670bc0929a9f1
    resource: repo://src/router/reg-exp-router/prepared-router.ts
  - id: openwiki-source-6963434523d24c18fc4c46f3
    resource: repo://src/router/reg-exp-router/router.ts
  - id: openwiki-source-296dfcd6c21b117d33783452
    resource: repo://src/router/smart-router/router.test.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
  - id: openwiki-source-d04794538a9045465e3d0b2b
    resource: repo://src/router/trie-router/node.ts
  - id: openwiki-source-672d264b822b6c603fe1adc8
    resource: repo://src/router/trie-router/router.ts
  - id: openwiki-source-c0c053b6ce719d3c6d08c6e6
    resource: repo://src/utils/url.ts
  - id: openwiki-source-fbadcd8591b65031efaaedce
    resource: repo://vitest.config.ts
generated: { by: "codex", at: "2026-11-16T07:36:56.362Z" }
---

# Routing engines and registration lifecycle

Routers produce an ordered list of matching handlers and parameters. [Dispatch](request-lifecycle.md) decides how to execute that list. A match is not simply the most specific endpoint: wildcard middleware and endpoint handlers can both participate.

## Contract and consumers

The [Router interface](../../src/router.ts) requires `add(method, path, handler)` and `match(method, path)`. Match results either contain parameter maps directly or parameter-index maps plus a shared string stash. [HonoRequest](../../src/request.ts) understands both forms, and the composer advances its route index before invoking each handler.

This separation permits different lookup strategies without making handlers depend on an engine. The all-method marker is `ALL`; Hono's registration layer uppercases methods before calling the router.

## Default selection happens once

The main `Hono` constructor accepts a custom router; otherwise it builds a [SmartRouter](../../src/router/smart-router/router.ts) with RegExpRouter followed by TrieRouter.

SmartRouter initially buffers registrations. On its first match it replays all registrations into each candidate and attempts the match. Only `UnsupportedPathError` triggers fallback; other errors escape. The first successful candidate becomes the active router, and SmartRouter replaces its own match function with that candidate's bound method.

After selection, the buffered routes are released and new registrations throw the matcher-already-built error. Accessing `activeRouter` before selection also throws. Finish constructing the application before serving requests or calling `app.request()`; the first test request can freeze registration just as a production request does.

## Engines and presets

| Entry or engine | Mechanism and consequence |
| --- | --- |
| `hono` | SmartRouter tries RegExpRouter, then TrieRouter, unless a custom router is supplied. |
| `hono/quick` | SmartRouter tries LinearRouter, then TrieRouter. |
| `hono/tiny` | Uses PatternRouter directly. |
| RegExpRouter | Builds per-method matchers lazily, checks static paths before a combined regular expression, and releases registration caches after building. |
| TrieRouter | Inserts path segments into a tree, expands optional paths, and searches the tree; matched handler sets are ordered by insertion score. |
| LinearRouter | Scans stored routes, with separate literal, wildcard, and parameter paths; unsupported combinations can raise UnsupportedPathError. |
| PatternRouter | Compiles a regular expression for each route and scans those expressions for matching methods. |

The quick and tiny constructors install their preset routers unconditionally, unlike the main constructor's `options.router` fallback. Choose the main entry when explicitly injecting a router. Avoid assuming every engine has identical unsupported-pattern behavior or performance characteristics; use the shared suite and benchmarks with representative routes.

The prepared RegExp implementation is an additional build-time seam: [prepared-router.ts](../../src/router/reg-exp-router/prepared-router.ts) builds reusable matchers and relocation metadata from a known path set, then attaches handlers to those paths. Unknown non-wildcard paths are rejected. Check package exports before treating internal files as public entrypoints.

## Paths, order, and debugging

Hono uses strict path extraction by default. `strict: false` chooses `getPathNoStrict`, which removes one trailing slash except at root. In that mode the constructor chooses this built-in extractor instead of the custom `getPath` option. The normal extractor separates query/fragment data and handles percent-encoded paths through the URL utility's tolerant decoding.

Register middleware before the routes it should wrap. Ordering and the decision to call next jointly determine which handlers run. If behavior differs between engines, reduce the case to `router.add()` and `router.match()` before investigating composition.

The [shared router cases](../../src/router/common.case.test.ts) normalize both result formats and run through engine-specific test wrappers, including [SmartRouter tests](../../src/router/smart-router/router.test.ts). The main Vitest configuration excludes `*.case.test.*` as standalone suites; run the wrapper, for example:

```bash
bunx vitest --run --project main src/router/smart-router/router.test.ts
```

See [testing and performance](../workflows/testing.md) for broader verification and [request dispatch](request-lifecycle.md) for error handling after a match.
