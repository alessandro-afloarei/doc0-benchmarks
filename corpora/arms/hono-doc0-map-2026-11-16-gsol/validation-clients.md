---
title: "Validation and Typed Clients"
---
## Overview

Hono's validation flow extracts one request target, runs an application callback and stores successful output for downstream handlers. Route types carry input and response contracts into `hc`, whose runtime proxy serializes HTTP calls. This page connects the two sides of that contract. Raw extraction and body reuse belong to [[Request and Context]], while callback failures use [[Middleware and Errors]].

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/validator.ts:89-170](repo://src/validator/validator.ts#L89-L170), [src/client/client.ts:133-170](repo://src/client/client.ts#L133-L170), [src/client/client.ts:214-232](repo://src/client/client.ts#L214-L232)

## Validation targets

| Target | Value passed to the callback |
| --- | --- |
| `json` | Parsed JSON for a recognized JSON content type; otherwise an empty object |
| `form` | Form fields for multipart or URL-encoded content; repeated fields become arrays |
| `query` | Query record; one value becomes a string and repeated values remain arrays |
| `param` | Decoded path parameter record |
| `header` | Request header record |
| `cookie` | Parsed cookie record |

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160)

JSON and form extraction are conditional on content type. A mismatched or absent type leaves the initial empty object for the callback to validate; it is not automatically a 415 response. Recognized but malformed JSON throws a 400 `HTTPException`. Form parsing reuses cached form data or builds it from an array buffer, caches the result, and translates parse errors to a 400 exception. Form keys ending in `[]` collect values even when only one is present.

Sources: [src/validator/validator.ts:89-143](repo://src/validator/validator.ts#L89-L143)

The validation callback may be asynchronous. Returning a `Response` stops the middleware and becomes the response; any other result is stored with `addValidatedData(target, result)` before `next` runs. Downstream code retrieves exactly that transformed result through `c.req.valid(target)`. Validation therefore permits coercion and reshaping, rather than requiring successful output to equal the extracted input.

Sources: [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170), [src/request.ts:333-354](repo://src/request.ts#L333-L354)

## Type contract propagation

Validator types distinguish `in` and `out`: input describes the caller's target data and output describes the successful callback result. The return type also extracts response branches from the callback, including promised responses. GET/HEAD validation targets exclude JSON and form bodies at the type level. Route schema construction associates a method-prefixed endpoint with its input, response output, format and status, and augments its input with path parameters.

Sources: [src/validator/validator.ts:9-43](repo://src/validator/validator.ts#L9-L43), [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185), [src/types.ts:2483-2538](repo://src/types.ts#L2483-L2538)

Client method types make arguments required when the endpoint input has required keys and optional otherwise. `ClientResponse` carries the endpoint's status and output format into `ok`, `json()` and `text()` typing. These are compile-time views of the HTTP response, while the runtime still returns the fetch result. Supplying an application's route type to `hc` preserves this contract without sending that type to the server as runtime metadata.

Sources: [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80), [src/client/types.ts:120-153](repo://src/client/types.ts#L120-L153), [src/client/client.ts:123-128](repo://src/client/client.ts#L123-L128), [src/client/client.ts:133-136](repo://src/client/client.ts#L133-L136), [src/client/client.ts:232-232](repo://src/client/client.ts#L232-L232)

## From proxy properties to an HTTP request

`hc` returns a recursive function proxy. Reading a string property extends the path; reading `then` returns undefined so the proxy is not treated as a promise. Calling a method whose name starts with `$` strips that prefix and treats the result as the HTTP method. The accumulated property names become slash-separated path components merged with the base URL. An ordinary method call constructs a request implementation and merges client-level and call-level options before fetching.

Sources: [src/client/client.ts:15-30](repo://src/client/client.ts#L15-L30), [src/client/client.ts:161-170](repo://src/client/client.ts#L161-L170), [src/client/client.ts:214-232](repo://src/client/client.ts#L214-L232)

```mermaid
flowchart LR
  properties["Client property path"] --> method["Extract dollar-prefixed method"]
  method --> options["Merge client and call options"]
  options --> serialize["Serialize body, parameters and headers"]
  serialize --> fetch["Custom fetch or global fetch"]
  fetch --> target["Server validator extracts target"]
  target --> result["Response or stored validated output"]
```

Sources: [src/client/client.ts:53-128](repo://src/client/client.ts#L53-L128), [src/client/client.ts:161-170](repo://src/client/client.ts#L161-L170), [src/client/client.ts:214-229](repo://src/client/client.ts#L214-L229), [src/validator/validator.ts:89-103](repo://src/validator/validator.ts#L89-L103), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

Query arrays serialize as repeated keys by default, with a configurable `buildSearchParams`. Forms become `FormData`, skipping undefined fields and appending array items. JSON becomes a string body with an application/json content type. Path parameters are substituted before query parameters are appended, and terminal index paths are normalized. GET and HEAD omit the generated body. Header callbacks can be asynchronous; cookie arguments are serialized into the Cookie header.

Sources: [src/client/client.ts:53-128](repo://src/client/client.ts#L53-L128), [src/client/utils.ts:18-59](repo://src/client/utils.ts#L18-L59)

## Options, URL helpers and socket calls

Client options include `fetch`, `webSocket`, headers, query serialization and `init`. Base and call header providers are combined with call values taking precedence, then the remaining options are deeply merged. The final spread of `init` has highest priority over generated body, method and headers. Use the dedicated header option when extending generated headers; using `init.headers` replaces the final headers argument.

Sources: [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65), [src/client/client.ts:123-128](repo://src/client/client.ts#L123-L128), [src/client/client.ts:218-229](repo://src/client/client.ts#L218-L229), [src/client/utils.ts:66-81](repo://src/client/utils.ts#L66-L81)

`$url` returns a `URL`, while `$path` returns a path relative to the base. Both substitute supplied parameters and query values without fetching. `$ws` switches HTTP protocol spelling to its WebSocket counterpart, adds query parameters and constructs the configured or global WebSocket. Its typed availability depends on a GET endpoint with output format `ws`; [[Streaming and WebSockets]] explains the corresponding server upgrade contract.

Sources: [src/client/client.ts:171-211](repo://src/client/client.ts#L171-L211), [src/client/types.ts:82-118](repo://src/client/types.ts#L82-L118)

## In-process typed testing

`testClient(app, env, executionCtx, options)` creates an `hc` client with a localhost base and a custom fetch that calls `app.request`. Calls retain the application's client type while running through real request construction, route matching and validation. This extends the direct request path shown in [[Quickstart]] to typed endpoint calls, and lets tests supply bindings and execution context through the helper's arguments.

Sources: [src/helper/testing/index.ts:16-26](repo://src/helper/testing/index.ts#L16-L26), [src/hono-base.ts:499-516](repo://src/hono-base.ts#L499-L516)
