---
title: "RegExpRouter and TrieRouter Internals"
---
## Overview

The default app uses `SmartRouter` over `RegExpRouter` and `TrieRouter` (see [[Routers and Router Selection]]). `RegExpRouter` turns all routes of a method into one regular expression and answers a request with a single `String.match`. `TrieRouter` stores routes in a tree and walks it segment by segment. The first is faster but rejects some route sets by throwing `UnsupportedPathError`; the second accepts all of them, which is why it sits behind the first.

Sources: [src/hono.ts:26-33](repo://src/hono.ts#L26-L33), [src/router/reg-exp-router/router.ts:61-65](repo://src/router/reg-exp-router/router.ts#L61-L65)

## RegExpRouter: collecting routes

`RegExpRouter.add` does not build any pattern. It sorts each route into one of two tables, `#middleware` and `#routes`, each shaped `method -> path -> [handler, paramCount][]`.

Sources: [src/router/reg-exp-router/router.ts:122-134](repo://src/router/reg-exp-router/router.ts#L122-L134)

1. The first time a method is seen, its tables start as copies of the `ALL` tables, so routes registered for `ALL` before it still apply.
2. `/*` is normalised to `*`, and `paramCount` counts `/:` occurrences.
3. A path ending in `*` is a wildcard. Its handler is appended to every existing path of the matching methods that the wildcard pattern matches, in both tables. A new wildcard path first inherits the handlers of the closest enclosing wildcard (found by `findMiddleware`, longest key first), so the ordering "earlier middleware, then this one" is preserved.
4. Any other path is split by `checkOptionalParameter` (an optional `:id?` yields two paths). Each path starts from the middleware that already matches it, then the handler is appended.

Sources: [src/router/reg-exp-router/router.ts:135-204](repo://src/router/reg-exp-router/router.ts#L135-L204), [src/router/reg-exp-router/router.ts:105-120](repo://src/router/reg-exp-router/router.ts#L105-L120)

Because each path already holds every middleware that applies to it, a matched path yields its complete, ordered handler list from one lookup. Registration order is therefore baked in at build time, not at request time.

Sources: [src/router/reg-exp-router/router.ts:188-204](repo://src/router/reg-exp-router/router.ts#L188-L204)

## RegExpRouter: building the matcher

### Lazy build and per-method matchers

`match` is defined in `matcher.ts`. On its first call it runs `buildAllMatchers`, then replaces itself (`this.match = match`) with a closure over the built matchers. `buildAllMatchers` builds one `Matcher` per known method and afterwards sets `#middleware` and `#routes` to `undefined` and clears the wildcard cache, so a later `add` throws `Can not add a route since the matcher is already built.`

Sources: [src/router/reg-exp-router/matcher.ts:11-33](repo://src/router/reg-exp-router/matcher.ts#L11-L33), [src/router/reg-exp-router/router.ts:208-222](repo://src/router/reg-exp-router/router.ts#L208-L222)

`#buildMatcher(method)` collects the method's own paths, or, when a method has none in a table, falls back to the `ALL` ones. A method with no routes of its own gets `null`, and `match` then uses the `ALL` matcher.

Sources: [src/router/reg-exp-router/router.ts:224-252](repo://src/router/reg-exp-router/router.ts#L224-L252), [src/router/reg-exp-router/matcher.ts:14-18](repo://src/router/reg-exp-router/matcher.ts#L14-L18)

`buildMatcherFromPreprocessedRoutes` then does the compilation:

Sources: [src/router/reg-exp-router/router.ts:34-40](repo://src/router/reg-exp-router/router.ts#L34-L40)

1. Each route is flagged static when its path contains neither `*` nor `/:`. Dynamic routes sort first by path length and static ones last.
2. Static routes go into a `staticMap` keyed by exact path, with an empty parameter map. They are still inserted into the trie in a "check only" mode so conflicts are detected.
3. Dynamic routes are inserted into a `Trie` with a handler index. `Trie.insert` swaps `{...}` groups for markers, tokenises the path into labels (`:name`), a trailing `/*` and single characters, and returns the list of `[name, variableIndex]` pairs.
4. `trie.buildRegExp()` returns the regular expression plus two replacement maps, which are used to remap handler indexes and parameter indexes to real capture-group numbers.

Sources: [src/router/reg-exp-router/router.ts:34-103](repo://src/router/reg-exp-router/router.ts#L34-L103), [src/router/reg-exp-router/trie.ts:6-74](repo://src/router/reg-exp-router/trie.ts#L6-L74)

### How the trie becomes a regular expression

Each `Node` keeps children by token. `buildRegExpStr` sorts child keys with `compareKey`, emits each child's own text followed by its sub-expression, joins alternatives as `(?:a|b)`, and puts `#<index>` first for a node that ends a route. Sorting is: literal characters, then special patterns such as `:id{[0-9]+}`, then a plain `:label` (`[^/]+`), then wildcards.

Sources: [src/router/reg-exp-router/node.ts:135-162](repo://src/router/reg-exp-router/node.ts#L135-L162), [src/router/reg-exp-router/node.ts:13-43](repo://src/router/reg-exp-router/node.ts#L13-L43)

```ts
/**
 * Sort order:
 * 1. literal
 * 2. special pattern (e.g. :label{[0-9]+})
 * 3. common label pattern (e.g. :label)
 * 4. wildcard
 */
```

Sources: [src/router/reg-exp-router/node.ts:13-43](repo://src/router/reg-exp-router/node.ts#L13-L43), [src/router/reg-exp-router/node.ts:135-162](repo://src/router/reg-exp-router/node.ts#L135-L162)

`buildRegExp` replaces each `#n` marker with an empty capture group `$()` and records which capture-group number it ended up at; parameter markers `@n` become a recorded capture number. At match time the index of the empty group that matched identifies the route.

Sources: [src/router/reg-exp-router/trie.ts:49-73](repo://src/router/reg-exp-router/trie.ts#L49-L73), [src/router/reg-exp-router/matcher.ts:26-30](repo://src/router/reg-exp-router/matcher.ts#L26-L30)

### Which routes are rejected

`Node.insert` throws `PATH_ERROR` (turned into `UnsupportedPathError` by the router) in these cases: the same route position is inserted twice; a pattern is `.*`; a custom pattern has a capture group that is not `(?:`; a pattern is added to a node that already has a non-wildcard child; or a literal is added to a node that has a pattern child. These are the combinations a single expression could not order, and they make `SmartRouter` move on to the next router.

Sources: [src/router/reg-exp-router/node.ts:58-133](repo://src/router/reg-exp-router/node.ts#L58-L133), [src/router/reg-exp-router/router.ts:61-65](repo://src/router/reg-exp-router/router.ts#L61-L65)

## RegExpRouter: matching

### The match closure

The closure built in `matcher.ts` picks `matchers[method] || matchers.ALL`, returns the `staticMap` entry on an exact path hit, and otherwise runs `path.match(regexp)`. A miss returns `[[], emptyParam]`. On a hit, `match.indexOf('', 1)` finds the first empty capture group, which is the route's marker, and `matcher[1][index]` supplies the handlers with their parameter index maps; the match array itself is the parameter stash.

Sources: [src/router/reg-exp-router/matcher.ts:11-33](repo://src/router/reg-exp-router/matcher.ts#L11-L33)

### PreparedRegExpRouter

`PreparedRegExpRouter` skips the build at run time: it receives matchers that were built earlier. `buildInitParams` runs a `RegExpRouter` over a list of paths, strips the handlers out of the matchers and returns a "relocate map" saying which slots each path owns. `serializeInitParams` writes the result as JavaScript text, embedding regular expressions through `toString()`. At run time `add` puts each handler into the slots the relocate map names, and throws `Path ... is not registered` for a path that was not in the list.

Sources: [src/router/reg-exp-router/prepared-router.ts:9-17](repo://src/router/reg-exp-router/prepared-router.ts#L9-L17), [src/router/reg-exp-router/prepared-router.ts:47-137](repo://src/router/reg-exp-router/prepared-router.ts#L47-L137), [src/router/reg-exp-router/prepared-router.ts:139-165](repo://src/router/reg-exp-router/prepared-router.ts#L139-L165)

## TrieRouter: building the tree

`TrieRouter.add` expands optional parameters, then calls `Node.insert(method, path, handler)`. `insert` splits the path into segments (with `{...}` regexes kept intact), and for each segment calls `getPattern(label, next)`. A `*` is a wildcard, `:name` is a "true" pattern accepting any segment and `:name{regex}` a regex pattern; a regex followed by a literal segment gets a lookahead so it can span several segments. Children are keyed by the pattern key and every pattern is also pushed onto the parent's `#patterns` list.

Sources: [src/router/trie-router/router.ts:5-28](repo://src/router/trie-router/router.ts#L5-L28), [src/router/trie-router/node.ts:44-84](repo://src/router/trie-router/node.ts#L44-L84), [src/utils/url.ts:51-78](repo://src/utils/url.ts#L51-L78)

At the final node a handler set is pushed with the list of parameter names on the way (`possibleKeys`) and a `score` equal to a counter incremented on every insert, i.e. registration order.

Sources: [src/router/trie-router/node.ts:44-85](repo://src/router/trie-router/node.ts#L44-L85)

## TrieRouter: searching

`search` splits the request path and keeps a set of "current nodes", starting at the root. For each segment, for each current node:

Sources: [src/router/trie-router/node.ts:114-135](repo://src/router/trie-router/node.ts#L114-L135)

1. A literal child equal to the segment is followed. On the last segment its own handlers, and those of a `*` child (so `/hello/*` matches `/hello`), are collected.
2. For each pattern of the node: `*` descends into the wildcard child; a regex pattern runs against the rest of the path from this segment, so one parameter can cover several segments; a plain label or a regex that matches the segment stores the parameter and descends.
3. Parameters are carried along each branch in `#params`, and copied when a branch forks, so sibling branches do not share them.

Sources: [src/router/trie-router/node.ts:114-232](repo://src/router/trie-router/node.ts#L114-L232)

At the end, collected handler sets are sorted by `score` when there is more than one, restoring registration order across branches, and the result is returned in the `[[handler, params][]]` format.

Sources: [src/router/trie-router/node.ts:236-245](repo://src/router/trie-router/node.ts#L236-L245)

Unlike `RegExpRouter`, the trie never throws for a pattern, and it accepts routes added at any time.

Sources: [src/router/trie-router/node.ts:44-85](repo://src/router/trie-router/node.ts#L44-L85)
