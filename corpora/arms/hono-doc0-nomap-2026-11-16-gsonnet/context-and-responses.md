---
title: "Context and Responses"
---
## Overview

Every handler and middleware receives a `Context` (`src/context.ts`). It holds the incoming request, the environment bindings, per-request variables and the response being built. It is created once per request in `#dispatch` (see [[Application and Request Dispatch]]) and discarded afterwards.

Sources: [src/context.ts:293-361](repo://src/context.ts#L293-L361), [src/hono-base.ts:421-427](repo://src/hono-base.ts#L421-L427)

## Request and runtime access

`c.req` is created on first access as a `HonoRequest` from the raw request, the path and the match result (see [[Request Parsing and Validation]]). `c.env` holds the bindings passed to `fetch`. `c.executionCtx` returns the execution context or throws `This context has no ExecutionContext`; `c.event` returns it only if it has `respondWith` (a service-worker `FetchEvent`) and otherwise throws `This context has no FetchEvent`.

Sources: [src/context.ts:352-401](repo://src/context.ts#L352-L401)

## Variables

`c.set(key, value)` and `c.get(key)` use a lazily created `Map`. `c.var` returns a read-only object built with `Object.fromEntries` of that map, or an empty object if nothing was set. Keys are typed from the app's `Variables` or from the global `ContextVariableMap` interface, which applications can extend. See [[Type System and Typed Routes]].

Sources: [src/context.ts:546-603](repo://src/context.ts#L546-L603), [src/context.ts:57](repo://src/context.ts#L57-L57)

## Building a response

All response helpers go through the private `#newResponse(data, arg, headers)`:

Sources: [src/context.ts:604-606](repo://src/context.ts#L604-L606)

1. Start from the headers of the existing `#res` (copied), else from the prepared headers set by `c.header`, else a new `Headers`.
2. If `arg` is an object with `headers`, copy them in; `set-cookie` values are appended and others replace.
3. Apply the `headers` record: string values replace; array values delete the key and append each item.
4. The status is `arg` when it is a number, else `arg.status`, else the status set by `c.status`.
5. Return `new Response(data, { status, headers })`.

Sources: [src/context.ts:604-640](repo://src/context.ts#L604-L640)

| Method | Body | Default `Content-Type` |
| --- | --- | --- |
| `c.newResponse(data, status or init, headers)` | as given | none |
| `c.body(data, ...)` | `Data` or `null` | none |
| `c.text(text, ...)` | string | `text/plain; charset=UTF-8` |
| `c.json(object, ...)` | `JSON.stringify(object)` | `application/json` |
| `c.html(html, ...)` | string, or a promise resolved first | `text/html; charset=UTF-8` |
| `c.redirect(location, status)` | `null` | sets `Location`, status 302 by default |
| `c.notFound()` | from the not-found handler | per handler |

Sources: [src/context.ts:641-700](repo://src/context.ts#L641-L700), [src/context.ts:708-776](repo://src/context.ts#L708-L776)

`setDefaultContentType` puts the default first and spreads the caller's headers after it, so an explicit `Content-Type` wins. `c.text` has a shortcut: with no prepared headers, no status, no extra arguments and a non-finalized context it returns `new Response(text)` directly.

Sources: [src/context.ts:279-285](repo://src/context.ts#L279-L285), [src/context.ts:682-695](repo://src/context.ts#L682-L695)

`c.html` accepts a string or a promise. When given an object (an escaped-string promise from JSX), it calls `resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {})` and builds the response from the result, so late-resolved parts are included. See [[JSX Server Rendering]].

Sources: [src/context.ts:723-735](repo://src/context.ts#L723-L735), [src/utils/html.ts:142-182](repo://src/utils/html.ts#L142-L182)

`c.redirect` sets `Location`, percent-encoding the URL with `encodeURI` when it holds characters above `\xFF`, and returns a null-body response with status 302 unless another redirect status is given.

Sources: [src/context.ts:750-765](repo://src/context.ts#L750-L765)

`c.notFound()` calls the not-found handler stored from the app; if none was given to the `Context`, it falls back to an empty `Response`.

Sources: [src/context.ts:776-779](repo://src/context.ts#L776-L779)

## Headers and status before a response exists

`c.header(name, value, { append })` sets a header; a `undefined` value deletes it. If a response is already set it creates a fresh copy first so the existing one is not mutated. With no response yet, the header goes into `#preparedHeaders`, which later responses pick up. `c.status(code)` stores a status for the next `#newResponse`.

Sources: [src/context.ts:515-531](repo://src/context.ts#L515-L531)

## The `res` property

`c.res` getter lazily creates an empty `Response` using the prepared headers. The setter is what lets middleware change a response that a later handler produced: when a response already exists and a new one is assigned, the new one is rebuilt, and all old headers are copied over it except `content-type`; `set-cookie` values are re-added individually so none are lost. The setter then marks `finalized = true`.

Sources: [src/context.ts:403-437](repo://src/context.ts#L403-L437)

`finalized` and `error` are public. `compose` and `#dispatch` read `finalized` to decide whether a handler produced a response, and write `error` before calling the error handler.

Sources: [src/context.ts:315-337](repo://src/context.ts#L315-L337), [src/compose.ts:53-69](repo://src/compose.ts#L53-L69)

## Renderer and layout

`c.render(...)` calls the renderer, which defaults to `c.html`. `c.setRenderer(fn)` replaces it, typically from a middleware, and `c.setLayout` / `c.getLayout` store a layout component for it. The `ContextRenderer` interface can be extended to type the renderer's arguments. `jsx-renderer` middleware uses these; see [[Response, Observability and Utility Middleware]].

Sources: [src/context.ts:448-500](repo://src/context.ts#L448-L500), [src/context.ts:62-78](repo://src/context.ts#L62-L78)
