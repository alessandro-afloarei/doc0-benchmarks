---
title: "Security Middleware"
---
## Overview

Four built-in middleware apply security policy that is not about who the user is: `cors` answers cross-origin preflights and labels responses, `csrf` refuses cross-site form submissions, `secureHeaders` adds protective response headers, and `ipRestriction` filters clients by address. Identity checks are in [[Authentication Middleware]].

Sources: [src/middleware/cors/index.ts:63-157](repo://src/middleware/cors/index.ts#L63-L157), [src/middleware/csrf/index.ts:94-151](repo://src/middleware/csrf/index.ts#L94-L151), [src/middleware/secure-headers/secure-headers.ts:179-229](repo://src/middleware/secure-headers/secure-headers.ts#L179-L229), [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279)

| Middleware | Runs | Blocks with |
| --- | --- | --- |
| `cors` | before `next()` for headers; answers `OPTIONS` itself | never blocks; a disallowed origin simply gets no `Access-Control-Allow-Origin` |
| `csrf` | before `next()` | `HTTPException(403)` |
| `secureHeaders` | headers computed before, set after `next()` | never blocks |
| `ipRestriction` | before `next()` | `HTTPException(403)` or `onError` |

Sources: [src/middleware/cors/index.ts:96-156](repo://src/middleware/cors/index.ts#L96-L156), [src/middleware/csrf/index.ts:138-150](repo://src/middleware/csrf/index.ts#L138-L150), [src/middleware/secure-headers/secure-headers.ts:215-228](repo://src/middleware/secure-headers/secure-headers.ts#L215-L228), [src/middleware/ip-restriction/index.ts:231-278](repo://src/middleware/ip-restriction/index.ts#L231-L278)

## cors

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `origin` | `*` | a string, an array of allowed origins, or `(origin, c) => allowed origin or null` |
| `allowMethods` | `GET, HEAD, PUT, POST, DELETE, PATCH` | array or `(origin, c) => string[]` |
| `allowHeaders` | `[]` | when empty, the preflight echoes `Access-Control-Request-Headers` |
| `exposeHeaders` | `[]` | sent as `Access-Control-Expose-Headers` |
| `maxAge` | unset | `Access-Control-Max-Age` on preflights |
| `credentials` | unset | `Access-Control-Allow-Credentials: true` |

Sources: [src/middleware/cors/index.ts:9-22](repo://src/middleware/cors/index.ts#L9-L22), [src/middleware/cors/index.ts:63-94](repo://src/middleware/cors/index.ts#L63-L94)

### Request flow

For every request the middleware resolves the allowed origin from the request's `Origin` header: `*` always, a string only when equal, an array when included, or the function's result. It writes `Access-Control-Allow-Origin`, credentials and expose headers to `c.res.headers`, the prepared response the [[Context]] creates on first read, so the headers end up on whatever response the handler builds.

Sources: [src/middleware/cors/index.ts:96-112](repo://src/middleware/cors/index.ts#L96-L112), [src/context.ts:403-434](repo://src/context.ts#L403-L434)

Any `OPTIONS` request is treated as a preflight and answered without calling `next()`: it adds `Vary: Origin` (unless the origin option is `*`), max age, allowed methods and allowed headers (with `Vary: Access-Control-Request-Headers`), removes `Content-Length` and `Content-Type`, and returns `204 No Content`. For other methods, after `next()` it appends `Vary: Origin` when the origin option is not `*`, because the response then depends on the requesting origin.

Sources: [src/middleware/cors/index.ts:114-156](repo://src/middleware/cors/index.ts#L114-L156)

## csrf

`csrf({ origin, secFetchSite })` rejects a request with `403 Forbidden` only when all of these hold: the method is not `GET` or `HEAD`; the `Content-Type` is one a plain HTML form can send (`application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`, and a missing header counts as `text/plain`); the `Sec-Fetch-Site` header is not allowed; and the `Origin` header is not allowed. Passing either header check is enough.

Sources: [src/middleware/csrf/index.ts:28-31](repo://src/middleware/csrf/index.ts#L28-L31), [src/middleware/csrf/index.ts:138-150](repo://src/middleware/csrf/index.ts#L138-L150)

| Check | Default | Option forms | Missing header |
| --- | --- | --- | --- |
| `Origin` | equals the request URL's origin | string, array, `(origin, c) => boolean` | denied |
| `Sec-Fetch-Site` | `same-origin` only | one of `same-origin`, `same-site`, `none`, `cross-site`; array; function | denied |

Sources: [src/middleware/csrf/index.ts:10-26](repo://src/middleware/csrf/index.ts#L10-L26), [src/middleware/csrf/index.ts:94-136](repo://src/middleware/csrf/index.ts#L94-L136)

A `Sec-Fetch-Site` value outside the four known ones is treated as not allowed before any custom function is called.

Sources: [src/middleware/csrf/index.ts:126-136](repo://src/middleware/csrf/index.ts#L126-L136)

## secureHeaders

### Default headers

`secureHeaders(options)` merges options over defaults and turns each enabled flag into a header from a fixed table; a string value replaces the default value. Everything below is on by default except `Cross-Origin-Embedder-Policy`, and `X-Powered-By` is removed.

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124), [src/middleware/secure-headers/secure-headers.ts:231-238](repo://src/middleware/secure-headers/secure-headers.ts#L231-L238)

| Option | Header | Default value |
| --- | --- | --- |
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
| `crossOriginEmbedderPolicy` (off) | `Cross-Origin-Embedder-Policy` | `require-corp` |

Sources: [src/middleware/secure-headers/secure-headers.ts:94-107](repo://src/middleware/secure-headers/secure-headers.ts#L94-L107)

### Content Security Policy and nonces

`contentSecurityPolicy` and `contentSecurityPolicyReportOnly` take directives in camelCase (`scriptSrc`), converted to kebab-case. A directive value may include functions of `(c, directive)`, evaluated per request. The exported `NONCE` is such a function: it generates 16 random bytes as base64, stores them as `secureHeadersNonce` on the context (reusing an existing one), and emits `'nonce-...'`, so a page can read the same nonce from `c.get('secureHeadersNonce')` for its inline scripts.

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:240-288](repo://src/middleware/secure-headers/secure-headers.ts#L240-L288)

The per-request callbacks run before `next()`, as the code comment notes, because they call `c.set()` to make the nonce available to the handler. After `next()` every header is written with `c.res.headers.set`, replacing any value the handler set for the same header.

Sources: [src/middleware/secure-headers/secure-headers.ts:215-229](repo://src/middleware/secure-headers/secure-headers.ts#L215-L229), [src/middleware/secure-headers/secure-headers.ts:330-334](repo://src/middleware/secure-headers/secure-headers.ts#L330-L334)

### Other policies

`permissionsPolicy` maps directives to `true` (`*`), `false` (`none`) or an allowlist in which `self` and `src` stay bare and origins are quoted; an empty list gives `()`. `reportingEndpoints` produces `Reporting-Endpoints` and `reportTo` produces `Report-To` as JSON.

Sources: [src/middleware/secure-headers/secure-headers.ts:200-213](repo://src/middleware/secure-headers/secure-headers.ts#L200-L213), [src/middleware/secure-headers/secure-headers.ts:290-328](repo://src/middleware/secure-headers/secure-headers.ts#L290-L328)

## ipRestriction

### Getting the address

`ipRestriction(getIP, { denyList, allowList }, onError)` takes either a runtime's `getConnInfo` or a function returning an address string ([[Runtime Adapters]]). A request without an address is refused. The address type comes from the connection info, or is detected from the string.

Sources: [src/middleware/ip-restriction/index.ts:23-38](repo://src/middleware/ip-restriction/index.ts#L23-L38), [src/middleware/ip-restriction/index.ts:218-247](repo://src/middleware/ip-restriction/index.ts#L218-L247)

### Rules and decision

Each list is compiled once into a matcher. A rule can be `*` (matches everything), an exact IPv4 or IPv6 address, a CIDR range, or a function of `{ addr, type }`. Exact addresses are stored as strings and as binary `bigint` values, with IPv4 addresses also registered in their IPv4-mapped IPv6 form and vice versa; CIDR rules are stored as masked `bigint`s, and an IPv4-mapped IPv6 range with a prefix of 96 or more is converted to an IPv4 range. An invalid rule throws a `TypeError` when the middleware is created.

Sources: [src/middleware/ip-restriction/index.ts:40-120](repo://src/middleware/ip-restriction/index.ts#L40-L120), [src/middleware/ip-restriction/index.ts:121-167](repo://src/middleware/ip-restriction/index.ts#L121-L167)

The deny list is checked first: a match calls `onError({ addr, type }, c)` or throws `HTTPException(403)` with `Forbidden`. Then an allow-list match calls `next()`. If neither matched, an empty allow list lets the request through, while a non-empty one refuses it. A remote address that cannot be parsed is refused as well.

Sources: [src/middleware/ip-restriction/index.ts:249-278](repo://src/middleware/ip-restriction/index.ts#L249-L278)
