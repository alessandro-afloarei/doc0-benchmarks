---
title: "RPC Client"
---
## Overview

`hc` from `hono/client` is a `fetch` wrapper whose type is computed from the server app's type. The server exports `typeof app` (or the value returned by a chain of routes); the client imports only that type, so no server code is bundled and no code is generated. At runtime `hc` is a JavaScript `Proxy` that turns property accesses into a URL and the final method call into a `fetch`. The schema the client reads is built as described on [[Type System and Route Schemas]].

Sources: [src/client/client.ts:132-232](repo://src/client/client.ts#L132-L232), [src/client/index.ts:1-17](repo://src/client/index.ts#L1-L17)

```ts
// server.ts
const route = app
  .get('/posts/:id', (c) => c.json({ id: c.req.param('id'), title: 'Hello' }))
  .post('/posts', validator('json', (v) => v as { title: string }), (c) =>
    c.json({ ok: true }, 201)
  )
export type AppType = typeof route

// client.ts
import { hc } from 'hono/client'
const client = hc<AppType>('https://api.example.com')

const res = await client.posts[':id'].$get({ param: { id: '1' } })
if (res.ok) {
  const post = await res.json() // { id: string; title: string }
}
await client.posts.$post({ json: { title: 'New' } })
```

Sources: [src/client/client.ts:133-137](repo://src/client/client.ts#L133-L137), [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318)

## The proxy

`createProxy(callback, path)` returns a `Proxy` around an empty function. Reading any string property returns a new proxy with that key appended to `path`; reading `then` returns `undefined` so the proxy is not mistaken for a promise when awaited. Calling the proxy invokes the callback with the collected path and the call arguments.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

The `hc` callback inspects the last key. A key starting with `$` is the method: it is removed and the remaining keys are joined with `/` and merged onto the base URL. So `client.posts[':id'].$get(...)` becomes `GET {base}/posts/:id`, with parameters filled in later. `toString` and `valueOf` are handled so the proxy can be printed, and `.name.toString()` returns the segment name.

Sources: [src/client/client.ts:137-170](repo://src/client/client.ts#L137-L170), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16)

| Final call | Result |
| --- | --- |
| `$get(args, options)`, `$post`, any `$method` | A `fetch` through `ClientRequestImpl`, returns a typed `ClientResponse` |
| `$url(args)` | A `URL` with parameters and query applied |
| `$path(args)` | The path and query string without the origin |
| `$ws(args)` | A `WebSocket` to the `ws:` or `wss:` URL, through `options.webSocket` when given |

Sources: [src/client/client.ts:171-231](repo://src/client/client.ts#L171-L231)

## Building the request

`ClientRequestImpl.fetch(args, options)` turns the typed arguments into a standard request.

Sources: [src/client/client.ts:33-58](repo://src/client/client.ts#L33-L58)

| Argument | What it becomes |
| --- | --- |
| `param` | Replaces `/:name`, `/:name{regex}` or `/:name?` in the URL; an empty value removes the segment |
| `query` | `URLSearchParams` from `buildSearchParams`; arrays become repeated keys, `undefined` is skipped |
| `json` | `JSON.stringify` body with `Content-Type: application/json` |
| `form` | A `FormData` body; arrays append several values |
| `header` | Request headers |
| `cookie` | A `Cookie` header of serialised `name=value` pairs |

Sources: [src/client/client.ts:59-108](repo://src/client/client.ts#L59-L108), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

The URL then has a trailing `/index` removed (a route at `/` is reached as `client.index`), parameters replaced and the query appended. The body is dropped for `GET` and `HEAD`. The call goes to `options.fetch` or the global `fetch`, with the URL passed as a string so mocking libraries can intercept it, and `options.init` is spread last so it can override method, headers or body.

Sources: [src/client/client.ts:110-129](repo://src/client/client.ts#L110-L129), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60)

## Options

`hc(baseUrl, options)` takes defaults that every call inherits, and each call can pass its own options as the second argument. The two are deep-merged; when both define `headers`, they are combined into one async function so a function-valued header set (for a token refreshed per call) still works.

Sources: [src/client/client.ts:214-231](repo://src/client/client.ts#L214-L231), [src/client/utils.ts:66-82](repo://src/client/utils.ts#L66-L82)

| Option | Use |
| --- | --- |
| `headers` | An object or a (possibly async) function returning one |
| `fetch` | A custom `fetch`, or `app.request` to call an app in-process |
| `init` | A `RequestInit` applied last, overriding what Hono sets |
| `buildSearchParams` | Custom query serialisation, for example bracket notation |
| `webSocket` | A factory used by `$ws` instead of `new WebSocket` |

Sources: [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65)

`testClient(app)` from `hono/testing` is `hc` with `fetch` set to `app.request`; see [[Helpers Catalogue]].

Sources: [src/helper/testing/index.ts:15-27](repo://src/helper/testing/index.ts#L15-L27)

## Client types

### From schema to property chain

`Client<T, Prefix>` extracts the schema from the app type and runs `PathToChain` on each path: the path is split on `/` into nested properties, an empty last segment becomes `index`, and the leaf is a `ClientRequest` for that path. `ClientRequest` maps each `$method` entry of the schema to a function. When the endpoint's input has required keys, `args` is required; otherwise it is optional. An `$all` route is expanded to every standard method.

Sources: [src/client/types.ts:11-27](repo://src/client/types.ts#L11-L27), [src/client/types.ts:67-118](repo://src/client/types.ts#L67-L118), [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318)

### Responses

The function returns `ClientResponse<Output, Status, Format>`, a `Response` look-alike whose `status` is the literal status and whose `ok` is `true` for 2xx statuses and `false` otherwise. `json()` returns the output type for a `json` format and `never` for text; `text()` does the reverse. When a route can answer with several statuses, the result is a union, so checking `res.ok` or `res.status` narrows `res.json()` to the matching body.

Sources: [src/client/types.ts:120-154](repo://src/client/types.ts#L120-L154)

### Inference helpers

| Type | Gives |
| --- | --- |
| `InferRequestType<typeof client.posts.$post>` | The `args` object a call takes |
| `InferResponseType<typeof client.posts.$post, 201>` | The body type, optionally for one status |
| `ApplyGlobalResponse<typeof app, { 401: { json: { error: string } } }>` | An app type where every route can also return the given responses, for errors added by global middleware or `onError` |
| `PickResponseByStatusCode<typeof app, 200>` | An app type keeping only the given status, for clients whose `fetch` handles errors centrally |

Sources: [src/client/types.ts:239-292](repo://src/client/types.ts#L239-L292), [src/client/types.ts:332-393](repo://src/client/types.ts#L332-L393)

## parseResponse

`parseResponse(client.posts.$get())` awaits the response and returns its body, parsed as JSON when the content type is JSON (including `+json` types) and as text otherwise; 101, 204, 205 and 304 responses have no body. A response that is not `ok` throws a `DetailedError` with `statusCode` and `detail.data` holding the parsed error body. Its return type keeps only the non-error variants of the response union.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:7-95](repo://src/client/fetch-result-please.ts#L7-L95)
