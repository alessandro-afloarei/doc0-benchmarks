---
title: "RPC Client"
---
## Overview

`hc` from `hono/client` is a fetch client whose type comes from the server app's type. A frontend, another service or a test imports only `type AppType = typeof routes` from the server, calls `hc<AppType>(baseUrl)`, and gets an object where `client.posts[':id'].$get({ param: { id: '1' } })` is checked against the route's inputs and returns a response whose `json()` is typed with the route's output. There is no code generation: the types come from the schema described in [[Typed Routes and Schemas]], and at run time the client is a `Proxy` that turns property access into a URL.

Sources: [src/client/client.ts:133-232](repo://src/client/client.ts#L133-L232), [src/client/index.ts:1-17](repo://src/client/index.ts#L1-L17)

```ts
import { hc } from 'hono/client'
import type { AppType } from '../server'

const client = hc<AppType>('http://localhost:8787')

const res = await client.posts[':id'].$get({ param: { id: '1' } })
if (res.ok) {
  const post = await res.json()
}
```

Sources: [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318)

## The proxy at run time

`createProxy(callback, path)` returns a `Proxy` around an empty function. Each property access returns a new proxy with the key appended to the path; `then` and symbol keys return `undefined`, so the proxy is not mistaken for a promise when awaited. Calling a proxy invokes the callback with the collected path and the call's arguments.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

The callback in `hc` interprets the last path element:

Sources: [src/client/client.ts:137-167](repo://src/client/client.ts#L137-L167)

| Last element | Result |
| --- | --- |
| `toString`, `valueOf` | Support for printing and coercing the proxy; `x.name.toString()` returns the path segment `x` |
| `$url(args?)` | A `URL` with params substituted and the query appended |
| `$path(args?)` | The same as a path string relative to the base URL |
| `$ws(args?)` | A `WebSocket` to the URL with `http` replaced by `ws` (or `options.webSocket(...)`) |
| `$get`, `$post`, any `$method` | Sends the request and returns the `fetch` promise |
| anything else | A `ClientRequestImpl` without sending |

Sources: [src/client/client.ts:161-231](repo://src/client/client.ts#L161-L231)

The path segments are joined with `/` and appended to the base URL with the client's own `mergePath`, which trims slashes on both sides. A route at `/` is reached as `client.index`, and `removeIndexString` drops the trailing `/index` before sending.

Sources: [src/client/client.ts:169-170](repo://src/client/client.ts#L169-L170), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60)

## Building the request

`ClientRequestImpl.fetch(args, options)` turns the typed arguments into a standard `fetch` call. Each key of `args` matches a validation target from [[Validator]]:

Sources: [src/client/client.ts:53-129](repo://src/client/client.ts#L53-L129)

| Argument | Effect |
| --- | --- |
| `param` | Replaces `/:name`, `/:name{...}` or `/:name?` in the URL; an empty value removes the segment |
| `query` | Serialized with `buildSearchParams`: arrays become repeated keys, `undefined` is skipped |
| `json` | `JSON.stringify` as the body, with `Content-Type: application/json` |
| `form` | A `FormData` body; arrays append one entry per item |
| `header` | Request headers |
| `cookie` | Each pair serialized with `serialize(key, value, { path: '/' })`, joined with commas into `Cookie` |

Sources: [src/client/client.ts:59-108](repo://src/client/client.ts#L59-L108), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

The method is upper-cased and the body is dropped for `GET` and `HEAD`. The request is sent with `options.fetch` if given, otherwise the global `fetch`, and the URL is passed as a string so mocking libraries that patch `fetch` see it. `options.init` is spread last, so it can override the method, body and headers Hono computed.

Sources: [src/client/client.ts:110-128](repo://src/client/client.ts#L110-L128)

## Client options

`hc(baseUrl, options)` accepts `ClientRequestOptions`, and each call can pass the same options as its second argument. The two are combined with `deepMerge`; when both define `headers`, they are merged into one async function that resolves each side (objects or functions) and spreads the per-call headers over the global ones.

Sources: [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65), [src/client/client.ts:214-230](repo://src/client/client.ts#L214-L230), [src/client/utils.ts:66-82](repo://src/client/utils.ts#L66-L82)

| Option | Use |
| --- | --- |
| `fetch` | A custom `fetch`, or `app.request` to call an app in-process (as `testClient` does) |
| `headers` | An object or a (possibly async) function, for example to add a fresh auth token per call |
| `init` | Extra `RequestInit` fields such as `credentials` or `signal` |
| `buildSearchParams` | Custom query serialization, such as `key[]=a` bracket style |
| `webSocket` | A factory used by `$ws` instead of `new WebSocket` |

Sources: [src/client/types.ts:30-65](repo://src/client/types.ts#L30-L65), [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)

## Types

### From schema to client

`Client<T, Prefix>` extracts the schema `S` from the app type and maps every path through `PathToChain`, which splits the path on `/` into nested object keys (`''` becomes `index`). At the leaf, `ClientRequest` maps each `$method` of the endpoint to a function whose first argument is the endpoint's `input`; the argument is required only if the input has required keys. `$all` routes are expanded to every standard method.

Sources: [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318), [src/client/types.ts:67-118](repo://src/client/types.ts#L67-L118), [src/client/types.ts:11-27](repo://src/client/types.ts#L11-L27)

The return type is `ClientResponse<Output, Status, Format>`, a `Response` look-alike whose `status` is the literal status, whose `ok` is `true` only for success statuses, and whose `json()` or `text()` returns the output type for the matching format. Because a route's outputs are a union with one member per status, checking `res.ok` or `res.status === 404` narrows the body type.

Sources: [src/client/types.ts:120-154](repo://src/client/types.ts#L120-L154)

`$url` and `$path` go further: when the base URL and route are literals, `HonoURL` and `BuildPath` compute the resulting URL or path as a string literal type, with params substituted.

Sources: [src/client/types.ts:156-230](repo://src/client/types.ts#L156-L230)

### Helper types

| Type | Use |
| --- | --- |
| `InferRequestType<typeof client.posts.$post>` | The argument object of a call |
| `InferResponseType<typeof client.posts.$post, 200>` | The output for a status, or for all statuses |
| `PickResponseByStatusCode<typeof app, 200>` | An app type with only that status, for clients whose `fetch` throws on errors |
| `ApplyGlobalResponse<typeof app, { 401: { json: { error: string } } }>` | Adds responses every route can produce, such as an auth middleware's 401 |

Sources: [src/client/types.ts:239-283](repo://src/client/types.ts#L239-L283), [src/client/types.ts:332-393](repo://src/client/types.ts#L332-L393)

## parseResponse and DetailedError

`parseResponse(client.posts.$get())` awaits the response and returns its parsed body: JSON when `Content-Type` is `application/json` or `application/*+json`, text otherwise, and nothing for 101, 204, 205 and 304. If the response is not `ok` it throws a `DetailedError` whose message is `status statusText`, whose `statusCode` is the status and whose `detail` holds the parsed body and status text. Its return type keeps only the non-error responses of the route.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:7-95](repo://src/client/fetch-result-please.ts#L7-L95)

## Keeping types fast

Every route's types are recomputed wherever the client is used, so large apps can slow down the editor. Splitting the app into sub-apps with `route()` keeps each piece's schema small (see [[The Hono Application]]), and compiling the server's `AppType` to a declaration file lets clients read a precomputed type. `testClient` from [[Helper Catalogue]] uses the same client against `app.request`.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232), [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)
