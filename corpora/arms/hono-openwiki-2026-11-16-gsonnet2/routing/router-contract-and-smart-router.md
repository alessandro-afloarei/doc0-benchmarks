---
type: architecture
title: Router Contract and SmartRouter
description: The Router interface and its two Result shapes, route-registration constants and UnsupportedPathError, and how SmartRouter lazily selects the first router able to handle all registered routes; also which preset uses which routers.
tags: [router, smart-router, contract, presets, routing]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-aeafc812676cb9e06a3065ab
    resource: repo://src/preset/quick.ts
  - id: openwiki-source-117f1edff7a7c593d32fbc14
    resource: repo://src/preset/tiny.ts
  - id: openwiki-source-755521ba02fa3cd47ce245d1
    resource: repo://src/request.ts
  - id: openwiki-source-9da6594296f4b30b9cdfad4c
    resource: repo://src/router.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# Router Contract and SmartRouter

Routing is a pluggable seam: `HonoBase` only calls `router.add(...)` while registering and `router.match(...)` while dispatching ([App Core](../architecture/app-core.md), [Request Lifecycle](../architecture/request-lifecycle.md)). Everything a router must honour is in `src/router.ts`.

## The `Router<T>` contract

```ts
interface Router<T> {
  name: string
  add(method: string, path: string, handler: T): void
  match(method: string, path: string): Result<T>
}
```

For Hono, `T` is `[handler, RouterRoute]`. Constants: `METHOD_NAME_ALL = 'ALL'` (the pseudo-method used by `use`, `all` and `mount`), `METHOD_NAME_ALL_LOWERCASE`, `METHODS` (`get post put delete options patch`, from which `HonoBase` generates its verb methods; `head` is handled by re-dispatching as `GET`), and `MESSAGE_MATCHER_IS_ALREADY_BUILT` for the "no routes after first match" error.

### `Result<T>`: two shapes

A match returns **all** matching handlers in execution order (middleware and handlers together, because `compose` runs them as one chain; see [Middleware Composition](../architecture/middleware-composition.md)). Two encodings exist:

1. `[[handler, paramIndexMap][], paramStash]`: used by RegExpRouter. `paramIndexMap` maps a param name to an *index* into the shared `paramStash` (the raw regexp match array).
2. `[[handler, params][]]`: used by Trie/Linear/Pattern routers. Each handler carries its own `{name: value}` object, and there is no stash.

`HonoRequest.param()` distinguishes the shapes by whether `matchResult[1]` exists ([Context and HonoRequest](../architecture/context-and-request.md)). A no-match is an empty handler list (`[[]]` or `[[], []]`), which `#dispatch` turns into the not-found handler.

### Errors

`UnsupportedPathError` (a plain `Error` subclass) is the sanctioned way for a router to say "I cannot represent this route". It may be thrown from `add` or, for routers that defer work, from the first `match`. Only `SmartRouter` interprets it; if you use a router directly it simply propagates.

## SmartRouter (`src/router/smart-router/router.ts`)

`new SmartRouter({ routers: [...] })` gives a router that **buffers** every `add(method, path, handler)` into an internal `[method, path, handler][]` list rather than forwarding it. Selection happens on the first `match`:

1. For each candidate router in order: replay *all* buffered routes with `router.add(...)`, then call `router.match(method, path)`.
2. If this throws `UnsupportedPathError`, move on to the next candidate (the candidate has partially stored routes, but it is discarded). Any other error is rethrown.
3. On the first success, **commit**: `this.match` is replaced with the winner's bound `match`, `#routers` becomes `[winner]`, and the buffer is cleared (set `undefined`). The result of that first match is returned.
4. If no router succeeds, it throws `Fatal error`.

After commit `name` becomes `SmartRouter + <winner>` (e.g. `SmartRouter + RegExpRouter`), `activeRouter` exposes the winner (and throws before selection), and subsequent `add` calls throw `MESSAGE_MATCHER_IS_ALREADY_BUILT` because the buffer is gone. `getRouterName(app)` in `helper/dev` forces selection by matching `GET /` and returns the name; preset tests use it ([Testing](../operations/testing.md)).

Implications:

- Route registration is cheap (just an array push); the cost of compiling the RegExp matcher or trie is paid once at first request.
- Because candidates are tried against the *whole* route set, one exotic route (say, an ambiguous param pattern) downgrades the entire app from RegExpRouter to the next candidate, not just that route.
- Candidate order encodes preference: fastest-but-restrictive first, most general last (TrieRouter accepts everything the others reject).

## Router combinations by preset

| Entry | Router | Intent |
| --- | --- | --- |
| `hono` (`src/hono.ts`) | `SmartRouter([RegExpRouter, TrieRouter])` | Best request-time performance with a universal fallback |
| `hono/quick` (`src/preset/quick.ts`) | `SmartRouter([LinearRouter, TrieRouter])` | Cheap start-up: LinearRouter has no build step, good for short-lived runtimes |
| `hono/tiny` (`src/preset/tiny.ts`) | `PatternRouter` | Smallest bundle size |
| `hono/hono-base` | none: supply `router` yourself | Custom assembly |

Each router is documented in [RegExpRouter](regexp-router.md) and [Trie, Linear and Pattern routers](trie-linear-pattern-routers.md). Passing `router` in `HonoOptions` overrides the default only for the main `Hono` class.
