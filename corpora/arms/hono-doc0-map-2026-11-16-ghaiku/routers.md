---
title: "Router Selection"
---
## Overview

A router answers one question: given a method and a path, which handlers run, and with which parameters. Every router implements the same `Router` interface, so the app can use any of them, and `Hono` picks one when it is built. [[Request Dispatch]] calls `match` once per request, and [[RegExp Router]] explains the default router's matching in detail.

Sources: [src/router.ts:29-52](repo://src/router.ts#L29-L52), [src/hono-base.ts:118-119](repo://src/hono-base.ts#L118-L119)

## The router interface

`add(method, path, handler)` stores a route before the first request, and `match(method, path)` returns the matches. The handler type is generic, so `Hono` stores pairs of handler and route record in the router.

Sources: [src/router.ts:29-52](repo://src/router.ts#L29-L52), [src/hono-base.ts:395](repo://src/hono-base.ts#L395)

The result has one of two shapes. The first is a list of handler and parameter-index map pairs with a shared parameter stash, which [[HonoRequest]] resolves through `routeIndex`. The second is a list of handler and parameter-value map pairs. A router that cannot take a path throws `UnsupportedPathError`, and the smart router uses that to move on.

Sources: [src/router.ts:54-98](repo://src/router.ts#L54-L98), [src/router.ts:100-103](repo://src/router.ts#L100-L103)

## The default: SmartRouter

`Hono` builds a `SmartRouter` over a `RegExpRouter` and a `TrieRouter` when no router is given. The `SmartRouter` holds all routes until the first match. On that match it tries each router in order: it adds every stored route to the candidate, and keeps the first candidate that does not throw `UnsupportedPathError`.

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/router/smart-router/router.ts:13-50](repo://src/router/smart-router/router.ts#L13-L50)

After the choice, the `SmartRouter` binds its `match` to the chosen router and drops its route list. Later requests go straight to that router, and the `name` field reports the pair, such as `SmartRouter + RegExpRouter`.

Sources: [src/router/smart-router/router.ts:46-58](repo://src/router/smart-router/router.ts#L46-L58)

If every candidate throws, the smart router raises a fatal error. Its `activeRouter` getter also throws until a router is chosen, so code that reads the active router must wait for the first match.

Sources: [src/router/smart-router/router.ts:60-70](repo://src/router/smart-router/router.ts#L60-L70)

## Choosing another router

The `router` option replaces the default. The `HonoOptions` comment shows `new Hono({ router: new RegExpRouter() })`, and the preset modules are the package's own choices of a different router. Each preset replaces the `router` field right after the base constructor runs.

Sources: [src/hono-base.ts:56-65](repo://src/hono-base.ts#L56-L65), [src/preset/tiny.ts:13-19](repo://src/preset/tiny.ts#L13-L19), [src/preset/quick.ts:14-23](repo://src/preset/quick.ts#L14-L23)

- `preset/tiny` uses a `PatternRouter` alone. Its module comment says it is the preset that uses `PatternRouter`.
- `preset/quick` uses a `SmartRouter` over a `LinearRouter` and a `TrieRouter`.
- The default `Hono` uses a `SmartRouter` over a `RegExpRouter` and a `TrieRouter`.

Sources: [src/preset/tiny.ts:1-19](repo://src/preset/tiny.ts#L1-L19), [src/preset/quick.ts:1-23](repo://src/preset/quick.ts#L1-L23), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

## The routers in the package

`TrieRouter` stores routes in a `Node` tree, one tree for all methods, and searches that tree for each request. Its `add` expands optional segments into separate routes before inserting them, so one registration can cover several paths.

Sources: [src/router/trie-router/router.ts:5-23](repo://src/router/trie-router/router.ts#L5-L23)

`PatternRouter` compiles each path into one regular expression at `add` time, with named groups for `:name` parameters and a `[^/]+` match for `/*`. `match` runs every expression for the method in registration order and collects each match's groups. A path that cannot be compiled throws `UnsupportedPathError`.

Sources: [src/router/pattern-router/router.ts:8-42](repo://src/router/pattern-router/router.ts#L8-L42), [src/router/pattern-router/router.ts:44-58](repo://src/router/pattern-router/router.ts#L44-L58)

`LinearRouter` keeps a plain list and checks each route on every request. A route is a literal path, a path with `:` labels, or a path with `*`, and each kind has its own check in the loop. It has no index, so its cost grows with the number of routes.

Sources: [src/router/linear-router/router.ts:11-30](repo://src/router/linear-router/router.ts#L11-L30), [src/router/linear-router/router.ts:31-50](repo://src/router/linear-router/router.ts#L31-L50)

`RegExpRouter` is the default. It compiles all routes for each method into one regular expression with a static-path map, and its details are on [[RegExp Router]].

Sources: [src/router/reg-exp-router/router.ts:122-140](repo://src/router/reg-exp-router/router.ts#L122-L140)

## Pages

- [[RegExp Router]] explains how the default router builds its matchers.
- [[Registering Routes]] explains what gets passed to `add`.

Sources: [src/router.ts:9-17](repo://src/router.ts#L9-L17)
