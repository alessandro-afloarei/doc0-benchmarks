---
title: "Route Path Patterns"
---
## Overview

A route path is a string such as `/users/:id{[0-9]+}/files/*`. It names fixed segments, parameters, regular-expression parameters, optional segments and a wildcard. Each router parses that string on its own, but they all start from the same helpers in `src/utils/url.ts`, which split the path into segments and classify each one. This page covers those helpers, the optional-segment expansion, and the forms that a given router refuses. The matching that uses the parsed segments is on [[Trie Router]] and [[RegExp Router]].

Sources: [src/utils/url.ts:8-21](repo://src/utils/url.ts#L8-L21)

## Splitting a path

`splitPath` splits on `/` and drops the empty first element that a leading slash leaves behind. `splitRoutingPath` does the same for a route path, but first hides every `{...}` group, so that a regular expression containing a `/` is not split. The groups are put back into the segment that held their marker.

Sources: [src/utils/url.ts:8-14](repo://src/utils/url.ts#L8-L14), [src/utils/url.ts:16-21](repo://src/utils/url.ts#L16-L21), [src/utils/url.ts:23-48](repo://src/utils/url.ts#L23-L48)

## Parameters

`getPattern(label, next)` classifies one segment. The label `*` gives the wildcard pattern. A label of the form `:name{regex}` gives a named pattern whose matcher is the regular expression. When the next segment is static, the matcher adds a lookahead for it, so `:id{[0-9]+}` followed by `/edit` only matches a digit run before `/edit`. A plain `:name` gives a pattern whose matcher is `true`, which means it takes the whole segment.

Sources: [src/utils/url.ts:50-78](repo://src/utils/url.ts#L50-L78)

The trie router uses the same classification. Its `insert` walks the segments of `splitRoutingPath`, and for each one asks `getPattern`. A segment that has a pattern is stored under the pattern's key, and the key is how the search later finds the child.

Sources: [src/router/trie-router/node.ts:44-74](repo://src/router/trie-router/node.ts#L44-L74)

## Wildcards

A path ending in `/*` matches the path without the `*` as well as the paths below it. The RegExp router turns the wildcard into `(?:|/.*)`, so `/hello/*` matches `/hello`, `/hello/` and `/hello/a/b`. A path that is only `*` becomes an empty expression that matches everything.

Sources: [src/router/reg-exp-router/router.ts:19-28](repo://src/router/reg-exp-router/router.ts#L19-L28), [src/router/reg-exp-router/node.ts:69-78](repo://src/router/reg-exp-router/node.ts#L69-L78)

The trie router treats `*` as a segment with its own child. When the request has more segments than the route, the search still reaches that child, so `/hello/*/foo` matches `/hello/bar/foo`. The code has a special case so that `/hello/*` also matches `/hello` when it is the last segment.

Sources: [src/router/trie-router/node.ts:136-165](repo://src/router/trie-router/node.ts#L136-L165)

## Optional segments

A path whose last segment ends in `?` is expanded into the paths with and without that segment. `checkOptionalParameter` returns null for a path that does not end with `?` or has no `:`, and otherwise returns each prefix as a route. The comment gives the example `/api/animals/:type?`, which becomes `/api/animals` and `/api/animals/:type`. An optional first segment gives `/` as its prefix.

Sources: [src/utils/url.ts:171-180](repo://src/utils/url.ts#L171-L180), [src/utils/url.ts:182-206](repo://src/utils/url.ts#L182-L206)

The trie and RegExp routers call `checkOptionalParameter` before they insert, so each expanded path is a separate route. The linear router does the same in its `add`.

Sources: [src/router/trie-router/router.ts:13-22](repo://src/router/trie-router/router.ts#L13-L22), [src/router/reg-exp-router/router.ts:189-190](repo://src/router/reg-exp-router/router.ts#L189-L190), [src/router/linear-router/router.ts:15-23](repo://src/router/linear-router/router.ts#L15-L23)

## Forms a router refuses

The pattern router rewrites each segment into a regular expression, with `:name{regex}` as a named group, `*` as `[^/]+` and other characters escaped. A trailing `?` is removed before this, and the expression that results is compiled once. If the compile fails, the router throws `UnsupportedPathError`.

Sources: [src/router/pattern-router/router.ts:12-42](repo://src/router/pattern-router/router.ts#L12-L42)

The RegExp router refuses a parameter whose expression is `.*`, and a parameter expression with a capturing group that is not written as `(?:...)`. It also refuses routes that disagree at one position: two different parameters at the same place, such as `/a/:x` and `/a/:y`, a parameter next to a static segment, such as `/a/:x` and `/a/b`, or two routes that end at the same point. Each refusal raises the path error, which the router reports as `UnsupportedPathError`, and [[Router Interface and SmartRouter]] describes how the smart router moves on.

Sources: [src/router/reg-exp-router/node.ts:57-60](repo://src/router/reg-exp-router/node.ts#L57-L60), [src/router/reg-exp-router/node.ts:83-102](repo://src/router/reg-exp-router/node.ts#L83-L102), [src/router/reg-exp-router/node.ts:116-124](repo://src/router/reg-exp-router/node.ts#L116-L124), [src/router/reg-exp-router/router.ts:61-65](repo://src/router/reg-exp-router/router.ts#L61-L65)
