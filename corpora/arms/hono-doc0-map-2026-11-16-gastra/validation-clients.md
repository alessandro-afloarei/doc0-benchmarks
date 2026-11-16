---
title: "Validation and Typed Clients"
---
## Overview

Validation connects raw request data to a handler's typed input, while the client projects an application's route schema into callable HTTP methods. The server still executes a validation callback at runtime. The client still constructs and fetches a URL. [[Request and Context]] covers the underlying readers; this page follows how their output becomes validated data and how a client serializes the corresponding request.

Sources: [src/validator/validator.ts:46-88](repo://src/validator/validator.ts#L46-L88), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170), [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80), [src/client/client.ts:110-128](repo://src/client/client.ts#L110-L128)

## Extract input for validation

`validator(target, validationFunc)` returns middleware. It begins with an empty object, examines the requested target, and then awaits the callback. JSON and form extraction depend on Content-Type: if the expected media type does not match, the callback receives the initial empty object. Malformed matching JSON throws HTTPException 400; malformed matching form data also throws 400, adding the underlying error message when available.

Sources: [src/validator/validator.ts:85-127](repo://src/validator/validator.ts#L85-L127)

| Target | Input presented to the callback |
| --- | --- |
| `json` | Parsed JSON for a matching JSON media type |
| `form` | Form entries with repeated names collected into arrays |
| `query` | Query values collapsed to strings for a single occurrence, arrays for repeated occurrences |
| `param` | Decoded path parameter record |
| `header` | Request header record |
| `cookie` | Parsed cookies |

Sources: [src/validator/validator.ts:93-160](repo://src/validator/validator.ts#L93-L160)

Form validation reuses cached FormData when present. Otherwise it reads an ArrayBuffer, reconstructs FormData using Content-Type, and stores it in the wrapper cache. Keys ending in `[]` always collect values in an array; other duplicated keys become arrays upon repetition. This differs from the default overwrite behavior of the general `parseBody` interface described in [[Request and Context]].

Sources: [src/validator/validator.ts:113-141](repo://src/validator/validator.ts#L113-L141), [src/utils/body.ts:155-164](repo://src/utils/body.ts#L155-L164)

## Accept, transform, or reject

The callback can return transformed data or a Response. A Response returns immediately from the middleware. Any other result is stored under the validation target, after which the middleware awaits `next()`. Handlers retrieve that stored result with `c.req.valid(target)`; this accessor does not repeat validation. Async callbacks participate in the same branch after their promise resolves.

Sources: [src/validator/validator.ts:14-22](repo://src/validator/validator.ts#L14-L22), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

```mermaid
flowchart TD
  request["Incoming request"] --> extract["Extract validation target"]
  extract --> callback["Await validationFunc"]
  callback --> response["Returned Response"]
  callback --> data["Returned data"]
  response --> end["Stop this middleware branch"]
  data --> store["addValidatedData"]
  store --> next["Await next handler"]
  next --> read["Handler reads req.valid"]
```

Sources: [src/validator/validator.ts:89-170](repo://src/validator/validator.ts#L89-L170), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

The validator's type machinery separates input from output and excludes response values when extracting successful validation output. It also extracts response types from the callback so rejection branches can be represented in handler typing. GET and HEAD validation targets exclude the body-bearing JSON and form targets at the type level. Those types describe the contract; the callback remains responsible for deciding which input is acceptable.

Sources: [src/validator/validator.ts:9-44](repo://src/validator/validator.ts#L9-L44), [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88), [src/validator/validator.ts:174-185](repo://src/validator/validator.ts#L174-L185)

## Build the client request

`hc<T>(baseUrl, options)` returns a proxy parameterized by an application type. Property access accumulates path segments; invoking a method whose final name starts with `$` extracts that HTTP operation. The proxy deliberately ignores `then` so it is not treated as a promise. Client method types derive required argument objects from endpoint input and associate their responses with endpoint output.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31), [src/client/client.ts:132-170](repo://src/client/client.ts#L132-L170), [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80)

Each operation creates a ClientRequestImpl. Query data goes through the configured search-parameter builder. Forms become FormData, skipping undefined values and appending array members separately. A truthy JSON argument is JSON-stringified and sets Content-Type to application/json. Parameter substitutions and removal of the terminal index segment happen before query text is appended.

Sources: [src/client/client.ts:53-118](repo://src/client/client.ts#L53-L118), [src/client/client.ts:214-229](repo://src/client/client.ts#L214-L229)

The default query builder appends repeated values using the same key. URL parameter replacement inserts the supplied value directly into the matching route segment; the helper does not apply URI encoding to that value. `$url` applies parameter/query construction and returns a URL object. `$path` performs the corresponding construction and strips the normalized base URL to return a path.

Sources: [src/client/utils.ts:18-43](repo://src/client/utils.ts#L18-L43), [src/client/client.ts:169-186](repo://src/client/client.ts#L169-L186)

## Options and response handling

Headers combine request argument headers with option headers, which may be a synchronous record or async function. When both base and per-call option headers exist, a new function resolves and merges them with per-call values last. Cookie arguments are serialized into a Cookie header. The final fetch uses an injected fetch function or the global fetch and suppresses the generated body for GET and HEAD.

Sources: [src/client/client.ts:91-128](repo://src/client/client.ts#L91-L128), [src/client/client.ts:217-229](repo://src/client/client.ts#L217-L229)

The final `init` object is spread after generated body, method, and headers. It therefore has highest priority and can replace all three. The ClientRequestOptions comment recommends using its `headers` option when adding headers. Options also expose custom query serialization and a WebSocket constructor; the `$ws` path converts the URL protocol and supplies query values before opening that connection.

Sources: [src/client/types.ts:32-56](repo://src/client/types.ts#L32-L56), [src/client/client.ts:120-128](repo://src/client/client.ts#L120-L128), [src/client/client.ts:187-211](repo://src/client/client.ts#L187-L211)

Normal client calls return the fetch response. The optional `parseResponse` helper consumes it, selects JSON or text based on Content-Type, and throws DetailedError for a non-ok response. The error includes statusCode and detail containing parsed data and status text. Responses without a consumable body produce undefined data; the helper excludes the explicit null-body statuses from consumption.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:7-44](repo://src/client/fetch-result-please.ts#L7-L44), [src/client/fetch-result-please.ts:80-95](repo://src/client/fetch-result-please.ts#L80-L95)

## Reuse contracts in tests and factories

`testClient(app, env, executionCtx, options)` creates the same typed client with a custom fetch that calls `app.request`. This runs the application's validation and routing in process while preserving client serialization. It supplies the fixed base URL `http://localhost` and forwards bindings and execution context, making the request path in [[Quickstart]] available through the client interface.

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

The factory helpers preserve middleware and handler types when constructing reusable pieces. `createApp` merges default options with per-call options and runs an optional initializer. `createMiddleware` returns the supplied middleware unchanged, and `createHandlers` filters undefined entries. These helpers organize typed application assembly without adding another validation or request dispatch stage.

Sources: [src/helper/factory/index.ts:332-375](repo://src/helper/factory/index.ts#L332-L375)

