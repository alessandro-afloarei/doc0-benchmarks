---
title: "Trie Router"
---
## Overview

`TrieRouter` stores routes in a tree of `Node` objects, one level per path segment. A request walks the tree one segment at a time, and at each level it follows the static child, the parameter children and the wildcard child. It returns every handler that matched, sorted by the order in which the routes were registered. It accepts every route the app registers, so the default app uses it as the fallback when the [[RegExp Router]] refuses a route set. This page covers the insert, the search, and the ordering of the result. The path syntax the tree stores is on [[Route Path Patterns]].

Sources: [src/router/trie-router/router.ts:5-27](repo://src/router/trie-router/router.ts#L5-L27), [src/router/trie-router/node.ts:25-42](repo://src/router/trie-router/node.ts#L25-L42)

## Adding a route

`TrieRouter.add` expands optional segments first. Each resulting path is inserted into the root `Node` with the method and the handler. The tree is built as routes arrive, so `add` never refuses a path.

Sources: [src/router/trie-router/router.ts:13-23](repo://src/router/trie-router/router.ts#L13-L23)

`Node.insert` splits the path with `splitRoutingPath`, and for each segment it asks `getPattern` whether the segment is a parameter. A segment that is already a child is followed; a new one gets a child node. A parameter child also records its pattern in the node's pattern list, and the names it introduces go into `possibleKeys` for the route. The node that ends the path stores the handler under the method, with a score taken from a counter that increases on every insert.

Sources: [src/router/trie-router/node.ts:44-85](repo://src/router/trie-router/node.ts#L44-L85)

Because the score is the insert counter, routes registered earlier have lower scores. The score is what the search later uses to order the handlers.

Sources: [src/router/trie-router/node.ts:30-30](repo://src/router/trie-router/node.ts#L30-L30), [src/router/trie-router/node.ts:44-46](repo://src/router/trie-router/node.ts#L44-L46)

## Searching

`search` begins with the root and the segments of the request path from `splitPath`. It keeps a list of current nodes. For each segment, every current node is checked for a static child with the same text, and then for each pattern the node holds. A static child is kept for the next segment unless it is the last one, in which case its handlers are collected at once.

Sources: [src/router/trie-router/node.ts:114-143](repo://src/router/trie-router/node.ts#L114-L143)

A pattern child is tested against the segment. A `true` matcher, which is a plain `:name`, takes any segment. A regular-expression matcher is run against the rest of the path, so a parameter with a pattern can match several segments. When a pattern matches and it is the last segment, its handlers are collected; otherwise the child is queued for the next segment with the captured value.

Sources: [src/router/trie-router/node.ts:149-212](repo://src/router/trie-router/node.ts#L149-L212)

Wildcards use the same walk. A `*` child is pushed for the segment, and it stays in the list for the following segments. When the path ends at a node with a `*` child, that child is also collected, so `/hello/*` matches `/hello`. Parameter values are carried from node to node through `#params`, which each child copies from its parent before it is queued.

Sources: [src/router/trie-router/node.ts:153-165](repo://src/router/trie-router/node.ts#L153-L165), [src/router/trie-router/node.ts:136-143](repo://src/router/trie-router/node.ts#L136-L143)

## Ordering and parameters

Each handler collected during the walk is recorded in `handlerSets` with its score and the parameters that were in effect at its node. `#pushHandlerSets` also fills in the parameter names of each handler: for every key the route can use, it takes the captured value when there is one, and otherwise the value carried on the node.

Sources: [src/router/trie-router/node.ts:87-112](repo://src/router/trie-router/node.ts#L87-L112)

When more than one handler set was collected, the list is sorted by score in ascending order. That is the registration order, so a middleware added earlier runs before the route handler added later. The result is returned as a single list of handler and parameter pairs, which is the second shape of the `Result` type.

Sources: [src/router/trie-router/node.ts:237-243](repo://src/router/trie-router/node.ts#L237-L243), [src/router.ts:98-98](repo://src/router.ts#L98-L98)

## Cost and where it is used

The trie looks up one segment at a time and creates a parameter object for each handler it collects. The [[RegExp Router]] runs one expression over the whole path instead. The default app uses it for the route sets that the expression refuses, and the [[Linear and Pattern Routers]] page covers the two simpler routers that the presets use in its place.

Sources: [src/router/trie-router/node.ts:114-124](repo://src/router/trie-router/node.ts#L114-L124), [src/hono.ts:27-33](repo://src/hono.ts#L27-L33)
