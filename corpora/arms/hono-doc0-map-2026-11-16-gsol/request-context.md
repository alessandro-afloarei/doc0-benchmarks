---
title: "Request and Context"
---
## Overview

Each dispatch creates a `Context` with the raw request, selected path, router match result, bindings and execution context. Its `req` getter creates a `HonoRequest` only on first access. The pair provides request inspection, reusable body reads, per-request values and response construction. [[Routing]] explains where the match data comes from; this page follows its use inside a handler.

Sources: [src/hono-base.ts:418-427](repo://src/hono-base.ts#L418-L427), [src/context.ts:352-369](repo://src/context.ts#L352-L369), [src/request.ts:71-80](repo://src/request.ts#L71-L80)

## Request access and parameters

`c.req.raw` is the original Web Standard request. `url` and `method` delegate to it, while `path` is the pathname selected during dispatch. `param(name)` returns one path value; `param()` builds a record of all available values. The wrapper resolves either a direct parameter value or an index into the router's shared stash and decodes percent-encoded values. It uses `routeIndex` to choose the parameter mapping belonging to the active handler.

Sources: [src/request.ts:51-80](repo://src/request.ts#L51-L80), [src/request.ts:102-128](repo://src/request.ts#L102-L128), [src/request.ts:369-390](repo://src/request.ts#L369-L390)

`query(name)` reads a single query value and `query()` reads a string-valued record. `queries(name)` and `queries()` preserve repeated values as arrays. `header(name)` returns a header or `undefined`; without a name it enumerates the underlying `Headers` into a record. These are raw extraction APIs. [[Validation and Typed Clients]] describes how extracted values become checked, transformed handler input.

Sources: [src/request.ts:148-197](repo://src/request.ts#L148-L197)

Route metadata is available through `matchedRoutes`, `routePath`, `baseRoutePath` and `basePath` from the route helper. `routePath` and `baseRoutePath` accept an optional index, including negative indexing, and default to the current handler. `basePath` resolves parameterized prefixes against the actual request path and caches the result per context and index. The request object's older `matchedRoutes` and `routePath` properties are marked deprecated in favor of these helpers.

Sources: [src/helper/route/index.ts:32-34](repo://src/helper/route/index.ts#L32-L34), [src/helper/route/index.ts:58-83](repo://src/helper/route/index.ts#L58-L83), [src/helper/route/index.ts:106-140](repo://src/helper/route/index.ts#L106-L140), [src/request.ts:393-441](repo://src/request.ts#L393-L441)

## Body consumption and caching

The body methods share `bodyCache`. A cached representation is returned directly; if another representation was cached first, the wrapper converts it through a new `Response` rather than rereading the raw stream. Otherwise it saves the promise from the raw body's method. `json()` specifically reads cached text and runs `JSON.parse`; `bytes()` reads an array buffer and wraps it in `Uint8Array`. Text, array buffer, blob and form-data methods use the same cache entry mechanism.

Sources: [src/request.ts:220-255](repo://src/request.ts#L220-L255), [src/request.ts:269-330](repo://src/request.ts#L269-L330)

`parseBody` handles multipart and URL-encoded forms and returns an empty object for other media types. Ordinary repeated fields retain their last value; `all: true` or a field name ending in `[]` collects multiple values. `dot: true` converts dotted keys into nested objects. Form parsing reads an array buffer and caches the resulting form-data promise, allowing a later `c.req.formData()` to reuse the consumed body.

Sources: [src/utils/body.ts:97-140](repo://src/utils/body.ts#L97-L140), [src/utils/body.ts:151-178](repo://src/utils/body.ts#L151-L178)

`cloneRawRequest` uses the native clone while the raw body is unused. After consumption it reconstructs a request from the first cached representation and copies request properties including headers and signal. If raw body consumption bypassed the wrapper and left no cache, it throws an `HTTPException` with status 500 and a message explaining that the body cannot be reconstructed. This matters when forwarding a request after reading it.

Sources: [src/request.ts:476-504](repo://src/request.ts#L476-L504)

## Context values and runtime state

Bindings arrive as `c.env`. Handler-created values use `c.set` and `c.get`, backed by a lazily created map; `c.var` returns a record snapshot with a readonly TypeScript view. Missing stored values produce `undefined`, while a context with no variable map produces an empty `var` record. These values belong to this context rather than to the application route table.

Sources: [src/context.ts:315-317](repo://src/context.ts#L315-L317), [src/context.ts:352-360](repo://src/context.ts#L352-L360), [src/context.ts:553-601](repo://src/context.ts#L553-L601)

`c.executionCtx` throws if no execution context was supplied. `c.event` additionally requires a context with `respondWith`, otherwise it throws that there is no FetchEvent. A request created in a test therefore does not acquire platform capabilities merely by entering Hono; the caller must supply the corresponding object. [[Runtime Adapters and Static Files]] covers how adapters populate this boundary.

Sources: [src/context.ts:377-396](repo://src/context.ts#L377-L396), [src/hono-base.ts:499-516](repo://src/hono-base.ts#L499-L516)

## Responses and finalization

`c.header` prepares headers before response creation or changes the current response's headers afterward. An undefined value deletes a header, and `append` preserves additional values. `c.status` stores the status for a later response. Reading `c.res` lazily creates an empty response but does not itself finalize the context. Assigning `c.res` marks it finalized and, when replacing an existing response, carries over headers except content type, with special handling for multiple cookies.

Sources: [src/context.ts:403-434](repo://src/context.ts#L403-L434), [src/context.ts:515-531](repo://src/context.ts#L515-L531)

| Response method | Behavior |
| --- | --- |
| `body` / `newResponse` | Builds a response from body data and response options |
| `text` | Uses a direct `Response` fast path when no context options or headers are prepared; otherwise supplies the text content type |
| `json` | Serializes with `JSON.stringify` and supplies `application/json` |
| `html` | Supplies the HTML content type and resolves escaped-string callbacks for object output |
| `redirect` | Sets `Location`, encodes multibyte characters when needed, and defaults to status 302 |
| `notFound` | Invokes the context's configured not-found handler |
| `render` | Delegates to the installed renderer, defaulting to `html` |

Sources: [src/context.ts:448-451](repo://src/context.ts#L448-L451), [src/context.ts:604-641](repo://src/context.ts#L604-L641), [src/context.ts:664-733](repo://src/context.ts#L664-L733), [src/context.ts:750-778](repo://src/context.ts#L750-L778)

Renderer and layout setters provide the extension used by [[Server Rendering]]. They are stored on the context, so middleware can install a request-specific renderer before the endpoint calls `c.render`. Returning its result still follows the response assignment and finalization rules explained by [[Middleware and Errors]].

Sources: [src/context.ts:448-496](repo://src/context.ts#L448-L496), [src/compose.ts:49-69](repo://src/compose.ts#L49-L69)
