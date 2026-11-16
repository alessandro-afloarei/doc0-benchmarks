---
title: "Typed Client"
---
## Overview

`hc` creates a client whose property tree follows an application's route schema. Runtime property access collects path segments, and a method call turns them into a URL and fetch operation. Its generic application type supplies request and response information; it does not execute server validation locally. [[Request Validation]] explains how the server contributes input and response types, while [[Routing and Application Composition]] explains the route paths that shape the client.

Sources: [src/client/client.ts:15-30](repo://src/client/client.ts#L15-L30), [src/client/client.ts:132-139](repo://src/client/client.ts#L132-L139), [src/client/client.ts:161-185](repo://src/client/client.ts#L161-L185), [src/client/types.ts:67-125](repo://src/client/types.ts#L67-L125)

## Build a request from property access

The proxy returns another proxy for each string property, excluding `then` so it is not treated as a promise. Calling it invokes the callback with the accumulated path and arguments. A final property beginning with `$` supplies the method name; earlier properties become slash-separated path segments. The base URL and path are merged after trimming duplicate boundary slashes. Special `toString` and `valueOf` handling supports path-name access without making a request.

Sources: [src/client/client.ts:15-30](repo://src/client/client.ts#L15-L30), [src/client/client.ts:137-170](repo://src/client/client.ts#L137-L170), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16)

```mermaid
flowchart LR
  proxy["Collect property path"] --> method["Read final dollar method"]
  method --> url["Merge base URL and path"]
  url --> serialize["Serialize input and options"]
  serialize --> fetch["Configured fetch or global fetch"]
  fetch --> response["Response with endpoint types"]
```

Sources: [src/client/client.ts:15-30](repo://src/client/client.ts#L15-L30), [src/client/client.ts:161-170](repo://src/client/client.ts#L161-L170), [src/client/client.ts:214-232](repo://src/client/client.ts#L214-L232), [src/client/client.ts:53-128](repo://src/client/client.ts#L53-L128)

The first call argument contains transport groups such as `param`, `query`, `json`, `form`, `header`, and `cookie`. The second supplies request options. A fresh `ClientRequestImpl` is built for each endpoint call. The typed interface makes the first argument required when the endpoint input has required keys and optional otherwise. An `all` endpoint expands into the standard dollar-prefixed HTTP methods at the type level.

Sources: [src/client/client.ts:53-88](repo://src/client/client.ts#L53-L88), [src/client/client.ts:214-229](repo://src/client/client.ts#L214-L229), [src/client/types.ts:19-26](repo://src/client/types.ts#L19-L26), [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80)

## Serialize parameters and bodies

| Input | Runtime serialization |
| --- | --- |
| `query` | URLSearchParams, repeating keys for arrays and omitting undefined values |
| `param` | Replaces named URL segments, including optional or regex-qualified forms |
| `form` | FormData, appending each array item and omitting undefined fields |
| `json` | JSON.stringify with application/json content type when the implementation's truthy check passes |
| `header` | Merged into the constructed header values |
| `cookie` | Serialized cookies combined into the Cookie header |

Sources: [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44), [src/client/client.ts:59-108](repo://src/client/client.ts#L59-L108)

The default path substitution inserts supplied values without an explicit URI-encoding step. It removes a named segment when the supplied value is falsy, and `removeIndexString` handles an ending `/index` convention. Query serialization is replaceable with `buildSearchParams`, which is used for ordinary calls and URL/path helpers. GET and HEAD suppress the request body even when body input was supplied. Explicit `init` options are applied afterward and can override generated request fields.

Sources: [src/client/utils.ts:18-24](repo://src/client/utils.ts#L18-L24), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60), [src/client/client.ts:113-128](repo://src/client/client.ts#L113-L128), [src/client/client.ts:138-139](repo://src/client/client.ts#L138-L139), [src/client/client.ts:171-185](repo://src/client/client.ts#L171-L185)

## Configure fetch and header precedence

Client options support a custom fetch implementation, WebSocket factory, query serializer, request initialization, and headers as an object or asynchronous function. For each call, client and call options are deeply merged. When both header options exist, a combined function resolves each source and gives call headers precedence. During request construction, option headers override the first argument's header values. Cookie and JSON content-type assignment then apply before constructing `Headers`.

Sources: [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65), [src/client/client.ts:93-110](repo://src/client/client.ts#L93-L110), [src/client/client.ts:217-229](repo://src/client/client.ts#L217-L229), [src/client/utils.ts:62-82](repo://src/client/utils.ts#L62-L82)

`init` has the highest priority because it is spread after generated body, method, and headers. The source specifically recommends the `headers` option for adding headers instead of `init.headers`. A custom fetch receives a URL string and initialization object. [[Testing and Development]] uses this seam through `testClient`, which redirects requests into the application rather than a network listener.

Sources: [src/client/types.ts:35-41](repo://src/client/types.ts#L35-L41), [src/client/client.ts:120-128](repo://src/client/client.ts#L120-L128), [src/helper/testing/index.ts:15-27](repo://src/helper/testing/index.ts#L15-L27)

## Generate URLs and open sockets

`$url` and `$path` share path and query substitution but do not fetch. `$url` returns a URL object. `$path` removes the configured base prefix and normalizes the leading slash, returning a path string. Both apply the ending-index convention. Their return types can retain literal URL and path components when the supplied types permit it. These helpers are useful when the caller needs the same route-shaped address without consuming an endpoint response.

Sources: [src/client/client.ts:171-185](repo://src/client/client.ts#L171-L185), [src/client/types.ts:82-111](repo://src/client/types.ts#L82-L111), [src/client/types.ts:162-187](repo://src/client/types.ts#L162-L187)

`$ws` converts the HTTP URL protocol to its WebSocket counterpart, substitutes path parameters, appends query values, and constructs a socket through the configured factory or global WebSocket. Repeated query values are appended individually. The typed interface exposes this operation for GET endpoints with output format `ws`; [[WebSockets]] explains the server helper that supplies that format and the runtime-specific upgrade operation.

Sources: [src/client/client.ts:187-212](repo://src/client/client.ts#L187-L212), [src/client/utils.ts:46-53](repo://src/client/utils.ts#L46-L53), [src/client/types.ts:112-118](repo://src/client/types.ts#L112-L118)

## Consume typed responses

The client response interface carries output, status, and response format. `json` returns the endpoint output for JSON responses, `text` preserves text output types, and `status` and `ok` reflect the endpoint's possible statuses. `InferRequestType` extracts the request argument, while `InferResponseType` can select output by status. These are compile-time descriptions over the fetch response; ordinary client calls return the fetch result without automatically converting non-success statuses into exceptions.

Sources: [src/client/types.ts:120-154](repo://src/client/types.ts#L120-L154), [src/client/types.ts:239-271](repo://src/client/types.ts#L239-L271), [src/client/client.ts:122-128](repo://src/client/client.ts#L122-L128)

`parseResponse` adds body consumption and failure conversion. It accepts a response or response promise, detects JSON content types and otherwise reads text, and skips body reads for null-body status codes. If the response is not ok, it throws `DetailedError` containing the status code, status text, and parsed data. On success it returns the parsed data, or undefined when there is no body. Its type excludes error-status outputs from the successful return value.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:7-44](repo://src/client/fetch-result-please.ts#L7-L44), [src/client/fetch-result-please.ts:64-95](repo://src/client/fetch-result-please.ts#L64-L95)
