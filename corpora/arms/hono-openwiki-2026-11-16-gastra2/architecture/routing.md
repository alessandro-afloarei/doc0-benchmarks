---
type: architecture
title: Router selection and application composition
description: Router selection, matching contracts, presets, and the distinct ownership rules of basePath, route, and mount.
tags: [routing, architecture, composition]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:23:09.970Z
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
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
generated: { by: "codex", at: "2026-11-16T17:23:09.970Z" }
---

# Router selection and application composition

Routing separates path matching from request execution. A router receives a method, path, and opaque handler payload through `add()`; `match()` returns an ordered list of matching handlers and their parameters. Hono supplies a payload containing the handler and its route metadata, then passes the result into the [request lifecycle](request-lifecycle.md).

## Presets and selection

| Entry point | Router configuration |
| --- | --- |
| `hono` | SmartRouter tries RegExpRouter, then TrieRouter; accepts an explicit router option |
| `hono/quick` | SmartRouter tries LinearRouter, then TrieRouter |
| `hono/tiny` | PatternRouter |
| `hono/hono-base` | Base implementation; callers must supply a router |

The quick and tiny constructors install their preset router directly. Their implementation should not be assumed to honor a router override like the default constructor does.

SmartRouter initially buffers route additions. On the first match it loads all routes into each candidate in order and attempts matching. Only `UnsupportedPathError` causes fallback to another candidate; other failures propagate. Once a candidate succeeds, SmartRouter binds its own match method to that router, discards the buffered routes and other candidates, and exposes the selected router through `activeRouter`. Accessing that property before selection fails.

This is selection for the whole route set, not a per-request competition. Register routes before making requests, including in tests: SmartRouter rejects additions after selection. RegExpRouter similarly releases its registration maps when building matchers. TrieRouter inserts into a node tree and searches it; the router implementations have different mechanisms and supported-pattern limits.

## Parameters and matching boundaries

The router result supports two representations: direct parameter values for each matched handler, or parameter indices plus a shared string stash. Consumers must handle both. `HonoRequest` resolves the current handler's values using `routeIndex`, so overlapping middleware and endpoints can use different parameter names without sharing one flat parameter map.

Default application path extraction is strict about trailing slashes. With `strict: false`, Hono uses the non-strict extractor; otherwise a supplied `getPath` overrides the default extractor. The non-strict branch takes precedence over custom `getPath` in the constructor. Host-based routing or other custom extraction belongs at this seam.

## Composing applications

`basePath('/api')` returns a clone with a merged prefix. The clone shares the router and routes array with the original, so registrations through it modify the same underlying application. This is a registration view, not an isolated application.

`route('/api', child)` iterates the child's routes as they exist at the time of the call and registers them under the parent prefix. Define child routes first. If the child has a custom error handler, imported handlers are wrapped to retain it. The parent returns itself, with TypeScript schema information merged from the child for [typed clients](../workflows/validation-and-client.md).

`mount('/other', fetchHandler)` instead registers an all-method wildcard handler. By default it strips the mount prefix from the request path and passes environment and execution context to the foreign handler. `optionHandler` customizes extra arguments; `replaceRequest` customizes rewriting, and `false` preserves the original request. A returned response short-circuits; a falsy result falls through to `next()`.

## Verification and extension

A custom router implements the small contract in `src/router.ts`, but preserving parameter and handler ordering is essential. The shared suite in `src/router/common.case.test.ts` normalizes both result formats and exercises routing behavior. Individual router test files invoke it and can declare unsupported cases with reasons. Run those wrapper test files: the main Vitest project excludes `*.case.test.*` as standalone tests.

Use `src/hono.test.ts` for base-path, subapplication, mount, and error-boundary behavior. A router-only test cannot prove that registration metadata or composed application behavior remains correct.
