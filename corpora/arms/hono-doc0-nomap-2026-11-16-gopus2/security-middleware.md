---
title: "Security Middleware"
---
## Overview

Five built-in middleware protect an application at the HTTP level, each from its own entry point. Two answer browser security models (`cors` for cross-origin reads, `csrf` for cross-site form posts), one sets protective response headers (`secureHeaders`), one filters by client address (`ipRestriction`), and one caps request size (`bodyLimit`). The ones that refuse a request throw an `HTTPException` carrying the refusal response, which the app's error handler returns as described in [[Request Lifecycle and Middleware]]. Credentials are checked by the middleware in [[Authentication Middleware]] and [[JWT and JWK]].

Sources: [src/middleware/cors/index.ts:63-157](repo://src/middleware/cors/index.ts#L63-L157), [src/middleware/csrf/index.ts:94-151](repo://src/middleware/csrf/index.ts#L94-L151), [src/middleware/secure-headers/secure-headers.ts:179-229](repo://src/middleware/secure-headers/secure-headers.ts#L179-L229), [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279), [src/middleware/body-limit/index.ts:50-111](repo://src/middleware/body-limit/index.ts#L50-L111)

| Middleware | Import | Protects against | Refusal |
| --- | --- | --- | --- |
| `cors` | `hono/cors` | Browsers reading responses from other origins without permission | None; it answers preflights with 204 |
| `csrf` | `hono/csrf` | Cross-site form submissions | 403 |
| `secureHeaders` | `hono/secure-headers` | Clickjacking, MIME sniffing, missing CSP and similar | None; it only sets headers |
| `ipRestriction` | `hono/ip-restriction` | Clients outside an allow list or inside a deny list | 403 |
| `bodyLimit` | `hono/body-limit` | Oversized request bodies | 413 |

Sources: [src/middleware/cors/index.ts:143-147](repo://src/middleware/cors/index.ts#L143-L147), [src/middleware/csrf/index.ts:145-146](repo://src/middleware/csrf/index.ts#L145-L146), [src/middleware/ip-restriction/index.ts:231-236](repo://src/middleware/ip-restriction/index.ts#L231-L236), [src/middleware/body-limit/index.ts:51-58](repo://src/middleware/body-limit/index.ts#L51-L58)

## cors

`cors(options)` defaults to `origin: '*'` and to allowing `GET`, `HEAD`, `PUT`, `POST`, `DELETE` and `PATCH`. `origin` can be a single origin, a list, or a function `(origin, c)` returning the origin to allow or nothing; `allowMethods` can also be a function of the origin. Other options are `allowHeaders`, `exposeHeaders`, `maxAge` and `credentials`.

Sources: [src/middleware/cors/index.ts:9-22](repo://src/middleware/cors/index.ts#L9-L22), [src/middleware/cors/index.ts:63-94](repo://src/middleware/cors/index.ts#L63-L94)

On every request it sets `Access-Control-Allow-Origin` to the allowed origin (nothing when the request's origin is not allowed), plus `Access-Control-Allow-Credentials` and `Access-Control-Expose-Headers` when configured. For `OPTIONS` it answers the preflight itself without calling `next()`: it adds `Access-Control-Max-Age`, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` (echoing the request's `Access-Control-Request-Headers` when `allowHeaders` is empty), and returns a 204 with those headers. For other methods it calls `next()` and then appends `Vary: Origin` whenever the origin is not `*`, so caches keep per-origin copies.

Sources: [src/middleware/cors/index.ts:96-157](repo://src/middleware/cors/index.ts#L96-L157)

## csrf

`csrf(options)` blocks a request only when all four conditions hold:

Sources: [src/middleware/csrf/index.ts:12-30](repo://src/middleware/csrf/index.ts#L12-L30), [src/middleware/csrf/index.ts:94-151](repo://src/middleware/csrf/index.ts#L94-L151)

1. The method is not `GET` or `HEAD`.
2. The content type is one an HTML form can send: `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain` (a missing content type counts as `text/plain`).
3. The `Sec-Fetch-Site` header is missing, invalid, or not allowed. By default only `same-origin` is allowed; the `secFetchSite` option takes a value, a list, or a function.
4. The `Origin` header is missing or not allowed. By default only the request URL's own origin is allowed; the `origin` option takes an origin, a list, or a function.

Sources: [src/middleware/csrf/index.ts:12-30](repo://src/middleware/csrf/index.ts#L12-L30), [src/middleware/csrf/index.ts:94-151](repo://src/middleware/csrf/index.ts#L94-L151)

A request passes when either header check succeeds, so modern browsers are judged by `Sec-Fetch-Site` and older ones by `Origin`. A request with any other content type, such as `application/json`, is never blocked. A blocked request gets a 403 `Forbidden` through an `HTTPException`.

Sources: [src/middleware/csrf/index.ts:138-151](repo://src/middleware/csrf/index.ts#L138-L151)

## secureHeaders

### Default headers

`secureHeaders(options)` sets a list of headers after the handler runs. Each option is `true` (the default value), `false` (off), or a string replacing the value. All are on by default except `Cross-Origin-Embedder-Policy`, and `X-Powered-By` is removed unless `removePoweredBy` is false.

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124), [src/middleware/secure-headers/secure-headers.ts:215-238](repo://src/middleware/secure-headers/secure-headers.ts#L215-L238)

| Option | Header | Default value |
| --- | --- | --- |
| `crossOriginEmbedderPolicy` (off) | `Cross-Origin-Embedder-Policy` | `require-corp` |
| `crossOriginResourcePolicy` | `Cross-Origin-Resource-Policy` | `same-origin` |
| `crossOriginOpenerPolicy` | `Cross-Origin-Opener-Policy` | `same-origin` |
| `originAgentCluster` | `Origin-Agent-Cluster` | `?1` |
| `referrerPolicy` | `Referrer-Policy` | `no-referrer` |
| `strictTransportSecurity` | `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `xContentTypeOptions` | `X-Content-Type-Options` | `nosniff` |
| `xDnsPrefetchControl` | `X-DNS-Prefetch-Control` | `off` |
| `xDownloadOptions` | `X-Download-Options` | `noopen` |
| `xFrameOptions` | `X-Frame-Options` | `SAMEORIGIN` |
| `xPermittedCrossDomainPolicies` | `X-Permitted-Cross-Domain-Policies` | `none` |
| `xXssProtection` | `X-XSS-Protection` | `0` |

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124), [src/middleware/secure-headers/secure-headers.ts:215-238](repo://src/middleware/secure-headers/secure-headers.ts#L215-L238)

### Content Security Policy and nonces

`contentSecurityPolicy` and `contentSecurityPolicyReportOnly` take directives in camel case (`scriptSrc`, `defaultSrc`…), turned into the kebab-case header. A directive value may contain functions `(ctx, directive) => string`, evaluated per request before `next()`. The exported `NONCE` is such a function: it generates 16 random bytes in Base64 once per request, stores them as `secureHeadersNonce` on the context, and returns `'nonce-...'`. Because the nonce is computed before the handler runs, the handler can read `c.get('secureHeadersNonce')` and put it on its `<script>` tags, for example through the `StreamingContext` described in [[JSX Streaming and Suspense]].

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:184-198](repo://src/middleware/secure-headers/secure-headers.ts#L184-L198), [src/middleware/secure-headers/secure-headers.ts:240-288](repo://src/middleware/secure-headers/secure-headers.ts#L240-L288)

```ts
import { secureHeaders, NONCE } from 'hono/secure-headers'

app.use(
  secureHeaders({
    contentSecurityPolicy: {
      scriptSrc: [NONCE, 'https://allowed1.example.com'],
    },
  })
)
```

Sources: [src/middleware/secure-headers/secure-headers.ts:137-145](repo://src/middleware/secure-headers/secure-headers.ts#L137-L145), [src/middleware/secure-headers/secure-headers.ts:179-198](repo://src/middleware/secure-headers/secure-headers.ts#L179-L198)

### Other policies

`permissionsPolicy` maps camel-case features to `true` (`*`), `false` (`none`), or a list of origins, with `self` and `src` left unquoted. `reportingEndpoints` and `reportTo` produce the `Reporting-Endpoints` and `Report-To` headers.

Sources: [src/middleware/secure-headers/secure-headers.ts:200-213](repo://src/middleware/secure-headers/secure-headers.ts#L200-L213), [src/middleware/secure-headers/secure-headers.ts:290-328](repo://src/middleware/secure-headers/secure-headers.ts#L290-L328)

## ipRestriction

### Rules

`ipRestriction(getIP, { denyList, allowList }, onError)` takes a function returning the client address: either a runtime's `getConnInfo` (see [[Runtime Adapters]]) or any `(c) => string`. Each list holds rules: an exact IPv4 or IPv6 address, a CIDR range, `*`, or a function receiving `{ addr, type }`.

Sources: [src/middleware/ip-restriction/index.ts:20-38](repo://src/middleware/ip-restriction/index.ts#L20-L38), [src/middleware/ip-restriction/index.ts:169-225](repo://src/middleware/ip-restriction/index.ts#L169-L225)

`buildMatcher` compiles the rules once. Addresses are converted to `bigint` with the `utils/ipaddr` helpers. A static IPv4 rule also matches its IPv4-mapped IPv6 form (`::ffff:a.b.c.d`) and the reverse, and a CIDR rule becomes a masked address compared with `&`. An invalid rule or CIDR prefix throws a `TypeError` when the middleware is created.

Sources: [src/middleware/ip-restriction/index.ts:40-120](repo://src/middleware/ip-restriction/index.ts#L40-L120), [src/utils/ipaddr.ts:148-160](repo://src/utils/ipaddr.ts#L148-L160), [src/utils/ipaddr.ts:313-320](repo://src/utils/ipaddr.ts#L313-L320)

### Decision order

For each request the deny list is checked first, then the allow list. A denied address gets `onError`'s response or a 403. An allowed one continues. Any other address continues only when the allow list is empty. A missing address or one that cannot be parsed is refused with 403.

Sources: [src/middleware/ip-restriction/index.ts:238-279](repo://src/middleware/ip-restriction/index.ts#L238-L279)

## bodyLimit

`bodyLimit({ maxSize, onError })` lets requests without a body through. When the request has `Content-Length` and no `Transfer-Encoding`, it trusts the length and refuses at once if it is larger than `maxSize`. Otherwise, for chunked or unsized bodies, it reads the whole body before the handler runs, counting bytes and refusing as soon as the count passes the limit; a body within the limit is put back into a fresh `Request` on `c.req.raw`, so the handler reads it normally. The default refusal is a 413 `Payload Too Large` thrown as an `HTTPException`, and `onError(c)` can return another response.

Sources: [src/middleware/body-limit/index.ts:10-111](repo://src/middleware/body-limit/index.ts#L10-L111)
