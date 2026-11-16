---
title: "Routers and Router Selection"
---
## Overview

Routing in Hono is a pluggable interface. `HonoBase` records every route with `router.add(method, path, [handler, route])` and, per request, asks `router.match(method, path)` for the matching handlers. Five implementations satisfy that interface; the default `Hono` class combines two of them in a `SmartRouter`, and two presets choose different ones. This page covers the interface, the implementations as a catalogue, and how the choice is made. How `RegExpRouter` and `TrieRouter` work inside is in [[RegExpRouter and TrieRouter Internals]].

Sources: [src/router.ts:24-52](repo://src/router.ts#L24-L52), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

## The Router interface

A `Router<T>` has a `name`, `add(method, path, handler)` and `match(method, path)`. `METHODS` lists `get`, `post`, `put`, `delete`, `options` and `patch`; `ALL` (`METHOD_NAME_ALL`) is a route registered for every method, which is how `app.use` and `app.all` are stored.

Sources: [src/router.ts:9-52](repo://src/router.ts#L9-L52)

`match` returns a `Result<T>` in one of two formats: `[[handler, paramIndexMap][], paramStash]` or `[[handler, params][]]`. In the first, parameter values are read from a shared array by index, which suits a router that matches with one regular expression; in the second each handler carries its parameter object. `HonoRequest.param` handles both. See [[Request Parsing and Validation]].

Sources: [src/router.ts:54-98](repo://src/router.ts#L54-L98), [src/request.ts:106-129](repo://src/request.ts#L106-L129)

Handlers in the result are in registration order, and each matched route, middleware included, appears once, so `compose` can run them as a chain. See [[Application and Request Dispatch]].

Sources: [src/router.ts:66-98](repo://src/router.ts#L66-L98), [src/hono-base.ts:450-454](repo://src/hono-base.ts#L450-L454)

Two exports signal failure to the code that builds a router. `UnsupportedPathError` means this router cannot handle a path pattern, and `MESSAGE_MATCHER_IS_ALREADY_BUILT` is the message used when a route is added after the router has compiled its matcher.

Sources: [src/router.ts:18-22](repo://src/router.ts#L18-L22), [src/router.ts:100-103](repo://src/router.ts#L100-L103)

## Choosing a router

### Implementations compared

| Router | Strategy | Notes from the code |
| --- | --- | --- |
| `RegExpRouter` | All routes compiled into one regular expression per method on first `match` | Throws `UnsupportedPathError` for a route set it cannot express; adding routes after the first match fails |
| `TrieRouter` | Segment tree walked per request | Handles every pattern the others reject |
| `SmartRouter` | Tries a list of routers on the first `match` and keeps the first one that accepts all routes | Used by the default `Hono` and `hono/quick` |
| `LinearRouter` | Loops over routes on every request; no build step | `hono/quick` preset; throws `UnsupportedPathError` for a path with both a `:label` and `*` |
| `PatternRouter` | One `RegExp` per route, tested in order | `hono/tiny` preset; smallest implementation |

Sources: [src/router/reg-exp-router/router.ts:106-152](repo://src/router/reg-exp-router/router.ts#L106-L152), [src/router/trie-router/router.ts:1-28](repo://src/router/trie-router/router.ts#L1-L28), [src/router/smart-router/router.ts:4-70](repo://src/router/smart-router/router.ts#L4-L70), [src/router/linear-router/router.ts:11-41](repo://src/router/linear-router/router.ts#L11-L41), [src/router/pattern-router/router.ts:8-60](repo://src/router/pattern-router/router.ts#L8-L60)

### SmartRouter

`SmartRouter` stores every `add` call in a list and does not route yet. On the first `match` it feeds the whole route list to each candidate in order. If a candidate throws `UnsupportedPathError` while adding or matching, the next candidate is tried; any other error is rethrown. The first candidate that succeeds replaces `match` with its own, the other routers and the saved routes are dropped, and `name` becomes `SmartRouter + <active name>`. If no candidate accepts the routes it throws `Fatal error`.

Sources: [src/router/smart-router/router.ts:13-62](repo://src/router/smart-router/router.ts#L13-L62)

After that first request, `add` throws `Can not add a route since the matcher is already built.`, so all routes must be registered before the first request. `activeRouter` returns the chosen router and throws before one has been chosen.

Sources: [src/router/smart-router/router.ts:13-17](repo://src/router/smart-router/router.ts#L13-L17), [src/router/smart-router/router.ts:62-70](repo://src/router/smart-router/router.ts#L62-L70)

The default `Hono` passes `[new RegExpRouter(), new TrieRouter()]`: the fast one wins whenever it can express every route, and the trie is the fallback.

Sources: [src/hono.ts:28-32](repo://src/hono.ts#L28-L32)

### LinearRouter

`LinearRouter` has no preparation step: `add` only records routes. `add` expands an optional parameter into several routes with `checkOptionalParameter`. `match` loops over all routes: `*` and `/*` always match, a static path matches itself with or without a trailing slash, star-only and label-only paths are checked piece by piece, and a path with both a label and a star throws `UnsupportedPathError`.

Sources: [src/router/linear-router/router.ts:11-41](repo://src/router/linear-router/router.ts#L11-L41), [src/router/linear-router/router.ts:136-144](repo://src/router/linear-router/router.ts#L136-L144)

### PatternRouter

`PatternRouter` converts each route into one regular expression when it is added. `:name{regex}` becomes a named group `(?<name>regex)` (default `[^/]+`), `/*` in the middle becomes `/[^/]+`, a trailing `*` leaves the end open and any other pattern ends with `/?$`. An optional trailing `?` registers the route a second time without the last segment. A path that does not compile throws `UnsupportedPathError`. `match` tests every stored route whose method is the request method or `ALL` and returns the groups as the parameters.

Sources: [src/router/pattern-router/router.ts:8-60](repo://src/router/pattern-router/router.ts#L8-L60)

## Presets

A preset is a `Hono` subclass that differs only in its constructor.

Sources: [src/preset/quick.ts:13-24](repo://src/preset/quick.ts#L13-L24)

| Import | Router | Note |
| --- | --- | --- |
| `hono` | `SmartRouter([RegExpRouter, TrieRouter])` | used when no preset is imported |
| `hono/quick` | `SmartRouter([LinearRouter, TrieRouter])` | `LinearRouter` needs no build step on first request |
| `hono/tiny` | `PatternRouter` | `PatternRouter` is the smallest implementation; the README puts `hono/tiny` under 12kB |

Sources: [README.md:22-34](repo://README.md#L22-L34), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:13-24](repo://src/preset/quick.ts#L13-L24), [src/preset/tiny.ts:11-20](repo://src/preset/tiny.ts#L11-L20)

An application can also pass `router` in `HonoOptions`, overriding the preset's choice; the `Hono` constructor uses `options.router ??` the default.

Sources: [src/hono-base.ts:55-65](repo://src/hono-base.ts#L55-L65), [src/hono.ts:28-30](repo://src/hono.ts#L28-L30)
