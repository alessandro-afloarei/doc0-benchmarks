---
title: "TrieRouter, LinearRouter and PatternRouter"
---
## Overview

Besides [[RegExpRouter]], Hono ships three routers that implement the same `Router` interface ([[Routers and Presets]]) with different trade-offs. `TrieRouter` supports every path pattern and is the fallback of both `SmartRouter` presets. `LinearRouter` does no work at registration and suits apps that are rebuilt on every request (`hono/quick`). `PatternRouter` is the smallest implementation and the only router in `hono/tiny`. All three return parameters as values (the direct-params `Result` shape), not as indexes into a stash.

Sources: [src/router/trie-router/router.ts:1-28](repo://src/router/trie-router/router.ts#L1-L28), [src/preset/quick.ts:1-24](repo://src/preset/quick.ts#L1-L24), [src/preset/tiny.ts:1-20](repo://src/preset/tiny.ts#L1-L20)

| Router | Registration cost | Match cost | Unsupported paths |
| --- | --- | --- | --- |
| `TrieRouter` | Insert into a segment tree | Walk the tree, follow every branch that can match | None |
| `LinearRouter` | Push to an array | Test every route with string scans | A path with both `:label` and `*` |
| `PatternRouter` | Compile one `RegExp` per route | Run every route's `RegExp` | A path that does not compile, such as a repeated parameter name |

Sources: [src/router/trie-router/node.ts:44-85](repo://src/router/trie-router/node.ts#L44-L85), [src/router/linear-router/router.ts:15-23](repo://src/router/linear-router/router.ts#L15-L23), [src/router/pattern-router/router.ts:12-42](repo://src/router/pattern-router/router.ts#L12-L42)

## TrieRouter

### Building the tree

`TrieRouter.add` expands optional parameters with `checkOptionalParameter` and inserts each variant into a root `Node`. `Node.insert` splits the path into segments with `splitRoutingPath` and walks or creates one child per segment. A segment that is a label or wildcard is turned into a pattern by `getPattern` (`'*'`, or `[key, name, true]` for `:name`, or `[key, name, RegExp]` for `:name{regexp}`), recorded in the parent's `#patterns`, and its name added to the route's `possibleKeys`. At the last node it stores `{ [method]: { handler, possibleKeys, score } }`, where `score` is a counter incremented on every insert.

Sources: [src/router/trie-router/router.ts:13-23](repo://src/router/trie-router/router.ts#L13-L23), [src/router/trie-router/node.ts:44-85](repo://src/router/trie-router/node.ts#L44-L85), [src/utils/url.ts:51-78](repo://src/utils/url.ts#L51-L78)

When a custom pattern is followed by a literal segment, `getPattern` builds its `RegExp` with a lookahead for that next segment, so `/:file{.+}/edit` stops the parameter before `/edit`.

Sources: [src/utils/url.ts:60-71](repo://src/utils/url.ts#L60-L71)

### Searching

`search(method, path)` splits the request path and keeps a list of current nodes, starting at the root. For each segment, every current node contributes the candidates listed below.

Sources: [src/router/trie-router/node.ts:114-131](repo://src/router/trie-router/node.ts#L114-L131)

- its literal child for the segment, if any;
- for each pattern: the `*` child (which also stays current, so `/a/*/c` can match more segments), or the label child when `matcher` is `true` or the segment passes the label's `RegExp`;
- for a `RegExp` pattern, a match against the rest of the path from this segment, so a pattern like `{.+\\.js}` can span several segments. The child is queued to resume after as many segments as the match contained slashes.

Sources: [src/router/trie-router/node.ts:127-235](repo://src/router/trie-router/node.ts#L127-L235)

On the last segment, matching nodes push their handler sets, along with a `*` child if present so `/hello/*` matches `/hello`. `#pushHandlerSets` selects the handler for the method or `ALL` and fills its params from `possibleKeys`.

Sources: [src/router/trie-router/node.ts:87-112](repo://src/router/trie-router/node.ts#L87-L112), [src/router/trie-router/node.ts:136-147](repo://src/router/trie-router/node.ts#L136-L147)

### Ordering

Several branches can match one path, so handler sets are collected in tree order, then sorted by `score`. Because `score` is the insertion counter, the final list is in registration order, the same order `RegExpRouter` and the others produce. That is what keeps middleware before handlers no matter which router `SmartRouter` picked.

Sources: [src/router/trie-router/node.ts:237-243](repo://src/router/trie-router/node.ts#L237-L243), [src/router/trie-router/node.ts:44-45](repo://src/router/trie-router/node.ts#L44-L45)

TrieRouter is strict about trailing slashes: `/hello/` splits into `['hello', '']` and does not reach a route registered as `/hello`. Apps that want both use `strict: false` or the trailing-slash middleware ([[Body Limit, Timeout, Method Override and Trailing Slash]]).

Sources: [src/utils/url.ts:8-14](repo://src/utils/url.ts#L8-L14)

## LinearRouter

`LinearRouter.add` pushes `[method, path, handler]` to an array, once per optional-parameter variant. Nothing is compiled, so creating an app and serving one request costs less than with routers that build a structure first.

Sources: [src/router/linear-router/router.ts:11-23](repo://src/router/linear-router/router.ts#L11-L23)

`match` loops over every route whose method is the request's method or `ALL`, in registration order, and handles four route kinds with string operations.

Sources: [src/router/linear-router/router.ts:25-36](repo://src/router/linear-router/router.ts#L25-L36)

| Route kind | How it matches |
| --- | --- |
| `*` or `/*` | Always |
| Static | Equal to the path, or to the path minus a trailing `/` |
| Wildcards only | The parts between `*` must appear at the expected positions, each `*` consuming up to the next `/` |
| Labels only | Literal parts must match at the cursor; `:name` takes the next segment; `:name{regexp}` runs the pattern (with a lookahead for the next literal) on the rest of the path |
| Labels and wildcards | Throws `UnsupportedPathError` |

Sources: [src/router/linear-router/router.ts:25-143](repo://src/router/linear-router/router.ts#L25-L143)

In `hono/quick` that error makes `SmartRouter` switch to `TrieRouter` for the whole app. Matching cost grows with the number of routes, which is why `LinearRouter` is the choice only when start-up cost dominates.

Sources: [src/preset/quick.ts:16-22](repo://src/preset/quick.ts#L16-L22)

## PatternRouter

`PatternRouter.add` converts each route into one regular expression with named groups: `/:id` becomes `/(?<id>[^/]+)`, `/:id{[0-9]+}` becomes `/(?<id>[0-9]+)`, a middle `/*` becomes `/[^/]+`, and literal characters are escaped. A trailing `*` drops the end anchor; otherwise the expression ends with `/?$`, so a trailing slash is accepted. An optional parameter registers the route a second time without its last segment.

Sources: [src/router/pattern-router/router.ts:12-42](repo://src/router/pattern-router/router.ts#L12-L42)

`match` runs every route's expression whose method fits and uses `match.groups` as the parameters. If `new RegExp` throws during `add` (two parameters with the same name produce duplicate group names, for example), the router throws `UnsupportedPathError`. `hono/tiny` uses `PatternRouter` alone, so there is no fallback: the error reaches the code that registered the route.

Sources: [src/router/pattern-router/router.ts:33-59](repo://src/router/pattern-router/router.ts#L33-L59), [src/preset/tiny.ts:12-19](repo://src/preset/tiny.ts#L12-L19)

## Choosing a router

The default `Hono` is the right choice unless a measurement says otherwise: `RegExpRouter` gives the fastest matching after one compile, and `TrieRouter` covers any route set it rejects. `hono/quick` fits platforms that construct the app per request. `hono/tiny` fits bundles where every kilobyte counts and routes are simple. Benchmarks comparing the routers are in the `benchmarks` directory.

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:16-22](repo://src/preset/quick.ts#L16-L22), [src/preset/tiny.ts:12-19](repo://src/preset/tiny.ts#L12-L19)
