---
title: "Linear and Pattern Routers"
---
## Overview

Two routers do the matching without a precomputed structure. `LinearRouter` keeps the routes in a list and tests each one against the request in turn. `PatternRouter` compiles each route into its own regular expression at registration and tests every expression on each request. Both implement the [[Router Interface and SmartRouter]] contract and both return every matching handler in registration order. They are not the default: the `quick` preset puts `LinearRouter` in front of `TrieRouter`, and the `tiny` preset uses `PatternRouter` alone, as [[The Hono Class]] describes.

Sources: [src/router/linear-router/router.ts:11-23](repo://src/router/linear-router/router.ts#L11-L23), [src/router/pattern-router/router.ts:8-11](repo://src/router/pattern-router/router.ts#L8-L11)

## LinearRouter

`add` stores each route as a triple of method, path and handler. Optional segments are expanded first, so each expanded path is its own entry. Nothing else is done at registration, which means `LinearRouter` never refuses a path when it is added.

Sources: [src/router/linear-router/router.ts:13-23](repo://src/router/linear-router/router.ts#L13-L23)

`match` loops over the stored entries in order. An entry for another method is skipped, and an entry with the `ALL` method applies to every request. A path of `*` or `/*` matches everything and adds an empty parameter map. A path with neither `*` nor `:` is compared by equality, and a trailing slash is allowed to differ.

Sources: [src/router/linear-router/router.ts:25-39](repo://src/router/linear-router/router.ts#L25-L39)

A path with a wildcard and no parameter is split on `*`. Each piece must appear in the request at the position the previous piece left, and a piece in the middle must be followed by a `/`. A path with parameters is split into segments, and each `:name` takes the text up to the next `/`. A `:name{pattern}` takes the match of the pattern at that position, and must match from the start and must not be empty.

Sources: [src/router/linear-router/router.ts:41-134](repo://src/router/linear-router/router.ts#L41-L134)

A path that has both a parameter and a wildcard is refused: `match` throws `UnsupportedPathError` for it. That is the one case where `LinearRouter` gives up, and the `quick` preset's smart router then uses `TrieRouter` for the whole route set.

Sources: [src/router/linear-router/router.ts:136-138](repo://src/router/linear-router/router.ts#L136-L138), [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23)

Because each request tests every route, the cost grows with the number of routes. The class does no caching across requests.

Sources: [src/router/linear-router/router.ts:25-29](repo://src/router/linear-router/router.ts#L25-L29)

## PatternRouter

`PatternRouter.add` turns each path into a regular expression at registration time. It removes a trailing `/*` and leaves off the end anchor, so the route is a prefix match, and it removes a trailing `?` and adds the route for the path without its last segment. Each segment is then rewritten: `:name{regex}` becomes a named group, `:name` becomes a named group with `[^/]+`, `/*` becomes `/[^/]+`, and other characters are escaped.

Sources: [src/router/pattern-router/router.ts:12-31](repo://src/router/pattern-router/router.ts#L12-L31)

The expression is anchored at the start, and ends with `/?$` unless the path ended with a wildcard. If the `RegExp` constructor fails, `add` throws `UnsupportedPathError` at once, so an app that uses this router sees the error at registration rather than on the first request.

Sources: [src/router/pattern-router/router.ts:33-41](repo://src/router/pattern-router/router.ts#L33-L41)

`match` tests every stored expression whose method is the request's method or `ALL`. Each hit adds the handler with the named groups as its parameters, and the result is a single list. There is no index, no sort and no stash, so the order is registration order.

Sources: [src/router/pattern-router/router.ts:44-59](repo://src/router/pattern-router/router.ts#L44-L59)

## Choosing between them

`PatternRouter` is the lighter choice: its code is one class with no tree and no smart wrapper, and the `tiny` preset is built around it. Its cost is a regular-expression test for each route on each request, and it has no fallback for a path it cannot compile.

Sources: [src/preset/tiny.ts:16-19](repo://src/preset/tiny.ts#L16-L19), [src/router/pattern-router/router.ts:44-59](repo://src/router/pattern-router/router.ts#L44-L59)

`LinearRouter` is used with a fallback. When it refuses the route set, the smart router replays every route into `TrieRouter` and uses that instead, as [[Router Interface and SmartRouter]] describes. The `quick` preset is built this way.

Sources: [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23), [src/router/smart-router/router.ts:21-48](repo://src/router/smart-router/router.ts#L21-L48)
