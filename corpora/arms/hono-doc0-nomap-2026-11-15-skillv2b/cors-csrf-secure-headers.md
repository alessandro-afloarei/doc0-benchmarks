---
title: "CORS, CSRF and Secure Headers"
---
## Overview

Three middleware deal with what browsers enforce on behalf of a site. `cors` (`hono/cors`) tells browsers which other origins may call the API. `csrf` (`hono/csrf`) refuses form-style submissions that come from another site. `secureHeaders` (`hono/secure-headers`) adds the response headers that restrict framing, sniffing, referrers and script sources. They complement each other: CORS relaxes the same-origin policy for chosen origins, while CSRF and the security headers tighten what a browser allows by default.

Sources: [src/middleware/cors/index.ts:63-157](repo://src/middleware/cors/index.ts#L63-L157), [src/middleware/csrf/index.ts:94-151](repo://src/middleware/csrf/index.ts#L94-L151), [src/middleware/secure-headers/secure-headers.ts:179-229](repo://src/middleware/secure-headers/secure-headers.ts#L179-L229)

```ts
import { cors } from 'hono/cors'
import { csrf } from 'hono/csrf'
import { secureHeaders } from 'hono/secure-headers'

app.use(secureHeaders())
app.use('/api/*', cors({ origin: ['https://app.example.com'], credentials: true }))
app.use('/form/*', csrf())
```

Sources: [src/middleware/cors/index.ts:63-70](repo://src/middleware/cors/index.ts#L63-L70)

## CORS

### Options

| Option | Default | Effect |
| --- | --- | --- |
| `origin` | `*` | A single origin, a list, or `(origin, c) => allowedOrigin \| null` |
| `allowMethods` | `GET, HEAD, PUT, POST, DELETE, PATCH` | A list, or `(origin, c) => string[]` |
| `allowHeaders` | `[]` | Allowed request headers; when empty, the preflight's `Access-Control-Request-Headers` are echoed |
| `exposeHeaders` | `[]` | Response headers scripts may read |
| `maxAge` | none | Seconds a preflight may be cached |
| `credentials` | `false` | Sends `Access-Control-Allow-Credentials: true` |

Sources: [src/middleware/cors/index.ts:9-22](repo://src/middleware/cors/index.ts#L9-L22), [src/middleware/cors/index.ts:63-70](repo://src/middleware/cors/index.ts#L63-L70)

`origin` and `allowMethods` are turned into lookup functions once, when the middleware is created. A string other than `*` matches only that exact origin; an array matches by inclusion; a function returns the value to send, or a falsy value to send no `Access-Control-Allow-Origin` at all.

Sources: [src/middleware/cors/index.ts:72-94](repo://src/middleware/cors/index.ts#L72-L94)

### Preflight and actual requests

For every request the middleware sets `Access-Control-Allow-Origin`, `Access-Control-Allow-Credentials` and `Access-Control-Expose-Headers` on `c.res` as configured, then branches on the method.

Sources: [src/middleware/cors/index.ts:96-112](repo://src/middleware/cors/index.ts#L96-L112)

- **`OPTIONS` requests** are answered by the middleware itself with `204 No Content`, adding `Access-Control-Max-Age`, `Access-Control-Allow-Methods` and `Access-Control-Allow-Headers`, plus `Vary: Origin` (when the origin is not `*`) and `Vary: Access-Control-Request-Headers`. Handlers are never reached, so no `OPTIONS` routes are needed.
- **Other requests** run `next()`, then append `Vary: Origin` when the allowed origin depends on the request, so shared caches do not serve one origin's response to another.

Sources: [src/middleware/cors/index.ts:96-157](repo://src/middleware/cors/index.ts#L96-L157)

Headers are written to `c.res` before `next()`, and the response the handler returns is merged with them when it is assigned to `c.res` ([[Context and Responses]]). That is why `cors` must be registered before the routes it covers.

Sources: [src/middleware/cors/index.ts:97-112](repo://src/middleware/cors/index.ts#L97-L112), [src/context.ts:414-434](repo://src/context.ts#L414-L434)

## CSRF

### What is checked

`csrf` only examines requests a plain HTML form could send cross-site: methods other than `GET` and `HEAD` whose `Content-Type` is `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain` (a missing `Content-Type` counts as `text/plain`). JSON requests are not checked because a browser cannot send them cross-site without a CORS preflight.

Sources: [src/middleware/csrf/index.ts:28-30](repo://src/middleware/csrf/index.ts#L28-L30), [src/middleware/csrf/index.ts:138-150](repo://src/middleware/csrf/index.ts#L138-L150)

Such a request passes when either check succeeds.

Sources: [src/middleware/csrf/index.ts:139-144](repo://src/middleware/csrf/index.ts#L139-L144)

| Check | Default | Configured by |
| --- | --- | --- |
| `Sec-Fetch-Site` header | Must be `same-origin` | `secFetchSite`: a value, list or `(value, c) => boolean` |
| `Origin` header | Must equal the origin of `c.req.url` | `origin`: a string, list or `(origin, c) => boolean` |

Sources: [src/middleware/csrf/index.ts:94-136](repo://src/middleware/csrf/index.ts#L94-L136)

A missing header fails its check, and a `Sec-Fetch-Site` value outside the four defined ones (`same-origin`, `same-site`, `none`, `cross-site`) fails too. When both fail, the middleware throws an `HTTPException(403)` whose response is `Forbidden`.

Sources: [src/middleware/csrf/index.ts:12-16](repo://src/middleware/csrf/index.ts#L12-L16), [src/middleware/csrf/index.ts:106-147](repo://src/middleware/csrf/index.ts#L106-L147)

Behind a proxy that rewrites the host, `new URL(c.req.url).origin` may not be the public origin; the `origin` option should then name the public origin explicitly.

Sources: [src/middleware/csrf/index.ts:95-98](repo://src/middleware/csrf/index.ts#L95-L98)

## Secure headers

### Default headers

`secureHeaders(options)` merges the options over `DEFAULT_OPTIONS` and, for each enabled entry of `HEADERS_MAP`, sets the header after `next()`. Passing `false` disables a header, and passing a string replaces its value.

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124), [src/middleware/secure-headers/secure-headers.ts:231-238](repo://src/middleware/secure-headers/secure-headers.ts#L231-L238)

| Header | Default value | On by default |
| --- | --- | --- |
| `Cross-Origin-Embedder-Policy` | `require-corp` | no |
| `Cross-Origin-Resource-Policy` | `same-origin` | yes |
| `Cross-Origin-Opener-Policy` | `same-origin` | yes |
| `Origin-Agent-Cluster` | `?1` | yes |
| `Referrer-Policy` | `no-referrer` | yes |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | yes |
| `X-Content-Type-Options` | `nosniff` | yes |
| `X-DNS-Prefetch-Control` | `off` | yes |
| `X-Download-Options` | `noopen` | yes |
| `X-Frame-Options` | `SAMEORIGIN` | yes |
| `X-Permitted-Cross-Domain-Policies` | `none` | yes |
| `X-XSS-Protection` | `0` | yes |

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124)

`removePoweredBy` (on by default) deletes `X-Powered-By` from the response, undoing the powered-by middleware or a platform's header ([[Logger, Server Timing, Request ID and Powered-By]]).

Sources: [src/middleware/secure-headers/secure-headers.ts:225-227](repo://src/middleware/secure-headers/secure-headers.ts#L225-L227)

### Content Security Policy and nonces

`contentSecurityPolicy` and `contentSecurityPolicyReportOnly` take camel-case directives (`scriptSrc`, `defaultSrc`, ...), each an array of strings or functions. `getCSPDirectives` converts names to kebab case and builds the header value once. When a value is a function, it records the slot that value occupies and returns a callback that fills that slot per request.

Sources: [src/middleware/secure-headers/secure-headers.ts:18-44](repo://src/middleware/secure-headers/secure-headers.ts#L18-L44), [src/middleware/secure-headers/secure-headers.ts:240-288](repo://src/middleware/secure-headers/secure-headers.ts#L240-L288)

The exported `NONCE` function is such a value. It generates 16 random bytes as base64, stores them in `c.get('secureHeadersNonce')` (reusing a nonce already set for the request) and returns `'nonce-<value>'`. The callbacks run before `next()` so the handler can read the nonce and put it on its `<script nonce>` tags.

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:215-223](repo://src/middleware/secure-headers/secure-headers.ts#L215-L223)

```ts
import { secureHeaders, NONCE } from 'hono/secure-headers'

app.use(secureHeaders({ contentSecurityPolicy: { scriptSrc: [NONCE] } }))
app.get('/', (c) =>
  c.html(`<script nonce="${c.get('secureHeadersNonce')}">console.log(1)</script>`)
)
```

Sources: [src/middleware/secure-headers/secure-headers.ts:137-145](repo://src/middleware/secure-headers/secure-headers.ts#L137-L145)

### Permissions-Policy and reporting

`permissionsPolicy` maps camel-case feature names, typed from the W3C feature list in `permissions-policy.ts`, to `true` (`*`), `false` (`none`), an empty array (`()`), or an allowlist where `self` and `src` stay bare and origins are quoted. `reportingEndpoints` produces `Reporting-Endpoints: name="url"` and `reportTo` produces the legacy `Report-To` JSON.

Sources: [src/middleware/secure-headers/secure-headers.ts:290-328](repo://src/middleware/secure-headers/secure-headers.ts#L290-L328), [src/middleware/secure-headers/permissions-policy.ts:1-20](repo://src/middleware/secure-headers/permissions-policy.ts#L1-L20)

Unlike `cors`, `secureHeaders` writes after `next()`, directly on the final response's headers, so it overrides values set by handlers. A route that needs a different `X-Frame-Options` uses a separate `secureHeaders` instance with that option rather than setting the header itself.

Sources: [src/middleware/secure-headers/secure-headers.ts:330-334](repo://src/middleware/secure-headers/secure-headers.ts#L330-L334)
