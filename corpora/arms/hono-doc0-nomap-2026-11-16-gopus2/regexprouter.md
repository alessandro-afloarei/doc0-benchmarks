---
title: "RegExpRouter"
---
## Overview

`RegExpRouter` is the first router the default `Hono` tries. Instead of walking a list or a tree per request, it compiles every route of a method into a single regular expression the first time `match` is called, and answers each request with one `String.prototype.match` call or a lookup in a map of static paths. The price is that some route sets cannot be expressed in one unambiguous expression; for those it throws `UnsupportedPathError` and a `SmartRouter` falls back to [[TrieRouter]], as [[Router Interface and SmartRouter]] explains.

Sources: [src/router/reg-exp-router/router.ts:122-130](repo://src/router/reg-exp-router/router.ts#L122-L130), [src/router/reg-exp-router/matcher.ts:10-33](repo://src/router/reg-exp-router/matcher.ts#L10-L33), [src/hono.ts:26-33](repo://src/hono.ts#L26-L33)

The work splits into two phases. `add` only sorts handlers into per-method maps keyed by path. The first `match` builds a matcher per method from those maps, frees them, and replaces itself with the fast matching function.

Sources: [src/router/reg-exp-router/router.ts:132-222](repo://src/router/reg-exp-router/router.ts#L132-L222)

## Registering routes

### Per-method maps

The router keeps two maps, `#middleware` and `#routes`, each holding a record per method from path to a list of `[handler, paramCount]`. The first time a method is seen, both maps get a copy of everything registered under `ALL`, so a `GET` route still sees middleware added with `use` earlier. `/*` is normalised to `*`, and `paramCount` is the number of `/:` in the path.

Sources: [src/router/reg-exp-router/router.ts:124-153](repo://src/router/reg-exp-router/router.ts#L124-L153)

### Wildcard paths

A path ending in `*` is treated as middleware. `buildWildcardRegExp` turns it into an expression that matches the prefix followed by nothing or by `/...`, with a cache that is cleared after compilation. The handler is pushed onto every existing middleware entry and route whose path that expression matches, for the method or for all methods when registered as `ALL`. Before that, a new wildcard entry is seeded with the handlers of the longest wildcard already registered that matches it, through `findMiddleware`.

Sources: [src/router/reg-exp-router/router.ts:19-32](repo://src/router/reg-exp-router/router.ts#L19-L32), [src/router/reg-exp-router/router.ts:105-120](repo://src/router/reg-exp-router/router.ts#L105-L120), [src/router/reg-exp-router/router.ts:155-187](repo://src/router/reg-exp-router/router.ts#L155-L187)

### Plain paths

Any other path is expanded by `checkOptionalParameter` into one or more paths. Each new route entry starts with a copy of the middleware that applies to it, then gets the handler appended. Because middleware is copied into each route's list when that route is first created and later middleware is pushed onto matching routes, every route's list is already the full ordered chain of handlers for that path.

Sources: [src/router/reg-exp-router/router.ts:189-204](repo://src/router/reg-exp-router/router.ts#L189-L204)

## Building the matcher

### Choosing routes per method

`buildAllMatchers` calls `#buildMatcher` for every method that has routes or middleware, then sets both maps to `undefined` so a later `add` throws `Can not add a route since the matcher is already built.` A method that has no route of its own reuses the `ALL` entries; when neither has anything, it gets no matcher and `match` falls back to the `ALL` matcher.

Sources: [src/router/reg-exp-router/router.ts:208-251](repo://src/router/reg-exp-router/router.ts#L208-L251), [src/router/reg-exp-router/router.ts:132-138](repo://src/router/reg-exp-router/router.ts#L132-L138)

### Static map and trie insertion

`buildMatcherFromPreprocessedRoutes` flags each path as static when it has no `*` and no `/:`, and sorts dynamic paths by length before static ones. A static path goes into a `staticMap` with an empty parameter map per handler, so a request for it never runs the expression. It is still inserted into the trie with `pathErrorCheckOnly` set, which only checks that it would not conflict with a dynamic route.

Sources: [src/router/reg-exp-router/router.ts:34-69](repo://src/router/reg-exp-router/router.ts#L34-L69)

Each dynamic path is inserted with its index `j`. `Trie.insert` first replaces `{...}` groups with marks, tokenises the path into parameters (`:name` or `:name{re}`), a trailing `/*`, and single characters, then restores the groups and passes the tokens to the root `Node`.

Sources: [src/router/reg-exp-router/trie.ts:6-47](repo://src/router/reg-exp-router/trie.ts#L6-L47)

`Node.insert` walks one token per level. A parameter becomes a child keyed by its expression (`[^/]+` by default) and gets the next variable index the first time that child is created; the insertion records `[name, varIndex]` in the route's parameter list. A literal character becomes a child keyed by itself. At the end of the tokens the node stores the route index.

Sources: [src/router/reg-exp-router/node.ts:45-133](repo://src/router/reg-exp-router/node.ts#L45-L133)

### Generating the expression

`Node.buildRegExpStr` sorts each node's children (literals, then constrained parameters, then plain parameters, then wildcards), wraps parameter children as `(expr)@varIndex`, escapes metacharacters, prefixes `#index` when a route ends at this node, and joins alternatives with `(?:...|...)`.

Sources: [src/router/reg-exp-router/node.ts:13-43](repo://src/router/reg-exp-router/node.ts#L13-L43), [src/router/reg-exp-router/node.ts:135-161](repo://src/router/reg-exp-router/node.ts#L135-L161)

`Trie.buildRegExp` then rewrites the markers while counting capture groups. Each `#index` becomes an empty capture `$()` and records which capture number belongs to which route index; each `@varIndex` is dropped and records which capture number holds that variable. The result is anchored with `^`.

Sources: [src/router/reg-exp-router/trie.ts:49-73](repo://src/router/reg-exp-router/trie.ts#L49-L73)

```ts
regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
  if (handlerIndex !== undefined) {
    indexReplacementMap[++captureIndex] = Number(handlerIndex)
    return '$()'
  }
  if (paramIndex !== undefined) {
    paramReplacementMap[Number(paramIndex)] = ++captureIndex
    return ''
  }

  return ''
})
```

Sources: [src/router/reg-exp-router/trie.ts:49-73](repo://src/router/reg-exp-router/trie.ts#L49-L73)

Back in `buildMatcherFromPreprocessedRoutes`, each handler's `[name, varIndex]` pairs become a `ParamIndexMap` from name to capture number, and the handler lists are re-indexed by capture number. The matcher for the method is the triple `[regexp, handlerMap, staticMap]`.

Sources: [src/router/reg-exp-router/router.ts:71-103](repo://src/router/reg-exp-router/router.ts#L71-L103), [src/router/reg-exp-router/matcher.ts:1-8](repo://src/router/reg-exp-router/matcher.ts#L1-L8)

## Matching

The first call to `match` builds all matchers and replaces `this.match` with a closure over them. For each request the closure picks the method's matcher or the `ALL` one, returns the static map entry when the path is in it, and otherwise runs the expression. The empty capture that marks a route end is the only empty string after index 0 in the result array, so `match.indexOf('', 1)` yields the capture number of the route that matched, which indexes `handlerMap`.

Sources: [src/router/reg-exp-router/matcher.ts:10-33](repo://src/router/reg-exp-router/matcher.ts#L10-L33)

```ts
const match = path.match(matcher[0])
if (!match) {
  return [[], emptyParam]
}

const index = match.indexOf('', 1)
return [matcher[1][index], match]
```

Sources: [src/router/reg-exp-router/matcher.ts:10-33](repo://src/router/reg-exp-router/matcher.ts#L10-L33)

The match array itself is returned as the param stash: each handler's `ParamIndexMap` holds capture numbers, and [[HonoRequest]] reads `stash[index]` for a parameter. No parameter object is built unless the handler asks for one.

Sources: [src/router/reg-exp-router/matcher.ts:30-31](repo://src/router/reg-exp-router/matcher.ts#L30-L31), [src/request.ts:126-128](repo://src/request.ts#L126-L128)

## Unsupported paths

`Node.insert` throws an internal `PATH_ERROR`, which the builder turns into `UnsupportedPathError(path)`, whenever one expression could not return the right handlers:

Sources: [src/router/reg-exp-router/node.ts:57-130](repo://src/router/reg-exp-router/node.ts#L57-L130), [src/router/reg-exp-router/router.ts:60-65](repo://src/router/reg-exp-router/router.ts#L60-L65)

| Situation | Example |
| --- | --- |
| A literal and a parameter at the same position in different routes | `/reg-exp/router` and `/reg-exp/:id` |
| Two different parameter expressions at the same position | `/:id{[0-9]+}` and `/:name` |
| Two paths ending at the same node | `/:type/:id` and `/:class/:id` |
| A constrained parameter whose expression is `.*` | `/:path{.*}` |
| A capturing group inside a parameter expression, other than one wrapping the whole expression | `/:id{a(b|c)}` |

Sources: [src/router/reg-exp-router/node.ts:57-130](repo://src/router/reg-exp-router/node.ts#L57-L130), [src/router/reg-exp-router/router.ts:60-65](repo://src/router/reg-exp-router/router.ts#L60-L65)

A parameter expression written as a single group, such as `(a|b)`, is rewritten to the non-capturing `(?:a|b)` so it does not shift capture numbers.

Sources: [src/router/reg-exp-router/node.ts:83-92](repo://src/router/reg-exp-router/node.ts#L83-L92)

The error surfaces on the first `match`, when compilation runs, not on `add`. Inside a `SmartRouter` that is the signal to fall back to [[TrieRouter]]; with `RegExpRouter` set directly as the `router` option, the first request fails.

Sources: [src/router/reg-exp-router/matcher.ts:10-14](repo://src/router/reg-exp-router/matcher.ts#L10-L14), [src/router/smart-router/router.ts:32-45](repo://src/router/smart-router/router.ts#L32-L45)

## PreparedRegExpRouter

`PreparedRegExpRouter` moves compilation to build time. `buildInitParams({ paths })` registers every path under `ALL` on a `RegExpRouter` subclass that exposes `buildAllMatchers`, compiles it, and records for each path a relocate map entry: which handler-list indexes and static paths the path's handler went into, and its parameter index map. It then empties the handler lists, leaving only the expression and slots.

Sources: [src/router/reg-exp-router/prepared-router.ts:95-154](repo://src/router/reg-exp-router/prepared-router.ts#L95-L154)

`serializeInitParams` writes the matchers and relocate map as JavaScript source, embedding each `RegExp` through its `toString()` so the result can be evaluated. At run time `new PreparedRegExpRouter(matchers, relocateMap)` receives them, and `add` places each handler into the recorded slots instead of rebuilding anything; `*` handlers are appended to every slot. A path absent from the prepared list throws `Path ... is not registered`.

Sources: [src/router/reg-exp-router/prepared-router.ts:156-165](repo://src/router/reg-exp-router/prepared-router.ts#L156-L165), [src/router/reg-exp-router/prepared-router.ts:9-93](repo://src/router/reg-exp-router/prepared-router.ts#L9-L93)

`PreparedRegExpRouter` shares the same `match` function; its `buildAllMatchers` just returns the matchers it was given. All three exports come from `hono/router/reg-exp-router`.

Sources: [src/router/reg-exp-router/prepared-router.ts:88-92](repo://src/router/reg-exp-router/prepared-router.ts#L88-L92), [src/router/reg-exp-router/index.ts:1-7](repo://src/router/reg-exp-router/index.ts#L1-L7)
