---
title: "Runtime and Connection Info"
---
## Overview

Two facts about a request depend on where the app runs: which runtime it is, with the environment variables that runtime offers, and who the client is, with the address the connection came from. Hono answers the first with the adapter helper, `hono/adapter`, which detects the runtime from globals and reads variables accordingly. It answers the second with one `getConnInfo(c)` function per runtime adapter, all returning the same `ConnInfo` shape described by `hono/conninfo`.

Sources: [src/helper/adapter/index.ts:1-90](repo://src/helper/adapter/index.ts#L1-L90), [src/helper/conninfo/types.ts:1-45](repo://src/helper/conninfo/types.ts#L1-L45)

## Detecting the runtime

`getRuntimeKey()` returns one of `node`, `deno`, `bun`, `workerd`, `fastly`, `edge-light` or `other`, checking in this order:

Sources: [src/helper/adapter/index.ts:8-8](repo://src/helper/adapter/index.ts#L8-L8), [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

1. If `navigator.userAgent` is a string, a user agent starting with `Deno`, `Bun`, `Cloudflare-Workers` or `Node.js` gives `deno`, `bun`, `workerd` or `node`.
2. A string `EdgeRuntime` global gives `edge-light`.
3. A `fastly` global gives `fastly`.
4. `process.release.name === 'node'` gives `node`; a comment notes that `navigator.userAgent` is missing before Node v21.1.0.
5. Otherwise `other`.

Sources: [src/helper/adapter/index.ts:8-8](repo://src/helper/adapter/index.ts#L8-L8), [src/helper/adapter/index.ts:43-90](repo://src/helper/adapter/index.ts#L43-L90)

Hono uses it internally too: the JWT code checks for `node` to find the right `CryptoKey` class ([[JWT and JWK]]).

Sources: [src/utils/jwt/jws.ts:226-234](repo://src/utils/jwt/jws.ts#L226-L234)

## Reading environment variables

`env(c, runtime?)` returns the environment variables as an object, with the runtime detected unless one is passed:

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

| Runtime | Source |
| --- | --- |
| `node`, `bun`, `edge-light` | `process.env` |
| `deno` | `Deno.env.toObject()` |
| `workerd` | `c.env`, the Worker's bindings |
| `fastly`, `other` | `{}`; a comment points Fastly users to its ConfigStore |

Sources: [src/helper/adapter/index.ts:10-41](repo://src/helper/adapter/index.ts#L10-L41)

```ts
import { env } from 'hono/adapter'

app.get('/env', (c) => {
  const { NAME } = env<{ NAME: string }>(c)
  return c.text(NAME)
})
```

Sources: [src/helper/adapter/index.ts:10-18](repo://src/helper/adapter/index.ts#L10-L18)

The type parameter `T` describes the variables, and the return type is `T & C['env']`, so the app's own `Bindings` stay typed alongside them ([[Route Types and Schema]]). Code written this way reads `process.env` on Node.js and bindings on Cloudflare without branching.

Sources: [src/helper/adapter/index.ts:10-18](repo://src/helper/adapter/index.ts#L10-L18)

## The ConnInfo shape

```ts
export interface ConnInfo {
  remote: NetAddrInfo
}

export type GetConnInfo = (c: Context) => ConnInfo
```

Sources: [src/helper/conninfo/types.ts:32-45](repo://src/helper/conninfo/types.ts#L32-L45)

`NetAddrInfo` has optional `address`, `addressType` (`IPv4`, `IPv6` or `undefined`), `port` and `transport` (`tcp` or `udp`). Every field may be missing, because not every runtime knows every one.

Sources: [src/helper/conninfo/types.ts:1-30](repo://src/helper/conninfo/types.ts#L1-L30)

`GetConnInfo` is also the type `ipRestriction` accepts as its first argument, so any adapter's `getConnInfo` plugs straight into it ([[Security Middleware]]). When the adapter gives no `addressType`, `ipRestriction` works it out from the address.

Sources: [src/middleware/ip-restriction/index.ts:23-23](repo://src/middleware/ip-restriction/index.ts#L23-L23), [src/middleware/ip-restriction/index.ts:238-247](repo://src/middleware/ip-restriction/index.ts#L238-L247)

## Per-runtime getConnInfo

| Adapter | Where the address comes from | Other fields |
| --- | --- | --- |
| `hono/bun` | `server.requestIP(c.req.raw)` | `addressType` from `family`, `port` |
| `hono/deno` | `c.env.remoteAddr.hostname` | `port`, `transport` |
| `hono/cloudflare-workers`, `hono/cloudflare-pages` | The `cf-connecting-ip` header | |
| `hono/aws-lambda` | `requestContext.identity.sourceIp` (API Gateway v1), `requestContext.http.sourceIp` (v2), else the last `x-forwarded-for` entry (ALB) | |
| `hono/lambda-edge` | `event.Records[0].cf.request.clientIp` | |
| `hono/netlify` | `c.env.context.ip` | |
| `hono/vercel` | The `x-real-ip` header | |

Sources: [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43), [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/cloudflare-workers/conninfo.ts:1-7](repo://src/adapter/cloudflare-workers/conninfo.ts#L1-L7), [src/adapter/cloudflare-pages/conninfo.ts:22-26](repo://src/adapter/cloudflare-pages/conninfo.ts#L22-L26), [src/adapter/aws-lambda/conninfo.ts:45-73](repo://src/adapter/aws-lambda/conninfo.ts#L45-L73), [src/adapter/lambda-edge/conninfo.ts:11-15](repo://src/adapter/lambda-edge/conninfo.ts#L11-L15), [src/adapter/netlify/conninfo.ts:53-57](repo://src/adapter/netlify/conninfo.ts#L53-L57), [src/adapter/vercel/conninfo.ts:1-8](repo://src/adapter/vercel/conninfo.ts#L1-L8)

The adapters that read `c.env` rely on what the runtime or the Hono adapter passed as the second argument of `fetch`. The Lambda and Lambda@Edge handlers put `requestContext` and `event` into the bindings themselves ([[AWS Lambda and Lambda@Edge]]).

Sources: [src/adapter/deno/conninfo.ts:8-17](repo://src/adapter/deno/conninfo.ts#L8-L17), [src/adapter/aws-lambda/conninfo.ts:14-18](repo://src/adapter/aws-lambda/conninfo.ts#L14-L18), [src/adapter/lambda-edge/conninfo.ts:5-9](repo://src/adapter/lambda-edge/conninfo.ts#L5-L9)

On Bun, `getBunServer(c)` must find the server in `c.env`, as for [[WebSockets]]; otherwise the function throws `env has to include the 2nd argument of fetch.`. A server without `requestIP` throws `server.requestIP is not a function.`. When `requestIP` returns `null`, for closed requests or Unix domain sockets as the comment says, the result is `{ remote: {} }`.

Sources: [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43), [src/adapter/bun/server.ts:13-14](repo://src/adapter/bun/server.ts#L13-L14)

For the ALB case, a comment explains that the load balancer appends the real client IP to the end of `X-Forwarded-For`, which is why the last entry is taken.

Sources: [src/adapter/aws-lambda/conninfo.ts:58-66](repo://src/adapter/aws-lambda/conninfo.ts#L58-L66), [src/adapter/vercel/conninfo.ts:3-8](repo://src/adapter/vercel/conninfo.ts#L3-L8)

```ts
import { getConnInfo } from 'hono/bun'

app.get('/ip', (c) => {
  const info = getConnInfo(c)
  return c.text(`Your address is ${info.remote.address}`)
})
```

Sources: [src/adapter/bun/conninfo.ts:10-43](repo://src/adapter/bun/conninfo.ts#L10-L43)
