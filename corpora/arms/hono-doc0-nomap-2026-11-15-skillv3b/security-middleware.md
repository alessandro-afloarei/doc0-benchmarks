---
title: "Security Middleware"
---
## Overview

These middleware protect an application from requests it should not serve or responses browsers should not trust. Each is a factory that precomputes its rules once and returns a named middleware. They reject requests the same way the [[Authentication Middleware]] do, by throwing an `HTTPException` that carries a complete response, so `app.onError` can still see the rejection.

Sources: [src/middleware/cors/index.ts:63-96](repo://src/middleware/cors/index.ts#L63-L96), [src/middleware/csrf/index.ts:138-151](repo://src/middleware/csrf/index.ts#L138-L151)

| Import | Protects against | Acts | Choose it when |
| --- | --- | --- | --- |
| `hono/cors` | Browsers blocking legitimate cross-origin calls | Adds `Access-Control-*` headers, answers preflights | A browser app on another origin calls the API |
| `hono/csrf` | Cross-site form submissions riding on cookies | Rejects unsafe form-like requests from other origins with 403 | The app uses cookie sessions and accepts form posts |
| `hono/secure-headers` | Clickjacking, MIME sniffing, script injection | Adds security headers to every response, optional CSP with nonces | Any app that serves HTML |
| `hono/ip-restriction` | Requests from unwanted networks | Allow and deny lists of IPs and CIDR ranges | Admin areas or internal endpoints |
| `hono/body-limit` | Oversized uploads | Rejects bodies above `maxSize` with 413 | Any route that reads a body |

Sources: [src/middleware/cors/index.ts:9-22](repo://src/middleware/cors/index.ts#L9-L22), [src/middleware/csrf/index.ts:23-30](repo://src/middleware/csrf/index.ts#L23-L30), [src/middleware/secure-headers/secure-headers.ts:69-88](repo://src/middleware/secure-headers/secure-headers.ts#L69-L88), [src/middleware/ip-restriction/index.ts:172-175](repo://src/middleware/ip-restriction/index.ts#L172-L175), [src/middleware/body-limit/index.ts:13-16](repo://src/middleware/body-limit/index.ts#L13-L16)

## CORS

### Options

`cors(options)` defaults to `origin: '*'` and the methods `GET, HEAD, PUT, POST, DELETE, PATCH`. `origin` may be one origin, a list, or a function `(origin, c) => allowedOrigin | null`; it is turned into a lookup function once. `allowMethods` may likewise be a function of the origin.

Sources: [src/middleware/cors/index.ts:63-94](repo://src/middleware/cors/index.ts#L63-L94)

### Per request

Every request gets `Access-Control-Allow-Origin` when the origin is allowed (the request's `Origin` echoed back, or `*`), `Access-Control-Allow-Credentials: true` when `credentials` is set, and `Access-Control-Expose-Headers` when configured. An `OPTIONS` request is treated as a preflight: it adds `Access-Control-Max-Age`, the allowed methods and the allowed headers, defaulting to whatever the browser asked for in `Access-Control-Request-Headers`, and returns `204 No Content` without calling `next()`. Any other request continues, and afterwards `Vary: Origin` is appended when the allowed origin depends on the request, so caches keep one copy per origin.

Sources: [src/middleware/cors/index.ts:96-156](repo://src/middleware/cors/index.ts#L96-L156)

> [!NOTE]
> Because preflights are answered inside the middleware, register `cors()` with `use` on the path pattern, not only on `get` or `post` routes, or `OPTIONS` requests never reach it.

Sources: [src/middleware/cors/index.ts:114-148](repo://src/middleware/cors/index.ts#L114-L148)

## CSRF

`csrf(options)` blocks a request only when all four conditions hold: the method is not `GET` or `HEAD`; the `Content-Type` is one an HTML form can send (`application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`, and a missing type counts as `text/plain`); the `Sec-Fetch-Site` header is missing or not allowed; and the `Origin` header is missing or not allowed. Passing either check is enough. A blocked request gets a 403 `Forbidden`.

Sources: [src/middleware/csrf/index.ts:28-30](repo://src/middleware/csrf/index.ts#L28-L30), [src/middleware/csrf/index.ts:138-151](repo://src/middleware/csrf/index.ts#L138-L151)

| Option | Default | Accepts |
| --- | --- | --- |
| `origin` | The request URL's own origin | A string, a list, or `(origin, c) => boolean` |
| `secFetchSite` | `same-origin` | One of `same-origin`, `same-site`, `none`, `cross-site`, a list, or `(value, c) => boolean` |

Sources: [src/middleware/csrf/index.ts:94-136](repo://src/middleware/csrf/index.ts#L94-L136)

JSON requests are not checked, because a cross-site form cannot send `application/json` and a cross-site `fetch` with that type triggers a CORS preflight; CSRF protection is aimed at the requests browsers send without asking.

Sources: [src/middleware/csrf/index.ts:29-30](repo://src/middleware/csrf/index.ts#L29-L30)

## Secure headers

### Defaults

`secureHeaders(options)` sets a fixed list of headers after the handler runs, overwriting any the handler set, and removes `X-Powered-By`. Each option is `true` (use the default value), `false` (omit the header), or a string (use that value). All are on by default except `Cross-Origin-Embedder-Policy`, which breaks loading cross-origin resources that do not opt in.

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124), [src/middleware/secure-headers/secure-headers.ts:215-238](repo://src/middleware/secure-headers/secure-headers.ts#L215-L238)

| Header | Default value |
| --- | --- |
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy` | `same-origin` |
| `X-XSS-Protection` | `0` |
| `Origin-Agent-Cluster`, `X-DNS-Prefetch-Control`, `X-Download-Options`, `X-Permitted-Cross-Domain-Policies` | `?1`, `off`, `noopen`, `none` |

Sources: [src/middleware/secure-headers/secure-headers.ts:94-107](repo://src/middleware/secure-headers/secure-headers.ts#L94-L107)

### Content Security Policy and nonces

`contentSecurityPolicy` (and `contentSecurityPolicyReportOnly`) take camel-case directives such as `scriptSrc: ["'self'", NONCE]`, which are converted to kebab case. A value may be a function `(c, directive) => string`; such values are filled in per request before `next()` runs. The exported `NONCE` function generates 16 random bytes, stores them base64-encoded as `c.get('secureHeadersNonce')`, and returns `'nonce-…'`, so a page renderer can put the same nonce on its inline `<script nonce>` tags.

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:240-288](repo://src/middleware/secure-headers/secure-headers.ts#L240-L288)

`permissionsPolicy` builds a `Permissions-Policy` header from directives typed in `permissions-policy.ts`: `true` becomes `*`, `false` becomes `none`, an empty list `()`, and other values an allowlist with `self` and `src` unquoted. `reportingEndpoints` and `reportTo` produce the matching reporting headers.

Sources: [src/middleware/secure-headers/secure-headers.ts:290-328](repo://src/middleware/secure-headers/secure-headers.ts#L290-L328), [src/middleware/secure-headers/permissions-policy.ts:1-86](repo://src/middleware/secure-headers/permissions-policy.ts#L1-L86)

## IP restriction

### Rules

`ipRestriction(getIP, { denyList, allowList }, onError?)` needs a way to find the client address: usually `getConnInfo` from the runtime adapter (see [[Runtime Adapters]]), or a function returning a string, for example from a trusted proxy header. A rule is `*`, a static IPv4 or IPv6 address, a CIDR range such as `10.0.0.0/8` or `2001:db8::/32`, or a function of `{ addr, type }`. Rules are compiled once into sets of strings and 128-bit `bigint` values plus a list of `[isIPv4, network, mask]` entries; an invalid rule throws a `TypeError` at startup.

Sources: [src/middleware/ip-restriction/index.ts:23-120](repo://src/middleware/ip-restriction/index.ts#L23-L120)

IPv4 and IPv4-mapped IPv6 addresses are treated as the same client: a static IPv4 rule also registers `::ffff:a.b.c.d`, and a mapped IPv6 CIDR of `/96` or longer is converted to its IPv4 equivalent. The conversions live in `utils/ipaddr`, which parses and expands addresses into `bigint`.

Sources: [src/middleware/ip-restriction/index.ts:59-80](repo://src/middleware/ip-restriction/index.ts#L59-L80), [src/middleware/ip-restriction/index.ts:122-166](repo://src/middleware/ip-restriction/index.ts#L122-L166), [src/utils/ipaddr.ts:148-160](repo://src/utils/ipaddr.ts#L148-L160), [src/utils/ipaddr.ts:313-327](repo://src/utils/ipaddr.ts#L313-L327)

### Decision order

The deny list is checked first, then the allow list. A request matching neither passes only when the allow list is empty. A missing or unparsable address is blocked. Blocked requests get `onError({ addr, type }, c)` when given, otherwise a 403 `Forbidden` thrown as an `HTTPException`.

Sources: [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279)

## Body limit

`bodyLimit({ maxSize, onError })` skips requests without a body. When the request has `Content-Length` and no `Transfer-Encoding`, it trusts the length and rejects early without reading. Otherwise, for chunked or unknown-length bodies, it reads the whole stream up front, counting bytes and rejecting as soon as the total passes `maxSize`, then replaces `c.req.raw` with a new `Request` over the buffered chunks so the handler can still read the body. The default rejection is a 413 `Payload Too Large` `HTTPException`; `onError(c)` can return a custom response.

Sources: [src/middleware/body-limit/index.ts:50-111](repo://src/middleware/body-limit/index.ts#L50-L111)

Reading the body before the handler means the check is final no matter how the handler consumes the body. Place `bodyLimit` before any validator so an oversized body is never parsed (see [[Validation]]).

Sources: [src/middleware/body-limit/index.ts:76-109](repo://src/middleware/body-limit/index.ts#L76-L109)
