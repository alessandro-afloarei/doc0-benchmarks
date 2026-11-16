---
title: "Request and Context"
---
## Overview

A Context holds the state of one dispatched request: its raw request, match result, environment, execution context, variables, and response. It creates the HonoRequest wrapper lazily when `c.req` is first accessed. [[Routing and Middleware Execution]] explains who creates this context and how the current route index changes; this page follows the data handlers read and the responses they construct.

Sources: [src/context.ts:293-368](repo://src/context.ts#L293-L368), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

## Read request metadata

`c.req.raw` exposes the original Request, while `path` holds the dispatcher's extracted path. The `url` and `method` getters delegate to the raw request. Route parameters use the current matched entry's parameter map, resolving into the router's shared stash when present and decoding percent-encoded values. A named lookup may return undefined; the all-parameters lookup omits absent values.

Sources: [src/request.ts:51-79](repo://src/request.ts#L51-L79), [src/request.ts:94-128](repo://src/request.ts#L94-L128), [src/request.ts:369-386](repo://src/request.ts#L369-L386)

| Accessor | Returned view |
| --- | --- |
| `param(name)` / `param()` | Decoded path parameters for the current matched route |
| `query(name)` / `query()` | Single-value query parameter view |
| `queries(name)` / `queries()` | Arrays of query parameter values |
| `header(name)` / `header()` | One raw-request header or a record of headers |
| `valid(target)` | Previously stored validation output |

Sources: [src/request.ts:94-128](repo://src/request.ts#L94-L128), [src/request.ts:148-198](repo://src/request.ts#L148-L198), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

The route helper's `matchedRoutes(c)` exposes the route records attached to the match result. `routePath` and `baseRoutePath` use either an explicit index or `c.req.routeIndex`, returning an empty string when that entry is absent. An explicit negative index uses array-at semantics. These helpers describe registered patterns and prefixes rather than replacing the concrete request pathname.

Sources: [src/helper/route/index.ts:32-59](repo://src/helper/route/index.ts#L32-L59), [src/helper/route/index.ts:82-83](repo://src/helper/route/index.ts#L82-L83)

## Consume the body

HonoRequest caches body reads. If the requested representation is already cached, it returns that entry. Otherwise, when another representation exists, it builds a Response around the cached body and uses the requested reader on that response. With no cache it invokes the raw Request reader and stores its result. Reading `c.req.raw` directly bypasses this wrapper's cache, so middleware sharing parsed input should use the wrapper consistently.

Sources: [src/request.ts:220-239](repo://src/request.ts#L220-L239)

`json` obtains cached text and calls `JSON.parse`; `text`, `arrayBuffer`, `blob`, and `formData` select their corresponding cached representation. `bytes` converts the cached ArrayBuffer to a Uint8Array. The JSON generic describes the expected TypeScript value and does not install schema validation. [[Validation and Typed Clients]] explains the separate callback that validates parsed data and records its output.

Sources: [src/request.ts:253-286](repo://src/request.ts#L253-L286), [src/request.ts:301-330](repo://src/request.ts#L301-L330), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

`parseBody` handles multipart and URL-encoded form media types; other types produce an empty object. The form parser reads an ArrayBuffer, reconstructs FormData using the content type, and caches that FormData for later wrapper reads. Ordinary duplicate keys overwrite earlier values unless `all` is enabled or the key ends in `[]`. With `dot` enabled, dotted keys are expanded into nested values.

Sources: [src/request.ts:212-218](repo://src/request.ts#L212-L218), [src/utils/body.ts:97-178](repo://src/utils/body.ts#L97-L178)

## Share state and host capabilities

`c.env` is supplied through Context options. `c.executionCtx` throws when no execution context exists, and `c.event` additionally requires an object exposing `respondWith`. These accessors do not synthesize host capabilities for an in-process request. Supply them through the application's request/fetch arguments when the handler requires them; [[Runtime Adapters]] describes the values populated by host wrappers.

Sources: [src/context.ts:352-395](repo://src/context.ts#L352-L395), [src/hono-base.ts:479-517](repo://src/hono-base.ts#L479-L517)

`c.set` lazily creates a Map and stores a request-scoped value. `c.get` reads from it and returns undefined when the map or key is absent. `c.var` presents an object created from the map, with a readonly TypeScript view; it is not the map itself. Bindings and variables are separate channels: bindings arrive from the caller, while variables are populated by handlers and middleware.

Sources: [src/context.ts:352-359](repo://src/context.ts#L352-L359), [src/context.ts:546-602](repo://src/context.ts#L546-L602)

## Construct and finalize responses

`c.header` sets, appends, or deletes a header depending on its value and options. Before a response exists, headers are prepared for later construction. After finalization, changing a header first reconstructs the stored response so its headers can be changed. `c.status` records the status used by subsequent response construction rather than immediately returning a response.

Sources: [src/context.ts:515-531](repo://src/context.ts#L515-L531)

`newResponse` merges existing or prepared headers with response-init headers and explicit header records. Set-Cookie values are appended when processing response-init headers, while an array in the explicit record replaces that header with multiple appended values. An explicit numeric status takes precedence; otherwise the response init's status wins over the context's prepared status.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641)

`text` has a direct Response shortcut for an unconfigured context. `json` serializes its value and supplies the JSON content type. `html` sets an HTML content type and resolves escaped-string callbacks for object-valued input. `redirect` writes Location and defaults to status 302. Layout-based rendering is layered on this response interface in [[Server JSX and HTML Rendering]].

Sources: [src/context.ts:682-733](repo://src/context.ts#L682-L733), [src/context.ts:750-761](repo://src/context.ts#L750-L761), [src/middleware/jsx-renderer/index.ts:116-128](repo://src/middleware/jsx-renderer/index.ts#L116-L128)

Assigning `c.res` marks the context finalized. When replacing an existing response, the setter copies its headers except Content-Type, handling Set-Cookie separately with `getSetCookie`. Merely reading `c.res` can create a placeholder response but does not execute the setter. That difference matters for middleware which prepares headers before the eventual handler returns its real response.

Sources: [src/context.ts:403-434](repo://src/context.ts#L403-L434)

## Cookies and accepted representations

The cookie helpers read the Cookie header and support secure/host name prefixes. Signed-cookie reads return a promise whose named result can be a string, undefined, or false. Setters append Set-Cookie headers; host-prefixed generation forces a secure cookie at path `/` with no domain. Deletion writes an empty cookie with maxAge zero and returns the previous value.

Sources: [src/helper/cookie/index.ts:16-75](repo://src/helper/cookie/index.ts#L16-L75), [src/helper/cookie/index.ts:78-102](repo://src/helper/cookie/index.ts#L78-L102), [src/helper/cookie/index.ts:130-145](repo://src/helper/cookie/index.ts#L130-L145)

The `accepts` helper takes a header name, supported values, a default, and an optional matcher. With no header it returns the default. Its built-in matcher sorts parsed entries by descending quality and selects the first exact supported type; a custom matcher can provide different selection logic. This is request negotiation, independent of the response method chosen afterward.

Sources: [src/helper/accepts/accepts.ts:11-48](repo://src/helper/accepts/accepts.ts#L11-L48)

