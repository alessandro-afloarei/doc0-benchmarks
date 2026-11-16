---
type: architecture
title: Routing and Router Implementations
description: The Router contract and match result format, how SmartRouter picks the first concrete router that accepts every registered route, and how the four matchers (RegExpRouter, TrieRouter, LinearRouter, PatternRouter) differ in build cost, matching strategy, and the path forms they reject.
tags: [hono, routing, router, regexp, trie, linear, pattern, smart-router, performance]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T18:18:42.046Z
sources:
  - id: openwiki-source-bd5d0ff875be61061f6867c2
    resource: repo://src/hono.ts
  - id: openwiki-source-19f59037af69fc63452ad634
    resource: repo://src/router/linear-router/router.ts
  - id: openwiki-source-0ae7920a04cee4b2a2fce27c
    resource: repo://src/router/pattern-router/router.ts
  - id: openwiki-source-0bf513eef7e628cf93e0998a
    resource: repo://src/router/reg-exp-router/matcher.ts
  - id: openwiki-source-5c610df654eb4e3e940cc992
    resource: repo://src/router/reg-exp-router/node.ts
  - id: openwiki-source-6963434523d24c18fc4c46f3
    resource: repo://src/router/reg-exp-router/router.ts
  - id: openwiki-source-209701b9ea297311fec3e1d8
    resource: repo://src/router/smart-router/router.ts
  - id: openwiki-source-672d264b822b6c603fe1adc8
    resource: repo://src/router/trie-router/router.ts
generated: { by: "claude-code", at: "2026-11-16T18:18:42.046Z" }
---

# Routing and Router Implementations

<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Routing in Hono is split into two concerns. The `Router<T>` interface in `src/router.ts` only defines how routes are added and how a method and path are matched. Hono's `#addRoute` stores each route as a `[handler, routeRecord]` pair, and the router returns the ordered handler list for a request. Five router classes implement the interface: four concrete matchers and `SmartRouter`, which chooses among them. The choice of default router is made by the preset, as described in [Architecture Overview](/openwiki/architecture/overview.md).

## The Router contract

`src/router.ts` defines:

- `add(method, path, handler)`: register a route. Method names are uppercased by `Hono`; `ALL` matches every method.
- `match(method, path)`: return a `Result<T>`. The result is either `[[handler, paramIndexMap][], paramStash]` or `[[handler, params][]]`. Both forms list every matching handler in registration order, so middleware and route handlers come back in one list. The first form stores parameter values in a shared stash and maps names to indices, which avoids building an object per handler.
- Constants shared by all routers: `METHOD_NAME_ALL` (`ALL`), `METHODS` (the six standard methods), and `MESSAGE_MATCHER_IS_ALREADY_BUILT`.
- `UnsupportedPathError`: thrown by a router that cannot handle a path form. `SmartRouter` catches it and moves on to the next candidate.

## SmartRouter: choosing a router at first match

`src/router/smart-router/router.ts` holds the list of candidate routers and the buffered route list.

- `add` appends to its own buffer and throws `MESSAGE_MATCHER_IS_ALREADY_BUILT` after the first match.
- On the first `match`, it tries each candidate in order. For each one, it replays every buffered route into that candidate, then calls `match`. If the candidate throws `UnsupportedPathError`, the next candidate is tried. Any other error is rethrown.
- The first candidate that succeeds becomes the only router (`#routers = [router]`). The method is rebound to `router.match`, so later requests bypass `SmartRouter` entirely. The buffer is released.
- `name` becomes `SmartRouter + <activeRouter.name>`, for example `SmartRouter + RegExpRouter`. The `activeRouter` getter throws if no router has been chosen yet.

This means the router choice is made lazily at the first request, not at construction time. If every candidate rejects the routes, the code throws `Fatal error`.

## The four matchers

### RegExpRouter (default first choice)

`src/router/reg-exp-router/` compiles all routes into regular expressions in one pass.

- `add` stores handlers in per-method maps. Middleware (routes with a trailing `*`) is copied into every method's map so that a request matches its own method and `ALL` routes together.
- The first `match` calls `buildAllMatchers`, which builds one matcher per method. A matcher is a `[RegExp, HandlerData[], StaticMap]` triple. Static paths (no `:` or `*`) go into a `StaticMap` keyed by the literal path, so they are resolved without running the regex.
- Parameter routes go into a single trie of path segments (`trie.ts`) that is converted to one alternation regex. A match returns the handler list at the index of the capture group that matched, which is why the regex layout must be built in one step.
- After the build, the working maps are released and the router is frozen. Build cost is paid once, and each later match is a regex test.
- Path forms that the trie builder cannot insert raise the internal `PATH_ERROR` symbol (`src/router/reg-exp-router/node.ts`), which `buildMatcherFromPreprocessedRoutes` converts into `UnsupportedPathError`. `SmartRouter` then moves to the next candidate.

### TrieRouter (default fallback)

`src/router/trie-router/` stores routes in a node tree (`node.ts`).

- `add` expands optional parameters first (`checkOptionalParameter`), then inserts each variant into the node tree by method and path segment.
- `match` calls `Node.search`, which walks path segments and keeps a list of candidate nodes, so that static segments, `:param` segments, and wildcards are all considered in order.
- It does not need an up-front build, so routes can be added in any order and the router is never rejected for path form. This makes it the safe fallback in the default `SmartRouter`.

### LinearRouter (quick preset first choice)

`src/router/linear-router/router.ts` stores `[method, path, handler]` tuples in an array and scans them on every match.

- Routes with no `*` and no `:` are compared directly, with an optional trailing slash.
- Wildcard routes are checked by splitting the pattern at `*` and matching the parts in order.
- Routes that combine a label with a wildcard in the same pattern throw `UnsupportedPathError` (`src/router/linear-router/router.ts`, around line 137), so `SmartRouter` falls through to the next candidate.
- Cost grows with the number of routes, so it suits small apps and gives the smallest code footprint in the `hono/quick` preset.

### PatternRouter (tiny preset only)

`src/router/pattern-router/router.ts` converts each route into one anchored regular expression at add time and tests them in sequence on match.

- Trailing `*` and `?` optional segments are normalized at add time, and parameters become named capture groups.
- A pattern that cannot be compiled as a regular expression throws `UnsupportedPathError` (line 40).
- It has no separate build step and no trie, which keeps the code small. The `hono/tiny` preset uses it alone, with no `SmartRouter`, so an unsupported path there is an error rather than a fallback.

## Summary of trade-offs

| Router | Build step | Match cost | Path forms rejected | Used by |
| --- | --- | --- | --- | --- |
| RegExpRouter | Compiles all routes on first match | One regex test, static map for literals | Some label-plus-wildcard forms | `hono` default, first choice |
| TrieRouter | None (incremental insert) | Walks path segments | None known | `hono` default, fallback; `hono/quick` fallback |
| LinearRouter | None | Scans every route | Label plus wildcard in one pattern | `hono/quick` first choice |
| PatternRouter | None | Tests every route regex in order | Patterns that fail to compile | `hono/tiny` only |

## Invariants and consequences

- Handler order is registration order for every router. Middleware and routes therefore interleave as they were registered.
- Routes can only be added before the first match. Applications that register routes lazily after serving traffic will see the error.
<!-- openwiki: broken internal link [/openwiki/architecture/context-and-request.md] link "/openwiki/architecture/context-and-request.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- The router is the only component that knows about parameter storage; `HonoRequest` reads parameters through the match result and `routeIndex` (see [Context and HonoRequest](/openwiki/architecture/context-and-request.md)).

## Representative tests

- `src/router/common.case.test.ts` runs shared routing cases against the routers.
- Each router directory has its own `router.test.ts`, and `src/router/reg-exp-router/prepared-router.test.ts` covers the RegExp build path.

## Related pages

<!-- openwiki: broken internal link [/openwiki/architecture/request-lifecycle.md] link "/openwiki/architecture/request-lifecycle.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Request Lifecycle and Dispatch](/openwiki/architecture/request-lifecycle.md)
<!-- openwiki: broken internal link [/openwiki/architecture/overview.md] link "/openwiki/architecture/overview.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- [Architecture Overview](/openwiki/architecture/overview.md)
