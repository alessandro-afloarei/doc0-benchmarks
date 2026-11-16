---
title: "Typed Client"
---
## Overview

The `hono/client` entry exports `hc`, a proxy-based HTTP client whose type comes from a Hono application's route schema. [[Input Validation]] explains how server input and response types enter that schema. At runtime the client builds URLs, serializes arguments, and invokes fetch; it does not load or execute the server's validation callback.

Sources: [src/client/index.ts:6-17](repo://src/client/index.ts#L6-L17), [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31), [src/client/client.ts:214-232](repo://src/client/client.ts#L214-L232), [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318)

## Keep the registered application type

Client types derive paths from the schema on `HonoBase`. Each path becomes a nested property chain, with the root represented by `index`. Endpoint methods become dollar-prefixed functions, and an all-method route expands to the standard method set. The client tests retain the result of chained registrations as `route`, define AppType from that value, and instantiate `hc<AppType>`. Keeping that accumulated type preserves the route information the client needs.

Sources: [src/client/types.ts:8-26](repo://src/client/types.ts#L8-L26), [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80), [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318), [src/client/client.test.ts:34-73](repo://src/client/client.test.ts#L34-L73), [src/client/client.test.ts:131-145](repo://src/client/client.test.ts#L131-L145)

A property's access extends the proxy's path array. Invoking the final property calls the proxy callback, which removes a leading dollar from the method name, joins the remaining path segments, and merges them with the base URL. Special handling of `then` prevents the proxy from behaving like a promise. Each ordinary method invocation constructs a fresh ClientRequestImpl.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31), [src/client/client.ts:161-170](repo://src/client/client.ts#L161-L170), [src/client/client.ts:214-232](repo://src/client/client.ts#L214-L232)

```mermaid
flowchart LR
  call["client.posts.$post(args)"] --> proxy["Collect path and method"]
  proxy --> request["ClientRequestImpl"]
  request --> encode["Serialize query, body, headers"]
  encode --> transport["Configured fetch or global fetch"]
  transport --> response["Typed response interface"]
```

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31), [src/client/client.ts:53-128](repo://src/client/client.ts#L53-L128), [src/client/client.ts:161-170](repo://src/client/client.ts#L161-L170), [src/client/client.ts:214-232](repo://src/client/client.ts#L214-L232), [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80)

## Serialize request arguments

| Argument | Runtime conversion |
| --- | --- |
| query | Uses buildSearchParams, defaulting to URLSearchParams with repeated array entries |
| form | Builds FormData, skips undefined values, appends arrays under repeated names |
| json | JSON.stringify plus application/json Content-Type when the value is truthy |
| param | Replaces named path placeholders |
| header | Supplies request headers before option-level headers |
| cookie | Serializes each cookie and joins the generated values into Cookie |

Sources: [src/client/client.ts:53-118](repo://src/client/client.ts#L53-L118), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

Form serialization leaves boundary handling to FormData. If both form and a truthy json value are supplied at runtime, JSON is processed later and becomes the body. The implementation tests json by truthiness, so false, zero, an empty string, or null do not enter that branch. GET and HEAD explicitly omit a body from the generated fetch options, independently of the arguments supplied.

Sources: [src/client/client.ts:64-84](repo://src/client/client.ts#L64-L84), [src/client/client.ts:119-128](repo://src/client/client.ts#L119-L128)

Path replacement substitutes the provided value directly and removes a placeholder when its supplied value is falsy; it does not call encodeURIComponent on path parameters. Query values are encoded by URLSearchParams. Trailing index segments are removed before transport, allowing the type-level `index` property to represent root endpoints. These rules also affect the URL-building helpers.

Sources: [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60), [src/client/client.ts:110-118](repo://src/client/client.ts#L110-L118)

## Override transport and headers

ClientRequestOptions can provide fetch, a WebSocket factory, query serialization, headers, and RequestInit. Headers can be a record or an asynchronous producer. When both base and per-call header options exist, the client resolves both and gives per-call entries precedence. It then deep-merges base and request options before executing the request. This supports context-dependent credentials without changing each endpoint's data argument.

Sources: [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65), [src/client/client.ts:218-229](repo://src/client/client.ts#L218-L229), [src/client/utils.ts:66-82](repo://src/client/utils.ts#L66-L82)

The final fetch initialization spreads `options.init` last. It can therefore replace the generated body, method, or headers completely. Use the dedicated headers option for additive header behavior. The transport receives a URL string, a choice explicitly made for testing integrations, and returns the fetch response directly. [[Testing and Development]] uses this extension point to route typed calls into `app.request`.

Sources: [src/client/types.ts:35-41](repo://src/client/types.ts#L35-L41), [src/client/client.ts:91-128](repo://src/client/client.ts#L91-L128), [src/helper/testing/index.ts:15-27](repo://src/helper/testing/index.ts#L15-L27)

## Build URLs and open sockets

`$url` and `$path` apply optional parameters and query arguments without making a request. The first returns a URL object, so its resulting value must be acceptable to the URL constructor; the second returns the path relative to the base. A custom buildSearchParams option participates in both these helpers and normal HTTP serialization.

Sources: [src/client/client.ts:137-139](repo://src/client/client.ts#L137-L139), [src/client/client.ts:169-186](repo://src/client/client.ts#L169-L186), [src/client/client.ts:214-216](repo://src/client/client.ts#L214-L216)

`$ws` changes the URL protocol from HTTP to WebSocket, substitutes path parameters, appends query values, and creates a socket through the configured factory or native WebSocket. Its query path explicitly appends arrays instead of invoking the custom HTTP query serializer. The typed method is exposed for GET routes with the ws output format. [[Streaming and WebSockets]] describes the server-side upgrade and event contracts.

Sources: [src/client/client.ts:187-212](repo://src/client/client.ts#L187-L212), [src/client/types.ts:112-118](repo://src/client/types.ts#L112-L118)

## Read and narrow responses

ClientResponse describes status, ok, headers, and standard body readers. Its JSON reader returns the schema's data type for JSON endpoints, while its text reader preserves text response types. InferRequestType extracts a method's request argument, and InferResponseType can filter by status. These are compile-time views of the returned response; the ordinary client call does not throw solely because the HTTP status is unsuccessful.

Sources: [src/client/types.ts:128-154](repo://src/client/types.ts#L128-L154), [src/client/types.ts:251-271](repo://src/client/types.ts#L251-L271), [src/client/client.ts:122-128](repo://src/client/client.ts#L122-L128)

`parseResponse` adds a separate consumption policy. It awaits a response, reads JSON for a matching JSON content type and text otherwise, skips known null-body statuses, and throws DetailedError for a non-ok response. The error includes statusCode plus parsed data and statusText in detail. A body parsing failure can occur before that status-based error construction. Successful empty responses yield undefined.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:7-44](repo://src/client/fetch-result-please.ts#L7-L44), [src/client/fetch-result-please.ts:64-95](repo://src/client/fetch-result-please.ts#L64-L95)

ApplyGlobalResponse adds response definitions to every route's type, while PickResponseByStatusCode retains selected status variants. These type transformations do not install runtime handlers or change transport behavior. They let a client describe central response handling while the actual error conversion remains the responsibility of the application or custom fetch implementation.

Sources: [src/client/types.ts:332-393](repo://src/client/types.ts#L332-L393)

