---
title: "RPC Client"
---
## Overview

`hc<typeof app>(baseUrl, options)` from `hono/client` returns an object whose properties follow the app's routes: `client.posts[':id'].$get({ param: { id: '1' } })` sends `GET {baseUrl}/posts/1` and returns a `Response` typed with that route's output. At run time the client is a JavaScript `Proxy` that knows nothing about the app; all route knowledge is in the types derived from the app's schema ([[Typed Routes and Schemas]]).

Sources: [src/client/client.ts:132-232](repo://src/client/client.ts#L132-L232), [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318)

## The proxy

### Recording the path

`createProxy` wraps an empty function in a `Proxy`. Reading any string property returns a new proxy with that key appended to the path; reading `then` returns `undefined` so the proxy is not mistaken for a promise when awaited. Calling a proxy hands the collected path and the call arguments to the callback that `hc` supplied.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

### Interpreting a call

The callback looks at the last path segments. `toString` and `valueOf` are answered locally, and `.name.toString()` returns the segment name. A last segment starting with `$` is the method: `$get`, `$post` and so on send a request, while `$url`, `$path` and `$ws` build something else. The remaining segments are joined with `/` and appended to the base URL by `mergePath`, which collapses duplicate slashes at the join.

Sources: [src/client/client.ts:137-170](repo://src/client/client.ts#L137-L170), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16)

| Call | Result |
| --- | --- |
| `$get(args, options)` (any method) | a `fetch` promise for the built request |
| `$url(args)` | a `URL` with params substituted and query appended |
| `$path(args)` | the same path relative to the base URL, starting with `/` |
| `$ws(args)` | a `WebSocket` to the URL with `http` replaced by `ws`, or the result of `options.webSocket` |

Sources: [src/client/client.ts:171-212](repo://src/client/client.ts#L171-L212), [src/client/utils.ts:46-53](repo://src/client/utils.ts#L46-L53)

A path segment named `index` stands for the route `/`: `removeIndexString` drops a trailing `/index` from the URL (keeping the slash right after the host).

Sources: [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60), [src/client/types.ts:294-309](repo://src/client/types.ts#L294-L309)

## Building the request

`ClientRequestImpl.fetch(args, options)` turns the first argument, shaped like the route's validation targets, into a `fetch` call:

Sources: [src/client/client.ts:33-58](repo://src/client/client.ts#L33-L58)

| Argument | Becomes |
| --- | --- |
| `param` | substituted into `/:name`, `/:name{...}` and `/:name?` segments; an empty value removes the segment |
| `query` | `URLSearchParams` from `buildSearchParams`: arrays repeat the key, `undefined` values are skipped |
| `form` | a `FormData` body; arrays append each item, `undefined` entries are skipped |
| `json` | a `JSON.stringify` body with `Content-Type: application/json` |
| `header` | request headers |
| `cookie` | one `Cookie` header of serialized `name=value; Path=/` pairs joined by commas |

Sources: [src/client/client.ts:59-118](repo://src/client/client.ts#L59-L118), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

The body is omitted for `GET` and `HEAD`. Headers from `options.headers` (an object or a function, possibly async) are merged over `args.header`. The request goes to `options.fetch` or the global `fetch`, called with the URL string first, which the code notes is for testing with MSW and node-fetch, and `options.init` is spread last, so it overrides `body`, `method` and `headers`.

Sources: [src/client/client.ts:91-129](repo://src/client/client.ts#L91-L129), [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65)

## Options

| Option | Effect |
| --- | --- |
| `fetch` | replacement for `fetch`, including `app.request` |
| `headers` | default headers, or a function returning them |
| `init` | `RequestInit` applied last |
| `buildSearchParams` | custom query serializer, for example bracket notation |
| `webSocket` | factory used by `$ws` instead of `new WebSocket` |

Sources: [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65)

Options given to `hc` are deep-merged with the per-call options (the second argument of `$get`). When both specify `headers`, the result is an async function that resolves both and spreads the per-call headers over the defaults.

Sources: [src/client/client.ts:214-231](repo://src/client/client.ts#L214-L231), [src/client/utils.ts:62-82](repo://src/client/utils.ts#L62-L82)

## Types

### From schema to properties

`Client<T, Prefix>` takes the schema out of the app type and, for each path, builds nested properties with `PathToChain`: the path is split on `/`, each segment becomes a key, and the empty path becomes `index`. The last level is a `ClientRequest`, which maps every `$method` in the schema to a function. `$all` routes expand to every standard method.

Sources: [src/client/types.ts:8-26](repo://src/client/types.ts#L8-L26), [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318)

Each method function takes the endpoint's `input` as its first argument (required when the input has required keys, optional otherwise) and returns `Promise<ClientResponse<output, status, format>>`. `ClientResponse` mirrors `Response`, with `ok` narrowed to `true` for success codes and `false` otherwise, and `json()` or `text()` typed from the output and format, so narrowing on `res.ok` or `res.status` narrows the body type.

Sources: [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80), [src/client/types.ts:120-154](repo://src/client/types.ts#L120-L154)

`$url()` returns a `TypedURL` when the base URL is a string literal, with `pathname` and `search` computed as types (literal parameter values are substituted), and `$path()` returns the path as a template literal type. `$ws` exists only for routes whose `GET` output format is `ws`, which the WebSocket helper sets ([[WebSockets]]).

Sources: [src/client/types.ts:81-118](repo://src/client/types.ts#L81-L118), [src/client/types.ts:156-230](repo://src/client/types.ts#L156-L230)

### Inference helpers

| Type | Gives |
| --- | --- |
| `InferRequestType<typeof client.x.$post>` | the first argument of a method |
| `InferResponseType<typeof client.x.$post, 200>` | the output for one status code, or all |
| `ApplyGlobalResponse<App, { 401: { json: E } }>` | the app type with extra responses added to every endpoint, for errors produced centrally |
| `PickResponseByStatusCode<App, 200>` | the app type keeping only endpoints of that status |

Sources: [src/client/types.ts:234-292](repo://src/client/types.ts#L234-L292), [src/client/types.ts:332-393](repo://src/client/types.ts#L332-L393)

## Reading responses

`parseResponse(client.x.$get())` awaits the response and reads its body: JSON when `Content-Type` matches `application/json` or `+json`, text otherwise, and nothing for statuses 101, 204, 205 and 304. If `res.ok` is false it throws a `DetailedError` whose message is the status and status text and whose `statusCode` and `detail.data` carry the parsed body. Its return type is the body type of the non-error responses only.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:7-95](repo://src/client/fetch-result-please.ts#L7-L95)

## Testing with testClient

`testClient(app, env, executionCtx, options)` from `hono/testing` returns `hc<typeof app>('http://localhost', ...)` with a `fetch` that calls `app.request(input, init, env, executionCtx)`, so typed calls run in-process without a server ([[Request Lifecycle and Middleware Composition]]).

Sources: [src/helper/testing/index.ts:13-27](repo://src/helper/testing/index.ts#L13-L27)
