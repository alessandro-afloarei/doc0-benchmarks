---
title: "Routers"
---
## Overview

A router turns a method and a path into the list of handlers that match them. Hono ships five implementations in `src/router`, and the app talks to them only through the `Router` interface. This page explains that interface, how the default router is picked, and how each implementation matches. How the matched list is run is in [[Request Dispatch]], and how routes get into a router is in [[App and Routing]].

Sources: [src/router.ts:29-52](repo://src/router.ts#L29-L52), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

## The Router interface

A router has a `name`, an `add(method, path, handler)` method that stores a route, and a `match(method, path)` method that returns the matched handlers. The handler type is the pair `[handler, RouterRoute]` that `#addRoute` passes in, so every router returns the route metadata along with the handler.

Sources: [src/router.ts:29-52](repo://src/router.ts#L29-L52), [src/hono-base.ts:395-395](repo://src/hono-base.ts#L395-L395)

`match` returns one of two shapes. The first is the handler list with a parameter index map for each handler, followed by a stash of the captured values. The second is the handler list with a ready-made parameter object per handler. Both are typed as `Result<T>`.

Sources: [src/router.ts:54-98](repo://src/router.ts#L54-L98)

A matcher that cannot represent a path throws `UnsupportedPathError`. `SmartRouter` relies on that error to move on to the next implementation.

Sources: [src/router.ts:100-103](repo://src/router.ts#L100-L103)

## Choosing a router

The `Hono` class in `src/hono.ts` builds a `SmartRouter` over a `RegExpRouter` and a `TrieRouter` when the options have no `router`. The `router` option replaces that choice entirely, so an app can pass a `PreparedRegExpRouter` or any object that implements `Router`.

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/hono-base.ts:46-65](repo://src/hono-base.ts#L46-L65)

The presets change the default. `quick` uses `SmartRouter` over `LinearRouter` and `TrieRouter`, and `tiny` uses only `PatternRouter`, which has no fallback.

Sources: [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23), [src/preset/tiny.ts:16-19](repo://src/preset/tiny.ts#L16-L19)

## SmartRouter

`SmartRouter` holds a list of routers and the routes added so far. `add` only stores the route, and throws once the matcher is built. The first `match` call tries each router in turn: it replays every stored route into the router, then calls `match`. A router that throws `UnsupportedPathError` is skipped; the first one that does not throw is kept.

Sources: [src/router/smart-router/router.ts:13-44](repo://src/router/smart-router/router.ts#L13-L44)

Once a router is chosen, `SmartRouter` binds its `match` onto itself, drops the stored routes and keeps only that router. Later requests call the chosen router directly with no replay, and `name` becomes `SmartRouter + <router name>`, which shows up in debugging output.

Sources: [src/router/smart-router/router.ts:46-58](repo://src/router/smart-router/router.ts#L46-L58)

## RegExpRouter

`RegExpRouter` builds its matchers on the first `match` call, not during `add`. Routes are grouped per method, and each method gets one regular expression that matches every dynamic path. Static paths (no `*` and no `:` label) are kept in a plain map, so a request for a static path is a single property lookup.

Sources: [src/router/reg-exp-router/router.ts:208-221](repo://src/router/reg-exp-router/router.ts#L208-L221), [src/router/reg-exp-router/router.ts:34-60](repo://src/router/reg-exp-router/router.ts#L34-L60)

The matcher runs the static map first, then the regular expression. The position of the first empty capture group in the match result selects the handler list, so one regex test finds every dynamic route for the method. Without a match the router returns an empty list.

Sources: [src/router/reg-exp-router/matcher.ts:10-31](repo://src/router/reg-exp-router/matcher.ts#L10-L31)

Wildcards are turned into regular expressions by `buildWildcardRegExp`, and middleware registered with `*` is added to every matching path entry at build time. A path whose pattern the trie cannot express raises `PATH_ERROR`, which becomes `UnsupportedPathError` so that `SmartRouter` falls back.

Sources: [src/router/reg-exp-router/router.ts:20-30](repo://src/router/reg-exp-router/router.ts#L20-L30), [src/router/reg-exp-router/router.ts:132-165](repo://src/router/reg-exp-router/router.ts#L132-L165), [src/router/reg-exp-router/router.ts:62-66](repo://src/router/reg-exp-router/router.ts#L62-L66)

After the matchers are built, `buildAllMatchers` clears the route cache, so memory used during registration is released once the first request has been matched.

Sources: [src/router/reg-exp-router/router.ts:208-220](repo://src/router/reg-exp-router/router.ts#L208-L220)

## TrieRouter

`TrieRouter` stores routes in a tree of path segments. `add` splits an optional parameter such as `/animals/:type?` into two inserts, one with and one without the segment, so both shapes match.

Sources: [src/router/trie-router/router.ts:13-23](repo://src/router/trie-router/router.ts#L13-L23)

`search` walks the tree one path segment at a time, keeping every node that matches the segments so far and collecting a handler set at each match. The sets are sorted by their score, which is the registration order, so handlers come back in the order they were added.

Sources: [src/router/trie-router/node.ts:114-122](repo://src/router/trie-router/node.ts#L114-L122), [src/router/trie-router/node.ts:238-242](repo://src/router/trie-router/node.ts#L238-L242)

## LinearRouter

`LinearRouter` keeps a flat array of `[method, path, handler]` and scans it on each request. A route is matched by simple string rules: a `*` path matches everything, a plain path matches exactly or with a trailing slash, and a path with `*` or `:` checks its parts in order. `add` never throws, so `LinearRouter` never raises `UnsupportedPathError`. Inside `SmartRouter` it is therefore always the router that is kept, which is what the `quick` preset gets in practice.

Sources: [src/router/linear-router/router.ts:15-30](repo://src/router/linear-router/router.ts#L15-L30), [src/router/linear-router/router.ts:30-60](repo://src/router/linear-router/router.ts#L30-L60), [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23)

## PatternRouter

`PatternRouter` compiles each route to one regular expression in `add`, with named groups for parameters. A path that cannot be compiled throws `UnsupportedPathError`. `match` runs every expression and returns all the handlers whose expression matched, with the groups as parameters.

Sources: [src/router/pattern-router/router.ts:12-41](repo://src/router/pattern-router/router.ts#L12-L41), [src/router/pattern-router/router.ts:44-57](repo://src/router/pattern-router/router.ts#L44-L57)

Because it has no index, the cost of `PatternRouter` grows with the number of routes, which is why the `tiny` preset is chosen for small apps where code size matters more than lookup speed.

Sources: [src/preset/tiny.ts:16-19](repo://src/preset/tiny.ts#L16-L19)

## PreparedRegExpRouter

`PreparedRegExpRouter` takes matchers that were built ahead of time, so the first request does not pay for the build. `buildInitParams` builds the matchers for a list of paths and returns them with a relocation map. `serializeInitParams` writes them as a JavaScript array literal, with each regular expression embedded as its source, so a build step can place them in the bundle.

Sources: [src/router/reg-exp-router/prepared-router.ts:95-165](repo://src/router/reg-exp-router/prepared-router.ts#L95-L165)
