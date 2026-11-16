---
title: "RPC Client"
---
## Overview

`hc` from `hono/client` turns an app's type into a typed HTTP client. The server exports `typeof app`; the client calls `hc<AppType>(baseUrl)` and gets an object whose properties follow the route paths and whose `$get`, `$post`, … methods take the route's declared inputs and return responses typed with its outputs. At run time the client is a JavaScript `Proxy` that builds URLs and calls `fetch`; everything else is types read from the app's schema ([[Route Types and Schema]]).

Sources: [src/client/client.ts:133-232](repo://src/client/client.ts#L133-L232), [src/client/index.ts:1-17](repo://src/client/index.ts#L1-L17)

```ts
// server
const app = new Hono().post(
  '/posts/:id/comments',
  validator('json', (v) => v as { body: string }),
  (c) => c.json({ ok: true, id: c.req.param('id') }, 201)
)
export type AppType = typeof app

// client
import { hc } from 'hono/client'

const client = hc<AppType>('http://localhost:8787')
const res = await client.posts[':id'].comments.$post({
  param: { id: '1' },
  json: { body: 'Hello' },
})
const data = await res.json() // { ok: boolean; id: string }
```

Sources: [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318), [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80)

## How the proxy builds a call

`createProxy` wraps an empty function in a `Proxy`. Reading any string property returns a new proxy with that key appended to the path, so `client.posts[':id'].comments` records `['posts', ':id', 'comments']`. Reading `then` returns `undefined`, so `await client.posts` does not treat the proxy as a promise. Calling a proxy invokes the callback with the collected path and the call's arguments.

Sources: [src/client/client.ts:15-31](repo://src/client/client.ts#L15-L31)

The callback in `hc` then decides what the call means:

Sources: [src/client/client.ts:137-232](repo://src/client/client.ts#L137-L232), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16)

1. `toString()` and `valueOf()` are answered locally; `.name.toString()` returns the previous path segment.
2. A last segment starting with `$` is popped and becomes the method, so `$post` means `post`.
3. The remaining segments are joined with `/` and appended to the base URL with one slash between.
4. `$url` and `$path` build a URL without a request (next section), and `$ws` opens a WebSocket.
5. Any other method creates a `ClientRequestImpl` and calls its `fetch` with the arguments and the merged options.

Sources: [src/client/client.ts:137-232](repo://src/client/client.ts#L137-L232), [src/client/utils.ts:11-16](repo://src/client/utils.ts#L11-L16)

On the type side, `PathToChain` splits each schema path on `/` into nested objects, naming an empty last segment `index`, and puts a `ClientRequest` at the leaf. `ClientRequest` has one method per `$method` key of the endpoint, taking `args` (required when the input has required keys) and optional `ClientRequestOptions`. An `$all` route expands to every standard method.

Sources: [src/client/types.ts:11-28](repo://src/client/types.ts#L11-L28), [src/client/types.ts:67-80](repo://src/client/types.ts#L67-L80), [src/client/types.ts:294-318](repo://src/client/types.ts#L294-L318)

## Serialising the arguments

`ClientRequestImpl.fetch` maps each part of `args` to the request, using the same target names as the [[Validator]]:

Sources: [src/client/client.ts:53-118](repo://src/client/client.ts#L53-L118), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

| Argument | Becomes |
| --- | --- |
| `query` | The search string, built by `buildSearchParams` (arrays repeat the key; `undefined` values are skipped) |
| `form` | A `FormData` body; arrays append one entry per item |
| `json` | A `JSON.stringify` body with `Content-Type: application/json` |
| `param` | Replaces `/:name`, `/:name{pattern}` or `/:name?` in the path; an empty value removes the segment |
| `header` | Request headers |
| `cookie` | A `Cookie` header of serialised pairs with `path=/` |

Sources: [src/client/client.ts:53-118](repo://src/client/client.ts#L53-L118), [src/client/utils.ts:18-44](repo://src/client/utils.ts#L18-L44)

The URL also goes through `removeIndexString`, which drops a trailing `/index` segment so `client.index.$get()` requests `/`. For `GET` and `HEAD`, no body is sent. The request is made with `opt.fetch` or the global `fetch`, passing the URL as a string; the code comments that this keeps testing with MSW and node-fetch working.

Sources: [src/client/client.ts:110-128](repo://src/client/client.ts#L110-L128), [src/client/utils.ts:55-60](repo://src/client/utils.ts#L55-L60)

## Options

`ClientRequestOptions` can be passed to `hc` for every call, and as the second argument of a single call:

Sources: [src/client/types.ts:30-65](repo://src/client/types.ts#L30-L65)

| Option | Effect |
| --- | --- |
| `fetch` | The fetch function to use, for example `app.request` |
| `headers` | An object, or a sync or async function returning one, evaluated on every call |
| `init` | A `RequestInit` spread last, so it can override `body`, `method` and `headers` |
| `buildSearchParams` | Custom query serialisation, for example bracket notation |
| `webSocket` | A factory used by `$ws` instead of `new WebSocket` |

Sources: [src/client/types.ts:30-65](repo://src/client/types.ts#L30-L65)

The two levels are combined with `deepMerge`. When both levels define `headers`, they are first wrapped into one async function that merges the global headers with the call's, so a function at either level still runs per request. Explicit `header` arguments are overridden by option headers with the same name.

Sources: [src/client/client.ts:214-230](repo://src/client/client.ts#L214-L230), [src/client/client.ts:93-96](repo://src/client/client.ts#L93-L96), [src/client/utils.ts:62-82](repo://src/client/utils.ts#L62-L82)

## URLs without a request

`$url(args?)` returns a `URL` and `$path(args?)` returns the path with its query string, relative to the base URL. Both apply `param` and `query` the same way a request would. Their return types are built from the literal path and arguments, so `client.posts[':id'].$path({ param: { id: '1' } })` is typed as `/posts/1`.

Sources: [src/client/client.ts:171-186](repo://src/client/client.ts#L171-L186), [src/client/types.ts:81-112](repo://src/client/types.ts#L81-L112)

`$ws(args?)` is only typed on routes whose `$get` endpoint has the output format `ws`, which the [[WebSockets]] helper declares. It swaps `http` for `ws` in the URL, adds params and query, and opens a socket with `options.webSocket` or `new WebSocket`.

Sources: [src/client/client.ts:187-212](repo://src/client/client.ts#L187-L212), [src/client/types.ts:113-118](repo://src/client/types.ts#L113-L118), [src/client/utils.ts:46-53](repo://src/client/utils.ts#L46-L53)

## Typed responses

Each method returns `Promise<ClientResponse<O, S, F>>`, a `Response`-like type with the endpoint's output, status and format. `ok` is `true` for success statuses and `false` for others, so checking `res.ok` or `res.status` narrows the union of endpoint variants. `json()` returns `Promise<O>` for JSON endpoints and `Promise<never>` for text ones; `text()` returns the literal string type for text endpoints.

Sources: [src/client/types.ts:120-154](repo://src/client/types.ts#L120-L154)

Four helper types read the client or app types:

Sources: [src/client/types.ts:234-292](repo://src/client/types.ts#L234-L292), [src/client/types.ts:332-393](repo://src/client/types.ts#L332-L393)

| Type | Gives |
| --- | --- |
| `InferRequestType<typeof client.posts.$post>` | The `args` the method accepts |
| `InferResponseType<typeof client.posts.$post, 200>` | The output for a status, or for all statuses when omitted |
| `PickResponseByStatusCode<typeof app, 200>` | An app type whose routes keep only that status |
| `ApplyGlobalResponse<typeof app, Def>` | An app type with extra responses, such as a shared 401, added to every route |

Sources: [src/client/types.ts:234-292](repo://src/client/types.ts#L234-L292), [src/client/types.ts:332-393](repo://src/client/types.ts#L332-L393)

## parseResponse

`parseResponse(client.posts.$get())` awaits the response and returns its parsed body. It reads JSON when the `Content-Type` is JSON (including `+json` types) and text otherwise, and skips the body for 101, 204, 205 and 304. If the response is not `ok`, it throws a `DetailedError` whose message is `status statusText` and whose `detail` holds the parsed data. Its return type keeps only the non-error endpoints of the response union. The implementation is a reduced copy of the `fetch-result-please` package, as the file header says.

Sources: [src/client/utils.ts:84-114](repo://src/client/utils.ts#L84-L114), [src/client/fetch-result-please.ts:1-95](repo://src/client/fetch-result-please.ts#L1-L95)

## testClient

`testClient(app, env?, executionCtx?, options?)` from `hono/testing` returns a client for an app without a server. It calls `hc` with the base URL `http://localhost` and a custom `fetch` that forwards to `app.request(input, init, env, executionCtx)` ([[Hono Application]]), so a test gets the same typed calls as a real client.

Sources: [src/helper/testing/index.ts:1-27](repo://src/helper/testing/index.ts#L1-L27)

```ts
import { testClient } from 'hono/testing'

const client = testClient(app)
const res = await client.posts[':id'].comments.$post({
  param: { id: '1' },
  json: { body: 'Hello' },
})
expect(res.status).toBe(201)
```

Sources: [src/helper/testing/index.ts:16-27](repo://src/helper/testing/index.ts#L16-L27)
