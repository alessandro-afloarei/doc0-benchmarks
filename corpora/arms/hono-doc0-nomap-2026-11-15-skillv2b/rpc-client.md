---
title: "RPC Client"
---
## Overview

`hc` from `hono/client` is a typed HTTP client generated from a server app's type, with no code generation step. The server exports `typeof app`; the client calls `hc<AppType>(baseUrl)` and gets an object whose property chain mirrors the routes, with typed arguments and typed responses. At run time the client is a JavaScript `Proxy` that records property names and turns a final `$get(...)`/`$post(...)` call into a `fetch`. The types come from the app's `Schema` ([[Env, Handler and Schema Types]]).

Sources: [src/client/client.ts:133-232](repo://src/client/client.ts#L133-L232), [src/client/index.ts:1-17](repo://src/client/index.ts#L1-L17)

```ts
// server
const route = app
  .get('/posts/:id', (c) => c.json({ id: c.req.param('id'), title: 'Hello' }))
  .post('/posts', validator('json', (v) => v as { title: string }), (c) =>
    c.json({ ok: true }, 201)
  )
export type AppType = typeof route

// client
import { hc } from 'hono/client'
const client = hc<AppType>('http://localhost:8787')

const res = await client.posts[':id'].$get({ param: { id: '1' } })
if (res.ok) {
  const post = await res.json() // { id: string; title: string }
}
await client.posts.$post({ json: { title: 'New' } })
```

Sources: [src/client/client.ts:133-232](repo://src/client/client.ts#L133-L232)

## How the proxy builds a request

### Path from property access

`createProxy(callback, path)` returns a `Proxy` around an empty function. Every property read returns a new proxy with the key appended to `path`; reading `then` returns `undefined` so a proxy is never mistaken for a promise by `await`. Calling the proxy invokes `callback({ path, args })`.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

### Dispatching on the last key

`proxyCallback` inspects the last key of the path.

Sources: [src/client/client.ts:137-140](repo://src/client/client.ts#L137-L140)

| Last key | Result |
| --- | --- |
| `toString`, `valueOf` | The proxy's own function, or with `.name.` before it, the previous key as a string |
| `$url` | A `URL` with params and query applied |
| `$path` | The path string relative to the base URL, with params and query applied |
| `$ws` | A `WebSocket` to the URL with `http` replaced by `ws`, created with `options.webSocket` when given |
| `$<method>` | A request: `ClientRequestImpl.fetch(args, options)` |

Sources: [src/client/client.ts:137-232](repo://src/client/client.ts#L137-L232)

The other keys are joined with `/` and merged with the base URL by the client's own `mergePath`, which collapses slashes at the join. A key `index` stands for the empty path, so `client.index.$get()` requests `/`.

Sources: [src/client/client.ts:161-170](repo://src/client/client.ts#L161-L170), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60)

### Request arguments

`ClientRequestImpl.fetch(args, opt)` maps the first argument's fields, the same names as the validator targets ([[Validator]]), onto the request.

Sources: [src/client/client.ts:53-58](repo://src/client/client.ts#L53-L58)

| Field | Becomes |
| --- | --- |
| `param` | Replaces `/:name`, `/:name{...}` and `/:name?` segments in the URL; an empty value removes the segment |
| `query` | `URLSearchParams` built by `buildSearchParams` (arrays become repeated keys), or the `buildSearchParams` option |
| `json` | `JSON.stringify` body with `Content-Type: application/json` |
| `form` | A `FormData` body; arrays append each item, `undefined` fields are skipped |
| `header` | Request headers |
| `cookie` | A `Cookie` header serialized with the cookie utility |

Sources: [src/client/client.ts:53-129](repo://src/client/client.ts#L53-L129), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

A body is dropped for `GET` and `HEAD`. The final call is `(opt.fetch || fetch)(url, { body, method, headers, ...opt.init })`, with the URL passed as a string so mocking libraries such as MSW see a plain URL.

Sources: [src/client/client.ts:119-128](repo://src/client/client.ts#L119-L128)

## Client options

`hc(baseUrl, options)` takes defaults that each call's second argument can extend. The two are combined with `deepMerge`; when both define `headers`, a function merges them (call-level headers win), and either side may be a function returning headers, possibly async, so auth tokens can be read at call time.

Sources: [src/client/client.ts:214-231](repo://src/client/client.ts#L214-L231), [src/client/utils.ts:62-82](repo://src/client/utils.ts#L62-L82)

| Option | Use |
| --- | --- |
| `headers` | Static headers or a function returning them |
| `fetch` | Replacement `fetch`, for example `app.request` to call the app in process |
| `init` | A `RequestInit` spread last; it can override `body`, `method` and `headers` |
| `buildSearchParams` | Custom query serialization, such as bracket notation |
| `webSocket` | Factory used by `$ws` instead of `new WebSocket` |

Sources: [src/client/types.ts:32-65](repo://src/client/types.ts#L32-L65)

Passing `app.request` as `fetch` is what `testClient` in `hono/testing` does ([[Testing, Route and Dev Helpers]]).

Sources: [src/client/types.ts:28-33](repo://src/client/types.ts#L28-L33)

## Types

### From schema to property chain

`Client<typeof app, Prefix>` takes the app's schema and, for each path, builds nested objects with `PathToChain`: `/posts/:id` becomes `client.posts[':id']`. The leaf is a `ClientRequest`, which has one function per method key in the schema (`$get`, `$post`, and every standard method for routes registered with `all`), plus `$url` and `$path`, and `$ws` for WebSocket routes.

Sources: [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318), [src/client/types.ts:67-118](repo://src/client/types.ts#L67-L118)

Each method's first argument is the endpoint's `input`; it is required when the input has required keys. The return type is `Promise<ClientResponse<output, status, format>>`, a `Response`-like interface whose `json()` returns the output type, whose `status` is the literal status, and whose `ok` is `true` for 2xx statuses and `false` for others. A route with several possible responses yields a union that narrows on `res.ok` or `res.status`.

Sources: [src/client/types.ts:120-154](repo://src/client/types.ts#L120-L154)

### Inferring types for application code

| Type | Gives |
| --- | --- |
| `InferRequestType<typeof client.posts.$post>` | The argument object |
| `InferResponseType<typeof client.posts.$post, 201>` | The body type, optionally for one status |
| `ApplyGlobalResponse<typeof app, { 500: { json: { error: string } } }>` | The app type with responses added to every route, for errors produced by `onError` |
| `PickResponseByStatusCode<typeof app, 200>` | The app type with only some statuses kept |

Sources: [src/client/types.ts:251-282](repo://src/client/types.ts#L251-L282), [src/client/types.ts:332-393](repo://src/client/types.ts#L332-L393)

`ApplyGlobalResponse` exists because responses produced outside a handler's return type, by `onError` or middleware throwing `HTTPException`, never appear in the schema otherwise.

Sources: [src/client/types.ts:358-363](repo://src/client/types.ts#L358-L363)

## parseResponse

`parseResponse(client.posts.$get())` awaits the response, reads the body as JSON when the `Content-Type` is a JSON type and as text otherwise (or not at all for 101, 204, 205 and 304), and returns it. A response that is not `ok` throws a `DetailedError` with `statusCode` and `detail: { data, statusText }`. The return type keeps only the success responses' body type. The implementation is a trimmed copy of `fetch-result-please`.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:1-95](repo://src/client/fetch-result-please.ts#L1-L95)

## Limitations

- The schema is only as complete as the app's type: routes added on separate statements, not chained, are missing ([[Env, Handler and Schema Types]]).
- Large apps produce large types; splitting the app with `route()` and creating clients per sub-app keeps editor performance usable.
- The client never validates responses at run time; types describe what the server code returns, not what a proxy or a different server version might send.

Sources: [src/hono-base.ts:208-232](repo://src/hono-base.ts#L208-L232), [src/client/client.ts:53-129](repo://src/client/client.ts#L53-L129)
