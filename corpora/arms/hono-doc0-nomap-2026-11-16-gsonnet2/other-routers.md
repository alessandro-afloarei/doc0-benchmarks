---
title: "TrieRouter, LinearRouter and PatternRouter"
---
## Overview

Besides `RegExpRouter` ([[RegExpRouter Internals]]), Hono has three routers that return handlers by testing a path against stored routes at request time. They implement the same `Router` contract ([[Router Interface and SmartRouter]]) and differ in data structure and in which path syntax they support. `TrieRouter` supports all of it and is the fallback in both smart configurations; `LinearRouter` and `PatternRouter` are simpler and are used by the `quick` and `tiny` presets.

Sources: [src/router/trie-router/router.ts:5-28](repo://src/router/trie-router/router.ts#L5-L28), [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23), [src/preset/tiny.ts:15-20](repo://src/preset/tiny.ts#L15-L20)

| Router | Structure | Chosen by | Throws `UnsupportedPathError` |
| --- | --- | --- | --- |
| `TrieRouter` | Tree of path segments | Last candidate in `hono` and `hono/quick` | Never |
| `LinearRouter` | Flat route list, hand-written matching | First candidate in `hono/quick` | Path with both `:label` and `*` |
| `PatternRouter` | Flat list of compiled `RegExp`s | Only router in `hono/tiny` | When the generated regex is invalid |

Sources: [src/router/trie-router/router.ts:5-28](repo://src/router/trie-router/router.ts#L5-L28), [src/router/linear-router/router.ts:136-138](repo://src/router/linear-router/router.ts#L136-L138), [src/router/pattern-router/router.ts:33-41](repo://src/router/pattern-router/router.ts#L33-L41), [src/preset/quick.ts:18-23](repo://src/preset/quick.ts#L18-L23), [src/preset/tiny.ts:15-20](repo://src/preset/tiny.ts#L15-L20)

## TrieRouter

`TrieRouter` owns a root `Node` and delegates. `add` expands an optional-parameter path (`/animals/:type?`) with `checkOptionalParameter` into several paths and inserts each; `match` calls `node.search`.

Sources: [src/router/trie-router/router.ts:5-28](repo://src/router/trie-router/router.ts#L5-L28)

`Node.insert` splits the route with `splitRoutingPath`, and for each segment asks `getPattern` whether it is a wildcard (`*`), a label (`:id`, matcher `true`) or a label with a regex (`:id{[0-9]+}`). Patterns are cached. A segment with a regex gets a matcher `^regex(?=/next)` when another literal segment follows, so that the regex can span slashes up to that segment, and `^regex$` otherwise. Child nodes are keyed by the segment or by the pattern's key, and pattern segments are also remembered in `#patterns` for search. At the final node it pushes `{ [method]: { handler, possibleKeys, score } }`, where `score` is the node-wide insertion counter `#order`, so it records registration order.

Sources: [src/router/trie-router/node.ts:44-85](repo://src/router/trie-router/node.ts#L44-L85), [src/utils/url.ts:50-78](repo://src/utils/url.ts#L50-L78)

`Node.search` walks the path segment by segment, keeping a list of current nodes (a path can match several branches at once). At each node it tries three things: a child whose key equals the segment; a wildcard child; and each stored pattern. For a pattern with a regex, the matcher is tested against the rest of the path string, so one parameter may consume several segments; matches are queued by the number of segments they consume so the loop resumes at the right depth. The special cases for the last segment: `/hello/*` also matches `/hello`, and `/:id{[0-9]+}/*` also matches `/123`.

Sources: [src/router/trie-router/node.ts:114-232](repo://src/router/trie-router/node.ts#L114-L232)

Handlers are collected by `#pushHandlerSets` for a method or for `ALL`. It fills `params` for each handler from the parameters collected along the path, restricted to that route's own `possibleKeys`, so a handler only sees its own parameter names. At the end, handler sets are sorted by `score`, which restores registration order across branches, and the result is `[[handler, params][]]`.

Sources: [src/router/trie-router/node.ts:87-112](repo://src/router/trie-router/node.ts#L87-L112), [src/router/trie-router/node.ts:237-244](repo://src/router/trie-router/node.ts#L237-L244)

## LinearRouter

`LinearRouter` keeps `[method, path, handler][]`; `add` expands optional parameters into separate entries. `match` loops over every route whose method equals the request method or is `ALL`, and picks one of four strategies by looking at the route path:

Sources: [src/router/linear-router/router.ts:25-40](repo://src/router/linear-router/router.ts#L25-L40)

- `*` or `/*` always matches.
- A static path matches when equal to the request path or to it plus a trailing slash.
- A path with `*` and no label is split at each `*`; each literal piece must appear at the exact running position in the request path, with the trailing `*` allowed to consume the rest.
- A path with labels and no `*` is tokenised with `splitPathRe`; each `/:label` consumes up to the next `/`, a `:label{regex}` is run against the remaining path with a lookahead for the next literal, and literals must appear at the running position.

Sources: [src/router/linear-router/router.ts:35-135](repo://src/router/linear-router/router.ts#L35-L135)

A route with both a label and `*` throws `UnsupportedPathError`, and this happens during `match` (the router stores everything in `add`). Under `SmartRouter` that is caught, and `TrieRouter` takes over.

Sources: [src/router/linear-router/router.ts:11-24](repo://src/router/linear-router/router.ts#L11-L24), [src/router/linear-router/router.ts:25-143](repo://src/router/linear-router/router.ts#L25-L143)

Matching in `LinearRouter` needs no build step: registering is just an array push and every request pays for scanning the list. That cost profile is the trade-off against `RegExpRouter`, which does its work once at the first request.

Sources: [src/router/linear-router/router.ts:15-23](repo://src/router/linear-router/router.ts#L15-L23), [src/router/reg-exp-router/matcher.ts:10-33](repo://src/router/reg-exp-router/matcher.ts#L10-L33)

## PatternRouter

`PatternRouter` compiles each route to one `RegExp` at `add` time. A trailing `/*` is stripped and makes the regex open-ended; otherwise the regex ends with an optional slash. A trailing `?` registers the shorter path too (by recursion) and then continues with the longer one. Each path segment is mapped: `/:name` or `/:name{regex}` becomes a named group `(?<name>regex)` with the default `[^/]+`, a mid-path `/*` becomes `/[^/]+`, and literal segments have regex metacharacters escaped. If constructing the `RegExp` throws, `add` throws `UnsupportedPathError`.

Sources: [src/router/pattern-router/router.ts:12-42](repo://src/router/pattern-router/router.ts#L12-L42)

`match` scans all routes in order and collects every one whose method equals the request's (or is `ALL`) and whose pattern matches, returning the named groups as `params`. There is no scoring: handlers come out in registration order because the list is in registration order.

Sources: [src/router/pattern-router/router.ts:44-59](repo://src/router/pattern-router/router.ts#L44-L59)
