---
title: "Validation and Typed Clients"
---
## Overview

Hono connects server validation and client typing through route input and output types. A validator extracts one request target, invokes an application callback, and either returns a response or stores transformed data for downstream handlers. The client uses the application's schema type to expose HTTP calls, then builds ordinary fetch requests at runtime. The request wrapper and middleware execution contract are described in [[Request Context and Middleware]].

Sources: [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170), [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80), [src/client/client.ts:113-128](repo://src/client/client.ts#L113-L128)

## Extract and validate input

`validator(target, validationFunc)` returns middleware. It starts with an empty object and selects extraction by target. Its callback may be asynchronous and can return a transformed value or a response. A response short-circuits the chain; any other result is stored with `addValidatedData` before `next` runs. Later handlers call `c.req.valid(target)` to retrieve that stored result; retrieval does not invoke validation again.

Sources: [src/validator/validator.ts:85-104](repo://src/validator/validator.ts#L85-L104), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170), [src/request.ts:339-354](repo://src/request.ts#L339-L354)

| Target | Extraction and shape |
| --- | --- |
| `json` | Parses JSON only for a matching JSON content type |
| `form` | Parses multipart or URL-encoded content into a null-prototype record; repeated fields become arrays |
| `query` | Converts one value to a string and multiple values to arrays |
| `param` | Uses decoded route parameters |
| `header` | Uses the request header record |
| `cookie` | Uses parsed request cookies |

Sources: [src/validator/validator.ts:24-26](repo://src/validator/validator.ts#L24-L26), [src/validator/validator.ts:89-160](repo://src/validator/validator.ts#L89-L160)

Content type controls body extraction. Missing or nonmatching content types leave the initial empty object for the callback, rather than automatically rejecting the request. Malformed matching JSON throws an `HTTPException` with status 400; malformed matching form data does likewise. Form extraction reuses cached `FormData` or reads an array buffer and caches the converted form. Names ending in `[]` always accumulate arrays, including the first value.

Sources: [src/validator/validator.ts:89-143](repo://src/validator/validator.ts#L89-L143)

The callback supplies the validation policy. The wrapper does not inspect fields against a schema on its own. Its type machinery distinguishes incoming values from validated output, excludes response values from the successful output type, and excludes JSON/form targets for GET and HEAD method types. An application must still implement checks in the callback even when TypeScript already describes the expected input.

Sources: [src/validator/validator.ts:9-22](repo://src/validator/validator.ts#L9-L22), [src/validator/validator.ts:64-88](repo://src/validator/validator.ts#L64-L88), [src/validator/validator.ts:162-185](repo://src/validator/validator.ts#L162-L185)

## Carry the route type to the client

The client tests retain the chained route registration result and derive `AppType` from it. They then pass that type to `hc`, allowing endpoint calls to reflect registered inputs and response bodies. `ClientRequest` makes its argument required when the endpoint input has required keys; it also expands an `all` schema into the standard method call names. Preserve the typed registration result when exposing an application type.

Sources: [src/client/client.test.ts:31-73](repo://src/client/client.test.ts#L31-L73), [src/client/client.test.ts:126-154](repo://src/client/client.test.ts#L126-L154), [src/client/types.ts:19-26](repo://src/client/types.ts#L19-L26), [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80)

`InferRequestType` extracts a client method's argument shape. `InferResponseType` extracts its output and can filter by status code. The typed response interface carries status, `ok`, output format and parser return types. These are compile-time descriptions: the runtime client returns the result from the configured fetch function and does not validate a remote response body against those types.

Sources: [src/client/types.ts:120-154](repo://src/client/types.ts#L120-L154), [src/client/types.ts:239-271](repo://src/client/types.ts#L239-L271), [src/client/client.ts:122-128](repo://src/client/client.ts#L122-L128)

## Build an HTTP call

`hc` creates a proxy whose property accesses collect path segments. Calling a property invokes a callback with the collected path and arguments. A final `$`-prefixed segment becomes the method, and the remaining segments are joined to the base URL. The proxy deliberately does not expose `then`, preventing it from appearing to be a promise. Each HTTP invocation constructs its own `ClientRequestImpl`.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31), [src/client/client.ts:133-170](repo://src/client/client.ts#L133-L170), [src/client/client.ts:214-232](repo://src/client/client.ts#L214-L232)

```mermaid
flowchart LR
  A["client path and $method"] --> B["Proxy callback"]
  B --> C["ClientRequestImpl.fetch"]
  C --> D["Serialize input and merge options"]
  D --> E["fetch URL and RequestInit"]
  E --> F["Server validator"]
  F --> G["Response or stored validated data"]
```

Sources: [src/client/client.ts:15-28](repo://src/client/client.ts#L15-L28), [src/client/client.ts:53-128](repo://src/client/client.ts#L53-L128), [src/client/client.ts:214-229](repo://src/client/client.ts#L214-L229), [src/validator/validator.ts:162-170](repo://src/validator/validator.ts#L162-L170)

Query arrays become repeated search parameters by default, with undefined values skipped. Form input becomes `FormData`, appending each array item; truthy JSON input is stringified and sets the content type. Parameters replace named path placeholders, and the synthetic `index` path segment is removed from the final URL. The implementation suppresses request bodies for GET and HEAD. Parameter replacement directly substitutes supplied strings, so it does not add a separate encoding pass.

Sources: [src/client/client.ts:59-88](repo://src/client/client.ts#L59-L88), [src/client/client.ts:110-128](repo://src/client/client.ts#L110-L128), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60)

## Configure transport and URLs

Client options can supply a fetch function, request initialization, static or asynchronous headers, a query serializer and a WebSocket constructor function. Base and per-call headers are combined, with per-call values winning, then options are deeply merged. Within request construction, option headers override argument headers. Finally `init` is spread after generated body, method and headers, giving it the highest priority. Use the dedicated `headers` option when adding headers while retaining generated ones.

Sources: [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65), [src/client/client.ts:93-128](repo://src/client/client.ts#L93-L128), [src/client/client.ts:218-229](repo://src/client/client.ts#L218-L229), [src/client/utils.ts:66-82](repo://src/client/utils.ts#L66-L82)

`$url` returns a `URL`, while `$path` returns the path relative to the configured base; both apply supplied parameters and query values without sending a request. `$ws` converts the URL protocol, appends query values and invokes the custom or global WebSocket constructor. [[Streaming and WebSockets]] covers the server-side upgrade needed for those connections. For in-process transport, the fetch option accepts the application's request method, which the testing helper uses in [[Testing and Development]].

Sources: [src/client/client.ts:171-211](repo://src/client/client.ts#L171-L211), [src/client/types.ts:32-34](repo://src/client/types.ts#L32-L34)

## Consume responses and failures

Ordinary client calls leave status checking and body reading to the caller. The repository tests explicitly inspect `ok`, `status` and `json()`, including a 404 response. This retains access to headers and raw response data when application code needs them.

Sources: [src/client/client.ts:122-128](repo://src/client/client.ts#L122-L128), [src/client/client.test.ts:147-159](repo://src/client/client.test.ts#L147-L159)

`parseResponse` instead delegates to `fetchRP`: it detects JSON from content type, otherwise reads text, and skips known null-body statuses. Non-OK responses throw `DetailedError` containing status code, status text and parsed data. Successful bodyless responses yield undefined. Because this helper consumes the body before returning or throwing, choose it when the parsed payload and structured error are the desired interface.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:7-44](repo://src/client/fetch-result-please.ts#L7-L44), [src/client/fetch-result-please.ts:64-95](repo://src/client/fetch-result-please.ts#L64-L95)
