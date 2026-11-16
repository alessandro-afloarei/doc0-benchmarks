---
title: "Security Middleware"
---
## Overview

The security middleware in `src/middleware` limits which callers and which browser contexts can reach a route, and sets response headers that tell browsers how to handle the content. The four are `cors`, `csrf`, `ipRestriction` and `secureHeaders`. Each one is a `MiddlewareHandler` that either calls `next()` or stops the chain with a `403`, and each one's defaults are set in its own file. Who the caller is, as opposed to where the request comes from, is checked in [[Authentication Middleware]].

Sources: [src/middleware/cors/index.ts:63-69](repo://src/middleware/cors/index.ts#L63-L69), [src/middleware/csrf/index.ts:94-97](repo://src/middleware/csrf/index.ts#L94-L97), [src/middleware/ip-restriction/index.ts:218-222](repo://src/middleware/ip-restriction/index.ts#L218-L222), [src/middleware/secure-headers/secure-headers.ts:179-182](repo://src/middleware/secure-headers/secure-headers.ts#L179-L182)

## CORS

`cors(options)` merges its options over defaults of `origin: '*'`, the methods `GET`, `HEAD`, `PUT`, `POST`, `DELETE` and `PATCH`, and empty header lists. The `origin` option can be one string, a list of strings, or a function, and each form becomes a function that returns the allowed origin for a request or `null`.

Sources: [src/middleware/cors/index.ts:63-69](repo://src/middleware/cors/index.ts#L63-L69), [src/middleware/cors/index.ts:70-96](repo://src/middleware/cors/index.ts#L70-L96)

For every request, the middleware reads the `Origin` header and sets `Access-Control-Allow-Origin` when the origin is allowed. With `credentials` set it adds `Access-Control-Allow-Credentials: true`, and `exposeHeaders` becomes `Access-Control-Expose-Headers`. When the origin is not `*`, it also sends `Vary: Origin`, so a shared cache does not serve one origin's answer to another.

Sources: [src/middleware/cors/index.ts:98-120](repo://src/middleware/cors/index.ts#L98-L120), [src/middleware/cors/index.ts:150-156](repo://src/middleware/cors/index.ts#L150-L156)

For an `OPTIONS` request the middleware also answers the preflight: it sends `Access-Control-Max-Age` when `maxAge` is set and `Access-Control-Allow-Methods` from the method list. The allowed request headers come from the `allowHeaders` option.

Sources: [src/middleware/cors/index.ts:121-148](repo://src/middleware/cors/index.ts#L121-L148)

## CSRF

`csrf(options)` protects against cross-site form posts. It checks a request only when three things hold together: the method is not `GET` or `HEAD`, the `Content-Type` is a form type (`application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`), and the request is not accepted by either of its two checks. Requests with any other content type, such as `application/json`, are not checked.

Sources: [src/middleware/csrf/index.ts:138-146](repo://src/middleware/csrf/index.ts#L138-L146)

The two checks are the `Sec-Fetch-Site` header and the `Origin` header. By default the first must be `same-origin`, and the second must equal the origin of the request URL. The `origin` and `secFetchSite` options replace either check with a string, a list or a function. A request that fails both is answered with `403 Forbidden` through an `HTTPException`.

Sources: [src/middleware/csrf/index.ts:97-98](repo://src/middleware/csrf/index.ts#L97-L98), [src/middleware/csrf/index.ts:116-118](repo://src/middleware/csrf/index.ts#L116-L118), [src/middleware/csrf/index.ts:145-146](repo://src/middleware/csrf/index.ts#L145-L146)

## IP restriction

`ipRestriction(getIP, { denyList, allowList }, onError)` checks the client address before the handler runs. `getIP` is a function that returns the address, usually `getConnInfo` from a runtime adapter, which is why the address source depends on the runtime. Each list holds rules that can be a single address, a CIDR range, or a function that receives the parsed address.

Sources: [src/middleware/ip-restriction/index.ts:173-184](repo://src/middleware/ip-restriction/index.ts#L173-L184), [src/middleware/ip-restriction/index.ts:218-222](repo://src/middleware/ip-restriction/index.ts#L218-L222)

Rules are compiled once when the middleware is created. A malformed address or a prefix longer than the address width throws a `TypeError` at that point, so a bad rule fails at start-up rather than on a request.

Sources: [src/middleware/ip-restriction/index.ts:38-96](repo://src/middleware/ip-restriction/index.ts#L38-L96)

At request time the deny list is checked first, so a deny match wins over an allow match. A request that matches the deny list is blocked. A request that matches the allow list continues. When the allow list is empty every other request continues, and when it is not empty every other request is blocked. A blocked request gets `403 Forbidden` unless `onError` returns a response.

Sources: [src/middleware/ip-restriction/index.ts:228-251](repo://src/middleware/ip-restriction/index.ts#L228-L251), [src/middleware/ip-restriction/index.ts:262-275](repo://src/middleware/ip-restriction/index.ts#L262-L275)

A request whose address is missing, or cannot be parsed as an IP address, is blocked as well, with the same `403`.

Sources: [src/middleware/ip-restriction/index.ts:236-242](repo://src/middleware/ip-restriction/index.ts#L236-L242), [src/middleware/ip-restriction/index.ts:258-266](repo://src/middleware/ip-restriction/index.ts#L258-L266)

## Secure headers

`secureHeaders(options)` sets a fixed set of response headers. Its defaults are the header table and the `DEFAULT_OPTIONS` object: `Cross-Origin-Resource-Policy`, `Cross-Origin-Opener-Policy`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security` for about six months, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` and a few others. `Cross-Origin-Embedder-Policy` is off by default.

Sources: [src/middleware/secure-headers/secure-headers.ts:91-107](repo://src/middleware/secure-headers/secure-headers.ts#L91-L107), [src/middleware/secure-headers/secure-headers.ts:109-123](repo://src/middleware/secure-headers/secure-headers.ts#L109-L123)

The options are merged over `DEFAULT_OPTIONS` and then filtered: each header is set, changed or removed according to its option. `contentSecurityPolicy` and `contentSecurityPolicyReportOnly` build their value from directive settings, and the `Content-Security-Policy` and `Content-Security-Policy-Report-Only` headers are then added to the set.

Sources: [src/middleware/secure-headers/secure-headers.ts:179-198](repo://src/middleware/secure-headers/secure-headers.ts#L179-L198), [src/middleware/secure-headers/secure-headers.ts:231-240](repo://src/middleware/secure-headers/secure-headers.ts#L231-L240)

The `removePoweredBy` option, which is `true` by default, deletes the `X-Powered-By` header from the response.

Sources: [src/middleware/secure-headers/secure-headers.ts:122-122](repo://src/middleware/secure-headers/secure-headers.ts#L122-L122), [src/middleware/secure-headers/secure-headers.ts:225-227](repo://src/middleware/secure-headers/secure-headers.ts#L225-L227)
