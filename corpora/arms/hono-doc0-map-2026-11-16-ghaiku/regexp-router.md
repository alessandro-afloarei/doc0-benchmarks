---
title: "RegExp Router"
---
## Overview

`RegExpRouter` is the default router. It does its work in two stages: `add` records each route in per-method maps while the app is being set up, and the first `match` compiles those maps into one regular expression per method plus a map of static paths. After that, a request is answered by a map lookup or one regular-expression match. [[Router Selection]] explains when this router is picked, and [[Request Dispatch]] calls its `match` for every request.

Sources: [src/router/reg-exp-router/router.ts:122-140](repo://src/router/reg-exp-router/router.ts#L122-L140), [src/router/reg-exp-router/matcher.ts:10-32](repo://src/router/reg-exp-router/matcher.ts#L10-L32)

## Recording routes

`add` keeps two maps, `#middleware` and `#routes`, each keyed by method and then by path. The `ALL` entry holds the routes for every method. When a method first appears, its entries are copied from the `ALL` entry, so a route added with `app.use` before a method-specific route still applies to that method.

Sources: [src/router/reg-exp-router/router.ts:132-152](repo://src/router/reg-exp-router/router.ts#L132-L152)

A path ending in `*` is treated as middleware. It is pushed onto every existing path that its wildcard pattern matches, and a new entry for the path inherits the middleware of the nearest enclosing wildcard. A path without a wildcard is pushed onto its own entry with the middleware that matches it, and an optional segment such as `/:id?` is expanded into two paths first.

Sources: [src/router/reg-exp-router/router.ts:149-187](repo://src/router/reg-exp-router/router.ts#L149-L187), [src/router/reg-exp-router/router.ts:189-202](repo://src/router/reg-exp-router/router.ts#L189-L202), [src/router/reg-exp-router/router.ts:105-120](repo://src/router/reg-exp-router/router.ts#L105-L120)

Each stored handler carries a parameter count, computed from the number of `/:` labels in the path. The count is used later to build the parameter index map, so the handler can read its own parameters from the shared stash.

Sources: [src/router/reg-exp-router/router.ts:153-153](repo://src/router/reg-exp-router/router.ts#L153-L153), [src/router/reg-exp-router/router.ts:200-200](repo://src/router/reg-exp-router/router.ts#L200-L200)

## Building the matchers

The first `match` calls `buildAllMatchers`. It builds one matcher for every method that has its own routes, and for `ALL`. A method without its own routes reuses the `ALL` matcher, so a request for an unregistered method still reaches the `ALL` middleware. After building, the router drops its maps and clears the wildcard cache, which means `add` throws after the first match.

Sources: [src/router/reg-exp-router/router.ts:208-222](repo://src/router/reg-exp-router/router.ts#L208-L222), [src/router/reg-exp-router/router.ts:224-251](repo://src/router/reg-exp-router/router.ts#L224-L251)

`buildMatcherFromPreprocessedRoutes` sorts the routes so that static paths come last and the remaining routes are ordered by path length. A static path goes into the static map, keyed by the exact path. Any other path is inserted into a trie of path tokens, which produces the single regular expression and the replacement maps used to find the handler list.

Sources: [src/router/reg-exp-router/router.ts:34-60](repo://src/router/reg-exp-router/router.ts#L34-L60), [src/router/reg-exp-router/router.ts:62-66](repo://src/router/reg-exp-router/router.ts#L62-L66), [src/router/reg-exp-router/router.ts:82-86](repo://src/router/reg-exp-router/router.ts#L82-L86)

After the trie is built, each parameter index is rewritten to the position the regular expression uses for it, so a match can read values directly from the capture groups. The handler lists are then copied into an array indexed by the group that matched.

Sources: [src/router/reg-exp-router/router.ts:82-101](repo://src/router/reg-exp-router/router.ts#L82-L101)

## Matching a request

`match` looks up the method's matcher, or the `ALL` matcher when there is none. It checks the static map first, so a static path is answered without running the regular expression. Otherwise it runs the regular expression, and the index of the first empty capture group names the matched handler list.

Sources: [src/router/reg-exp-router/matcher.ts:10-30](repo://src/router/reg-exp-router/matcher.ts#L10-L30)

The returned result has the parameter stash as its second element, which is the shape that [[HonoRequest]] reads through `routeIndex`. When nothing matches, the result is an empty list, and dispatch answers with the not-found handler.

Sources: [src/router/reg-exp-router/matcher.ts:10-32](repo://src/router/reg-exp-router/matcher.ts#L10-L32)

The matcher replaces itself on the first call. `match` assigns the bound function to `this.match`, so later requests skip the setup code.

Sources: [src/router/reg-exp-router/matcher.ts:31-32](repo://src/router/reg-exp-router/matcher.ts#L31-L32)

## Pages

- [[Router Selection]] compares this router with the others.
- [[Registering Routes]] shows the calls that fill the maps.

Sources: [src/router/reg-exp-router/router.ts:132-140](repo://src/router/reg-exp-router/router.ts#L132-L140)
