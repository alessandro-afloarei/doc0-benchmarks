---
title: "RegExp Router"
---
## Overview

`RegExpRouter` is the first router in the default app. It does not walk a tree at request time. Instead, the first `match` for a method compiles every route of that method into one regular expression, plus a map of static paths, and each later request runs that expression once. The compiled matcher is built lazily and then kept. This page covers how the routes are collected, how one method's matcher is built, how a match is read back, and which route sets it refuses. The tree router that handles the refused sets is on [[Trie Router]], and the choice between them is on [[Router Interface and SmartRouter]].

Sources: [src/router/reg-exp-router/router.ts:122-130](repo://src/router/reg-exp-router/router.ts#L122-L130), [src/router/reg-exp-router/matcher.ts:10-33](repo://src/router/reg-exp-router/matcher.ts#L10-L33)

## Collecting routes

`add` keeps two maps keyed by method and path: `#middleware` for routes that take `next`, and `#routes` for the handlers that end a chain. The first `add` for a method copies the `ALL` entries into the new method's maps, so a route registered for every method is visible to each method. Each handler is stored with its parameter count, which is the number of `/:` in the path.

Sources: [src/router/reg-exp-router/router.ts:132-156](repo://src/router/reg-exp-router/router.ts#L132-L156), [src/router/reg-exp-router/router.ts:153-153](repo://src/router/reg-exp-router/router.ts#L153-L153)

A wildcard path is handled separately. `add` attaches the handler to every stored path that the wildcard regular expression matches, and it fills in the middleware of the wildcard's own path from the closest matching entry. A wildcard that is registered with `use` therefore runs for each route below it, in the order the routes were added.

Sources: [src/router/reg-exp-router/router.ts:155-186](repo://src/router/reg-exp-router/router.ts#L155-L186), [src/router/reg-exp-router/router.ts:105-120](repo://src/router/reg-exp-router/router.ts#L105-L120)

A path that is not a wildcard is expanded for optional segments and stored once per expanded path. Each stored entry starts with the middleware that matches the path, and the handler is appended after it, with the index that the match will report.

Sources: [src/router/reg-exp-router/router.ts:189-203](repo://src/router/reg-exp-router/router.ts#L189-L203)

## Building one matcher

`match` is replaced on the first call. It calls `buildAllMatchers`, which builds a matcher for every method that has routes and for `ALL`, and then clears the collection maps and the wildcard cache. After this point `add` throws the already-built error.

Sources: [src/router/reg-exp-router/router.ts:208-222](repo://src/router/reg-exp-router/router.ts#L208-L222), [src/router/reg-exp-router/matcher.ts:10-13](repo://src/router/reg-exp-router/matcher.ts#L10-L13)

`#buildMatcher` gathers the entries for one method from both maps. For each map, the method's own entries are used when there are any, and the `ALL` entries are used otherwise. A method with no entries in either map gets no matcher.

Sources: [src/router/reg-exp-router/router.ts:224-251](repo://src/router/reg-exp-router/router.ts#L224-L251)

`buildMatcherFromPreprocessedRoutes` sorts the entries so that the static paths come last, and the dynamic ones are ordered by length. Static paths are put in `staticMap`, and each path is inserted into a trie that writes one regular expression. Each handler records which capture group holds its parameters, and the parameter positions are rewritten after the expression is built.

Sources: [src/router/reg-exp-router/router.ts:34-103](repo://src/router/reg-exp-router/router.ts#L34-L103)

The trie that builds the expression stores each token of a path as a node. A token is one character, a `:name` pattern, or a trailing `/*`. Its `insert` replaces each `{...}` group with a mark before splitting, so the group is a single token. `buildRegExp` then turns the marks into capture groups and returns the expression, which is anchored at the start.

Sources: [src/router/reg-exp-router/trie.ts:10-47](repo://src/router/reg-exp-router/trie.ts#L10-L47), [src/router/reg-exp-router/trie.ts:49-73](repo://src/router/reg-exp-router/trie.ts#L49-L73)

## Ordering inside the expression

The children of a node are sorted before they are written, so the expression tries a literal character first, then a parameter with a pattern, then a plain label, and last a wildcard. The order is what makes the first alternative that matches the one that wins.

Sources: [src/router/reg-exp-router/node.ts:13-43](repo://src/router/reg-exp-router/node.ts#L13-L43), [src/router/reg-exp-router/node.ts:135-138](repo://src/router/reg-exp-router/node.ts#L135-L138)

## Matching a request

`match` looks up the method's matcher, or the `ALL` matcher when the method has none. A path in `staticMap` returns at once. Otherwise the request path is run through the expression. A miss returns an empty result. A hit reads the position of the first empty capture, which is the group that matched the route, and returns that group's handler list together with the captured values.

Sources: [src/router/reg-exp-router/matcher.ts:14-30](repo://src/router/reg-exp-router/matcher.ts#L14-L30), [src/router/reg-exp-router/matcher.ts:33-33](repo://src/router/reg-exp-router/matcher.ts#L33-L33)

The values are captured in order, and the parameter map of each handler was rewritten to name the capture group holding its value. The router therefore returns each handler with an index map and a stash of values, which is the first shape of the `Result` type.

Sources: [src/router/reg-exp-router/router.ts:83-94](repo://src/router/reg-exp-router/router.ts#L83-L94), [src/router.ts:98-98](repo://src/router.ts#L98-L98)

## Routes it refuses

The trie raises a path error for several route sets, and the router turns the error into `UnsupportedPathError` when it builds the matcher. The refusals are: a parameter with the expression `.*`, a capturing group in a parameter expression that is not `(?:...)`, two different parameters at the same position, a parameter next to a static segment at the same position, and two routes that end at the same point.

Sources: [src/router/reg-exp-router/node.ts:57-60](repo://src/router/reg-exp-router/node.ts#L57-L60), [src/router/reg-exp-router/node.ts:83-102](repo://src/router/reg-exp-router/node.ts#L83-L102), [src/router/reg-exp-router/node.ts:116-124](repo://src/router/reg-exp-router/node.ts#L116-L124), [src/router/reg-exp-router/router.ts:61-65](repo://src/router/reg-exp-router/router.ts#L61-L65)

A consequence is that a route set mixing `/a/b` with `/a/:x` is not kept by this router. The smart router then builds a fresh [[Trie Router]] from the same routes, so the app still answers, but the request path uses the tree. This was checked with a scratch probe: a `RegExpRouter` given `/a/:x` and `/a/b` threw `UnsupportedPathError` on its first `match`, and a `SmartRouter` over the same two routers chose `TrieRouter`.

Sources: [src/router/reg-exp-router/node.ts:116-124](repo://src/router/reg-exp-router/node.ts#L116-L124), [src/router/smart-router/router.ts:39-48](repo://src/router/smart-router/router.ts#L39-L48)
