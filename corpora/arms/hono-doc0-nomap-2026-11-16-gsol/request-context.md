---
title: "Request and Context"
---
## Overview

Each dispatch creates one `Context` carrying the incoming request, matching information, environment, execution context, and not-found handler. Accessing `c.req` lazily constructs `HonoRequest`; the wrapper retains the raw request while exposing routing-aware accessors and body caching. [[Routing and Application Composition]] explains where the matching information comes from. This page follows that information through input access, request-local values, and response construction.

Sources: [src/hono-base.ts:418-427](repo://src/hono-base.ts#L418-L427), [src/context.ts:352-368](repo://src/context.ts#L352-L368), [src/request.ts:51-80](repo://src/request.ts#L51-L80)

## Read route and URL inputs

`c.req.raw` is the standard request. `path` is the path supplied by dispatch, while `url` and `method` read the raw request's properties. `param(name)` uses the current `routeIndex` to select the correct parameter map from the match result. Parameter values containing percent escapes are decoded; calling `param()` builds the decoded parameter object for that handler. This preserves handler-specific names when several matching patterns participate in one chain.

Sources: [src/request.ts:51-80](repo://src/request.ts#L51-L80), [src/request.ts:102-128](repo://src/request.ts#L102-L128), [src/request.ts:369-386](repo://src/request.ts#L369-L386), [src/compose.ts:42-44](repo://src/compose.ts#L42-L44)

| Accessor | Result |
| --- | --- |
| `query(name)` | A single query value or `undefined` |
| `query()` | Query values in a record |
| `queries(name)` | All values for one key as an array, or `undefined` |
| `queries()` | A record of value arrays |
| `header(name)` | The raw header value, with missing values mapped to `undefined` |
| `header()` | A record built from the request's header collection |

Sources: [src/request.ts:148-198](repo://src/request.ts#L148-L198)

## Consume and reuse the body

`json`, `text`, `arrayBuffer`, `blob`, and `formData` expose body readers through the wrapper. The cache first reuses an existing value for the requested body method. If another representation is already cached, it derives the requested representation through a temporary response; otherwise it records the raw request's read promise. JSON parsing uses cached text and applies `JSON.parse`, so the raw body need not be read again when JSON is requested after text.

Sources: [src/request.ts:220-254](repo://src/request.ts#L220-L254), [src/request.ts:269-330](repo://src/request.ts#L269-L330)

The cache belongs to the wrapper's readers. Direct access to `raw` does not pass through `#cachedBody`. Keep middleware and downstream handler body reads on the wrapper when relying on that shared cache. `parseBody` additionally caches parsed form data so a later `formData` call can reuse the already-consumed input. [[Request Validation]] explains the separate operation that turns parsed values into accepted application data; a generic argument to `json` does not perform that validation.

Sources: [src/request.ts:220-254](repo://src/request.ts#L220-L254), [src/utils/body.ts:123-140](repo://src/utils/body.ts#L123-L140), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

## Parse form fields

`parseBody` recognizes multipart form data and URL-encoded forms after normalizing the media type; other media types return an empty object. It reads the body as an array buffer and converts it to form data. By default, repeated ordinary keys keep their last value. With `all: true`, repeated fields accumulate; keys ending in `[]` also select array behavior. File values remain file values rather than being converted to strings.

Sources: [src/utils/body.ts:97-140](repo://src/utils/body.ts#L97-L140), [src/utils/body.ts:151-205](repo://src/utils/body.ts#L151-L205)

The `dot` option transforms dotted form keys into nested objects after field collection. Both `all` and `dot` default to false. These are parsing choices: they affect the shape the handler receives, while the validator's `form` target has its own field accumulation behavior. Select the parser based on the shape the handler consumes and keep the acceptance rules in [[Request Validation]].

Sources: [src/utils/body.ts:43-74](repo://src/utils/body.ts#L43-L74), [src/utils/body.ts:97-101](repo://src/utils/body.ts#L97-L101), [src/utils/body.ts:151-178](repo://src/utils/body.ts#L151-L178), [src/validator/validator.ts:129-141](repo://src/validator/validator.ts#L129-L141)

## Carry environment and request-local values

`c.env` receives dispatch's environment argument. It is separate from values stored with `c.set`: those live in a lazily allocated map on this context. `get` retrieves one map value and returns `undefined` when no value is present. `c.var` returns a read-only typed view built from the entries; without a map it returns an empty object. Use environment bindings for the runtime input and context variables for data produced during the current handler chain.

Sources: [src/context.ts:303-316](repo://src/context.ts#L303-L316), [src/context.ts:352-359](repo://src/context.ts#L352-L359), [src/context.ts:546-602](repo://src/context.ts#L546-L602)

`c.executionCtx` exposes the supplied runtime execution context and throws when absent. `c.event` additionally requires an execution object with `respondWith`, otherwise it throws its FetchEvent-specific error. An in-process request does not manufacture these objects; it accepts them as explicit arguments. [[Runtime Adapters]] describes which integrations supply execution functions and which expose platform data through bindings instead.

Sources: [src/context.ts:377-397](repo://src/context.ts#L377-L397), [src/hono-base.ts:499-516](repo://src/hono-base.ts#L499-L516)

## Build a response

`newResponse` and `body` use the shared response builder. It starts from existing response headers or prepared headers, merges initialization headers, then applies explicit helper headers. String header values replace; array values are appended after deleting the prior value. Status comes from an explicit number, initialization status, or the context's stored status. `text`, `json`, and `html` add their content-specific behavior, with `json` applying `JSON.stringify`.

Sources: [src/context.ts:604-641](repo://src/context.ts#L604-L641), [src/context.ts:664-733](repo://src/context.ts#L664-L733)

`c.header` can set, append, or delete a response header. Before a response exists it stores prepared headers; after finalization it recreates the response before changing its headers. `c.status` stores a default for response construction. The plain `text` helper has a direct `new Response(text)` branch when none of the extra context state or arguments requires the general builder. A helper returns a response; composition or dispatch decides how that returned value becomes the final result.

Sources: [src/context.ts:515-531](repo://src/context.ts#L515-L531), [src/context.ts:682-694](repo://src/context.ts#L682-L694), [src/compose.ts:67-70](repo://src/compose.ts#L67-L70), [src/hono-base.ts:429-447](repo://src/hono-base.ts#L429-L447)

## Replace, redirect, and render

Reading `c.res` creates a response if none exists. Assigning a response sets `finalized`; if an old response exists, its headers are transferred except content type, and cookies use `getSetCookie` so each cookie is appended separately. This merge is why response assignment has effects beyond storing a value. [[Middleware and Errors]] explains finalization and when returned responses are assigned during unwinding.

Sources: [src/context.ts:403-434](repo://src/context.ts#L403-L434)

`redirect` sets a location header, encodes multibyte locations when needed, and returns a null-body response with default status 302. `notFound` delegates to the configured not-found handler. `render` invokes the configured renderer, lazily defaulting to `html`; `setRenderer`, `setLayout`, and `getLayout` provide the integration used by [[HTML and JSX Rendering]]. These operations keep response construction on the same context even when rendering is replaced by middleware.

Sources: [src/context.ts:448-472](repo://src/context.ts#L448-L472), [src/context.ts:495-497](repo://src/context.ts#L495-L497), [src/context.ts:750-779](repo://src/context.ts#L750-L779)
