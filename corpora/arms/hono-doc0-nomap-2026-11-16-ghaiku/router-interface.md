---
title: "Router Interface and SmartRouter"
---
## Overview

Every router in Hono implements one interface, `Router<T>`, with two methods: `add` stores a route, and `match` returns the handlers for a method and path. The app stores each route in its router as it is registered, and the router answers each request. `SmartRouter` is the router the app uses by default. It is a wrapper that holds several real routers, tries them in turn on the first request, and keeps the one that accepts every route. This page covers the interface, the result shapes, and how `SmartRouter` chooses. The routers themselves are on the pages that follow [[RegExp Router]], [[Trie Router]] and [[Linear and Pattern Routers]].

Sources: [src/router.ts:29-52](repo://src/router.ts#L29-L52), [src/router/smart-router/router.ts:4-11](repo://src/router/smart-router/router.ts#L4-L11)

## The interface

`add(method, path, handler)` stores a handler for one method and path. `match(method, path)` returns a `Result`. The `T` type is what the app passes in: a pair of the handler and its route record, as [[Registering Routes]] describes.

Sources: [src/router.ts:29-52](repo://src/router.ts#L29-L52), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

A `Result` has one of two shapes. The first is a list of entries, each a handler with a map from parameter names to positions in a shared stash, followed by the stash. The second is a list of entries, each a handler with a map from names to values. `RegExpRouter` returns the first shape, `SmartRouter` returns whatever shape the router it chose returns, and the trie and pattern routers return the second.

Sources: [src/router.ts:57-65](repo://src/router.ts#L57-L65), [src/router.ts:98-98](repo://src/router.ts#L98-L98), [src/router/trie-router/node.ts:114-114](repo://src/router/trie-router/node.ts#L114-L114)

The module also defines the constants the rest of the code shares: `METHOD_NAME_ALL` is `ALL`, which a route stored for every method uses, and `METHODS` lists the six named methods. `MESSAGE_MATCHER_IS_ALREADY_BUILT` is the error for a route added after the matcher was built. `UnsupportedPathError` is the signal that a router cannot represent a path.

Sources: [src/router.ts:9-21](repo://src/router.ts#L9-L21), [src/router.ts:103-103](repo://src/router.ts#L103-L103)

## SmartRouter

`SmartRouter` takes a list of routers in its constructor. It keeps the list and a copy of every route it has been given, in a list that is `undefined` once the choice is made. Its `add` appends to that list and throws the already-built error if the choice has been made.

Sources: [src/router/smart-router/router.ts:4-19](repo://src/router/smart-router/router.ts#L4-L19)

On the first `match`, `SmartRouter` tries each candidate in order. For each one it adds every stored route, then calls its `match`. If that throws `UnsupportedPathError`, it moves to the next candidate. Any other error is rethrown. The first candidate that returns a result is kept: `match` is replaced by that router's bound `match`, the list of candidates is reduced to that one router, and the stored routes are dropped.

Sources: [src/router/smart-router/router.ts:21-48](repo://src/router/smart-router/router.ts#L21-L48)

After the choice, `name` is set to `SmartRouter + ` followed by the chosen router's name, such as `SmartRouter + RegExpRouter`. The `activeRouter` getter returns the chosen router and throws if no choice has been made yet.

Sources: [src/router/smart-router/router.ts:57-69](repo://src/router/smart-router/router.ts#L57-L69)

## What the default app chooses

The default app lists `RegExpRouter` first and `TrieRouter` second. `RegExpRouter` raises `UnsupportedPathError` when its trie reports a path it cannot represent, so such a route falls through to `TrieRouter`. `TrieRouter` has no code that raises `UnsupportedPathError`, so it accepts every route the app registers. When no candidate accepts the routes, the code throws `Fatal error`.

Sources: [src/hono.ts:27-33](repo://src/hono.ts#L27-L33), [src/router/reg-exp-router/router.ts:61-65](repo://src/router/reg-exp-router/router.ts#L61-L65), [src/router/smart-router/router.ts:52-55](repo://src/router/smart-router/router.ts#L52-L55), [src/router/trie-router/router.ts:13-23](repo://src/router/trie-router/router.ts#L13-L23)

A reader who writes a custom router should throw `UnsupportedPathError` for a path it cannot handle, and must not throw any other error for one. Any other error stops the choice, and the first request fails.

Sources: [src/router/smart-router/router.ts:39-44](repo://src/router/smart-router/router.ts#L39-L44)
