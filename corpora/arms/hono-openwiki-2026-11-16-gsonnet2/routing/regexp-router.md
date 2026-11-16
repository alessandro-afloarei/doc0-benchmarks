---
type: architecture
title: RegExpRouter and PreparedRegExpRouter
description: How RegExpRouter collects routes and middleware, compiles one regular expression per HTTP method with a static-path fast path, rejects ambiguous patterns via UnsupportedPathError, and how PreparedRegExpRouter replays a pre-built matcher.
tags: [router, regexp-router, performance, matcher, prepared-router]
verified:
  - by: openwiki/0.9.0
    at: 2026-11-16T17:43:46.600Z
sources:
  - id: openwiki-source-0bf513eef7e628cf93e0998a
    resource: repo://src/router/reg-exp-router/matcher.ts
  - id: openwiki-source-5c610df654eb4e3e940cc992
    resource: repo://src/router/reg-exp-router/node.ts
  - id: openwiki-source-72a70287fb9670bc0929a9f1
    resource: repo://src/router/reg-exp-router/prepared-router.ts
  - id: openwiki-source-6963434523d24c18fc4c46f3
    resource: repo://src/router/reg-exp-router/router.ts
  - id: openwiki-source-605d30553e8eb34f1f62fdc6
    resource: repo://src/router/reg-exp-router/trie.ts
generated: { by: "claude-code", at: "2026-11-16T17:43:46.600Z" }
---

# RegExpRouter and PreparedRegExpRouter

`RegExpRouter` (`src/router/reg-exp-router/`) is Hono's fastest router for the default preset: all routes for one method are merged into **one regular expression**, so matching is a single `RegExp.exec` plus an index lookup, independent of the number of routes. The price is a build step and some patterns it cannot represent, in which case it signals `UnsupportedPathError` so [SmartRouter](router-contract-and-smart-router.md) can fall back to the [TrieRouter](trie-linear-pattern-routers.md).

## Phase 1: collecting routes (`router.ts#add`)

`add(method, path, handler)` stores handlers in two dictionaries keyed by method then path: `#routes` (concrete routes) and `#middleware` (wildcard routes such as `/api/*` or `*`). Each stored element is `[handler, paramCount]`. The special method `ALL` is the shared baseline:

- The first time a new method is seen, its tables are **seeded with copies of everything registered under `ALL`**, so `app.use('*', mw)` registered earlier still applies to `GET`-only routes added later.
- A path ending in `*` is a middleware: its handler is pushed onto every existing middleware *and route* entry (for the relevant methods) whose path matches the wildcard (tested with `buildWildcardRegExp`), and a new wildcard entry is initialised from the best-matching existing middleware list (`findMiddleware`, longest key first) so ordering is preserved.
- A concrete route path starts from the handlers of any matching middleware (so middleware run first, in registration order), then appends its own handler. Optional parameters (`/:id?`) are expanded by `checkOptionalParameter` into multiple concrete paths, each with an adjusted param count.

The consequence is that, by build time, **each distinct path already holds its full ordered handler list** (middleware plus route handlers). Matching never has to merge lists.

## Phase 2: building matchers (lazily, once)

`match` is initially the shared `match` function from `matcher.ts`. On first call it invokes `buildAllMatchers()`, builds one matcher per method (and for `ALL`), **releases** `#middleware`/`#routes` (set to `undefined`, wildcard regexp cache cleared) and replaces `this.match` with the closure over the built matchers. Any later `add` throws `MESSAGE_MATCHER_IS_ALREADY_BUILT`.

`#buildMatcher(method)` assembles the route list from that method's own entries (or the `ALL` entries if the method has none), returning `null` when a method has no routes of its own; at match time `matchers[method] || matchers[ALL]` is used.

`buildMatcherFromPreprocessedRoutes` then:

1. Flags each path as **static** (no `*` and no `/:`). Static paths are put into `staticMap[path]`, a ready `Result` (`[[handler, {}...], emptyParam]`) enabling an O(1) hash lookup before any regexp runs. They are still inserted into the trie in "path-error-check only" mode so conflicts are detected.
2. Sorts so dynamic routes come first (in ascending path length) followed by static ones, then inserts every path into a `Trie`; only dynamic paths receive a handler slot index.
3. Converts the per-handler `paramCount` into a `paramIndexMap` (`{ paramName: captureGroupIndex }`).
4. Calls `trie.buildRegExp()` which returns the final regexp and two replacement maps; handler maps are re-indexed by capture position so that `match.indexOf('', 1)` (the first empty capture, i.e. the marker for the matched route) selects the right `HandlerData`.

### The trie → regexp compiler (`trie.ts`, `node.ts`)

`Trie.insert` tokenises a path (keeping `{regex}` constraints intact), and `Node.insert` walks tokens building a tree where children are literal characters, label patterns (`[^/]+`), custom param regexps (`:id{[0-9]+}`), or wildcards (`.*` for a trailing `*`, `(?:|/.*)` for `/*`, `[^/]+` for a middle `*`). `buildRegExpStr` emits an alternation of children sorted by `compareKey` (single characters first, wildcards last, labels after literals, longer keys before shorter), writing capture markers `#<handlerIndex>` and `@<paramIndex>`. `buildRegExp` replaces handler markers with empty capture groups (`$()`) and records `indexReplacementMap` (capture position → handler slot); param markers are removed while `paramReplacementMap` records which capture group holds each parameter's value.

### When a path is unsupported

`Node.insert` throws the module-private `PATH_ERROR` symbol, translated in `router.ts` to `UnsupportedPathError(path)`, when the tree would be ambiguous, such as:

- two different routes ending at the same node (`#index` already set);
- a new parameter/label child added at a position where other non-wildcard children already exist, or a new literal added where a pattern child already exists (the order-dependent shapes that a single alternation cannot disambiguate; routes that differ only by earlier shared prefixes are fine);
- a param regexp of `.*` or with a capturing group that is not `(?:...)`-style.

`SmartRouter` catches this on first match and retries with the next router. Applications therefore get RegExpRouter speed when their routes are compatible, and automatic degradation otherwise.

## Matching (`matcher.ts#match`)

```
matcher = matchers[method] || matchers.ALL
static  = matcher.staticMap[path]  -> return directly
m       = path.match(matcher.regexp)
if !m   -> [[], emptyParam]
index   = m.indexOf('', 1)         // which marker group matched
return [matcher.handlerMap[index], m]
```

Returning the raw `RegExpMatchArray` as the "param stash" means param values are read lazily by `HonoRequest.param()` using each handler's `paramIndexMap` ([Context and HonoRequest](../architecture/context-and-request.md)); no per-request params object is built.

## PreparedRegExpRouter

For environments where building the matcher at startup is too costly (cold starts), the matchers can be built ahead of time:

- `buildInitParams({ paths })` runs a real `RegExpRouter` over the known route paths (as `ALL`), exports the built matchers via a subclass exposing `buildAllMatchers`, and computes a **relocate map** from each path to the matcher slot indexes (or static-map keys) and param maps where its handlers belong. It then blanks the handler lists, leaving only the regexps and structure.
- `serializeInitParams` serialises the result as a JavaScript literal (regexps embedded through their `toString()` and un-escaped), suitable for pasting into generated code.
- At runtime `new PreparedRegExpRouter(matchers, relocateMap)` receives that data; `add(method, path, handler)` looks up the relocate map and pushes the handler into the right slots (copying the `ALL` matcher for new methods; wildcard routes `*`/`/*` are appended to every slot). Registering a path that was not in `paths` throws `Path <p> is not registered`. `buildAllMatchers()` simply returns the prebuilt matchers, so `match` skips the build step.

Tests live in `src/router/reg-exp-router/*.test.ts` and run the shared conformance suite ([Testing](../operations/testing.md)).
