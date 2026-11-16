---
title: "Router Interface and SmartRouter"
---
## Overview

Hono does not hard-wire a routing algorithm. The application talks to a `Router` through two methods, `add` and `match`, and any object implementing them can be passed as the `router` option. The repository ships five: `RegExpRouter`, `TrieRouter`, `LinearRouter`, `PatternRouter`, and `SmartRouter`, which wraps several of the others and keeps the first one that can handle the app's routes. This page covers the contract, `SmartRouter`, the two simple routers and the presets. The two routers of the default setup have their own pages, [[RegExpRouter]] and [[TrieRouter]].

Sources: [src/router.ts:24-51](repo://src/router.ts#L24-L51), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

## The Router contract

`add(method, path, handler)` registers one handler. The application calls it from `#addRoute` with the method upper-cased (`ALL` for `use` and `all`), the full path after base paths were merged, and a handler value that is the pair `[handler, RouterRoute]`. `match(method, path)` returns every handler registered for that method or `ALL` whose path matches, in registration order.

Sources: [src/router.ts:24-51](repo://src/router.ts#L24-L51), [src/hono-base.ts:385-397](repo://src/hono-base.ts#L385-L397)

The match result has one of two shapes. In the first, each handler is paired with a map from parameter name to an index, and a separate array, the param stash, holds the captured values; this lets many handlers share one set of captures. In the second, each handler is paired with its own map of parameter names to values. [[HonoRequest]] reads both: `#getParamValue` uses the stash when the result has one.

Sources: [src/router.ts:53-97](repo://src/router.ts#L53-L97), [src/request.ts:126-128](repo://src/request.ts#L126-L128)

```ts
export type Result<T> = [[T, ParamIndexMap][], ParamStash] | [[T, Params][]]
```

Sources: [src/router.ts:53-97](repo://src/router.ts#L53-L97), [src/request.ts:126-128](repo://src/request.ts#L126-L128)

`router.ts` also defines `METHODS` (`get`, `post`, `put`, `delete`, `options`, `patch`), the `ALL` method name, the error message thrown when a route is added after a router has compiled its matcher, and `UnsupportedPathError`, which a router throws for a path it cannot represent.

Sources: [src/router.ts:6-22](repo://src/router.ts#L6-L22), [src/router.ts:99-103](repo://src/router.ts#L99-L103)

## Path syntax

All routers accept the same path syntax, parsed by shared helpers in `utils/url`:

Sources: [src/utils/url.ts:50-77](repo://src/utils/url.ts#L50-L77), [src/utils/url.ts:171-206](repo://src/utils/url.ts#L171-L206), [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

| Syntax | Meaning |
| --- | --- |
| `/users` | Static segment |
| `/users/:id` | Named parameter matching one segment |
| `/posts/:id{[0-9]+}` | Named parameter restricted by a regular expression |
| `/animals/:type?` | Optional parameter: also registers `/animals` |
| `/files/*` | Wildcard matching the rest of the path |
| `*` | Every path, used by `use` without a path |

Sources: [src/utils/url.ts:50-77](repo://src/utils/url.ts#L50-L77), [src/utils/url.ts:171-206](repo://src/utils/url.ts#L171-L206), [src/hono-base.ts:156-168](repo://src/hono-base.ts#L156-L168)

`splitRoutingPath` splits a route into segments while protecting `{...}` groups, so a regular expression holding a `/` stays in one segment. `getPattern` turns a label into `[label, name, RegExp]` for a constrained parameter, `[label, name, true]` for a plain one, or `'*'`, and caches the result. `checkOptionalParameter` expands a path ending in an optional parameter into the list of paths with and without it.

Sources: [src/utils/url.ts:16-77](repo://src/utils/url.ts#L16-L77), [src/utils/url.ts:171-206](repo://src/utils/url.ts#L171-L206)

## SmartRouter

### Deferring the choice

`SmartRouter` is constructed with a list of routers. `add` only stores `[method, path, handler]` in an array; nothing is built yet. The first `match` call tries each router in order: it adds every stored route to it and runs the match. A router that throws `UnsupportedPathError` while adding or matching is skipped; any other error propagates.

Sources: [src/router/smart-router/router.ts:4-45](repo://src/router/smart-router/router.ts#L4-L45)

The first router that succeeds wins for the life of the app. `SmartRouter` replaces its own `match` with that router's bound `match`, drops the other routers and the stored routes, and renames itself `SmartRouter + <name>`. After that, `add` throws `Can not add a route since the matcher is already built.`, so every route must be registered before the first request. If no router accepted the routes, `match` throws `Fatal error`.

Sources: [src/router/smart-router/router.ts:46-61](repo://src/router/smart-router/router.ts#L46-L61), [src/router/smart-router/router.ts:13-19](repo://src/router/smart-router/router.ts#L13-L19), [src/router.ts:14-17](repo://src/router.ts#L14-L17)

```ts
this.match = router.match.bind(router)
this.#routers = [router]
this.#routes = undefined
break
```

Sources: [src/router/smart-router/router.ts:46-61](repo://src/router/smart-router/router.ts#L46-L61), [src/router/smart-router/router.ts:13-19](repo://src/router/smart-router/router.ts#L13-L19), [src/router.ts:14-17](repo://src/router.ts#L14-L17)

`activeRouter` returns the router that won, and throws `No active router has been determined yet.` before the first match. The dev helper's `getRouterName` forces a match on `GET /` to report it, as [[Application and Routing API]] shows.

Sources: [src/router/smart-router/router.ts:63-69](repo://src/router/smart-router/router.ts#L63-L69), [src/helper/dev/index.ts:76-79](repo://src/helper/dev/index.ts#L76-L79)

### The default pair

The default `Hono` class uses `SmartRouter` over `RegExpRouter` then `TrieRouter`. `RegExpRouter` compiles all routes into one regular expression per method and is tried first; it throws `UnsupportedPathError` when its trie cannot place a path, for example two parameters whose patterns would make the combined expression ambiguous. `TrieRouter` accepts every path, so it is the fallback that guarantees a router is found.

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/router/reg-exp-router/router.ts:56-66](repo://src/router/reg-exp-router/router.ts#L56-L66)

## LinearRouter

`LinearRouter` stores routes in a list and tests every one on each request, which makes `add` cheap and keeps the code small. `add` expands optional parameters with `checkOptionalParameter` and pushes one entry per resulting path.

Sources: [src/router/linear-router/router.ts:11-23](repo://src/router/linear-router/router.ts#L11-L23)

`match` walks the list and keeps entries whose method is the request method or `ALL`, handling each kind of path differently:

Sources: [src/router/linear-router/router.ts:25-142](repo://src/router/linear-router/router.ts#L25-L142)

- `*` and `/*` match everything with empty parameters.
- A static path matches the request path exactly, or with one trailing slash.
- A path with wildcards but no parameters is split on `*`, and each part must appear at the expected position.
- A path with parameters is split into segments; a plain `:name` captures up to the next `/`, and `:name{pattern}` runs the pattern on the rest of the path with the `d` flag to get the captured range, followed by a lookahead on the next static segment.

Sources: [src/router/linear-router/router.ts:25-142](repo://src/router/linear-router/router.ts#L25-L142)

A path that mixes parameters and wildcards throws `UnsupportedPathError` at match time, so a `SmartRouter` moves on to the next router. Results use the second shape: a fresh parameter object per handler, with the first value kept when a name appears twice.

Sources: [src/router/linear-router/router.ts:116-142](repo://src/router/linear-router/router.ts#L116-L142)

## PatternRouter

`PatternRouter` compiles each route into its own regular expression when it is added. Parameters become named groups `(?<name>pattern)`, defaulting to `[^/]+`; `/*` inside a path becomes `/[^/]+`; other characters are escaped. A path that does not end in a wildcard gets `/?$`, allowing one trailing slash. An optional final parameter registers the route a second time without that segment.

Sources: [src/router/pattern-router/router.ts:8-42](repo://src/router/pattern-router/router.ts#L8-L42)

If the regular expression cannot be built, `add` throws `UnsupportedPathError`. `match` runs every pattern of a matching method against the path and returns `match.groups` as the parameters.

Sources: [src/router/pattern-router/router.ts:33-60](repo://src/router/pattern-router/router.ts#L33-L60)

## Presets

The presets are subclasses of `HonoBase` that set a different router, exported as `hono/tiny` and `hono/quick`. Both keep the same API as `hono`.

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:1-24](repo://src/preset/quick.ts#L1-L24), [src/preset/tiny.ts:1-20](repo://src/preset/tiny.ts#L1-L20), [src/router/linear-router/router.ts:25-30](repo://src/router/linear-router/router.ts#L25-L30), [README.md:43-44](repo://README.md#L43-L44)

| Import | Router | Trade-off |
| --- | --- | --- |
| `hono` | `SmartRouter` of `RegExpRouter`, `TrieRouter` | One compiled expression per method; the README calls it "really fast" |
| `hono/quick` | `SmartRouter` of `LinearRouter`, `TrieRouter` | No compilation step: `LinearRouter` tests each route in turn |
| `hono/tiny` | `PatternRouter` | One regular expression per route; the README says the preset is under 12 kB |

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/preset/quick.ts:1-24](repo://src/preset/quick.ts#L1-L24), [src/preset/tiny.ts:1-20](repo://src/preset/tiny.ts#L1-L20), [src/router/linear-router/router.ts:25-30](repo://src/router/linear-router/router.ts#L25-L30), [README.md:43-44](repo://README.md#L43-L44)

Any router can also be passed directly, `new Hono({ router: new RegExpRouter() })`, and a custom router only has to implement `name`, `add` and `match`.

Sources: [src/hono-base.ts:55-65](repo://src/hono-base.ts#L55-L65), [src/router.ts:24-51](repo://src/router.ts#L24-L51)
