---
title: "Security Middleware"
---
## Overview

Five built-in middleware protect an app at the HTTP level. Two decide whether a request may proceed at all: `csrf` refuses cross-site form submissions and `ipRestriction` refuses addresses by rule. `bodyLimit` refuses oversized bodies. `cors` answers browser preflight requests and adds the CORS headers, and `secureHeaders` adds a set of protective response headers. Each is created with options once and registered with `app.use`, as [[Application and Routing]] shows. The ones that refuse a request throw an `HTTPException` carrying the response, so the app's error handler decides the final answer, as [[Request Lifecycle and Error Handling]] explains. Credential checks are on [[Authentication Middleware]].

Sources: [src/middleware/csrf/index.ts:138-150](repo://src/middleware/csrf/index.ts#L138-L150), [src/middleware/ip-restriction/index.ts:231-236](repo://src/middleware/ip-restriction/index.ts#L231-L236), [src/middleware/body-limit/index.ts:50-58](repo://src/middleware/body-limit/index.ts#L50-L58)

| Middleware | Import | Refuses with |
| --- | --- | --- |
| `cors(options)` | `hono/cors` | Never refuses; answers preflights with 204 |
| `csrf(options)` | `hono/csrf` | 403 `Forbidden` |
| `secureHeaders(options)` | `hono/secure-headers` | Never refuses |
| `ipRestriction(getIP, rules, onError)` | `hono/ip-restriction` | 403 `Forbidden`, or `onError` |
| `bodyLimit({ maxSize, onError })` | `hono/body-limit` | 413 `Payload Too Large`, or `onError` |

Sources: [src/middleware/cors/index.ts:143-147](repo://src/middleware/cors/index.ts#L143-L147), [src/middleware/csrf/index.ts:145-146](repo://src/middleware/csrf/index.ts#L145-L146), [src/middleware/ip-restriction/index.ts:218-236](repo://src/middleware/ip-restriction/index.ts#L218-L236), [src/middleware/body-limit/index.ts:10-16](repo://src/middleware/body-limit/index.ts#L10-L16)

## cors

`cors` defaults to `origin: '*'` and allows `GET`, `HEAD`, `PUT`, `POST`, `DELETE` and `PATCH`. `origin` may be one origin, a list, or a function `(origin, c)` returning the origin to allow or nothing; `allowMethods` may be a list or a function of the origin.

Sources: [src/middleware/cors/index.ts:9-22](repo://src/middleware/cors/index.ts#L9-L22), [src/middleware/cors/index.ts:63-94](repo://src/middleware/cors/index.ts#L63-L94)

On every request it sets `Access-Control-Allow-Origin` when the request's `Origin` is allowed, `Access-Control-Allow-Credentials: true` when `credentials` is set, and `Access-Control-Expose-Headers` from `exposeHeaders`. With a specific origin rather than `*`, it appends `Vary: Origin` after the handler runs, citing the MDN guidance in a comment.

Sources: [src/middleware/cors/index.ts:96-112](repo://src/middleware/cors/index.ts#L96-L112), [src/middleware/cors/index.ts:149-155](repo://src/middleware/cors/index.ts#L149-L155)

An `OPTIONS` request is a preflight and never reaches the handler. The middleware adds `Access-Control-Max-Age` when `maxAge` is set, `Access-Control-Allow-Methods`, and `Access-Control-Allow-Headers` from `allowHeaders` or, when that is empty, echoed from the request's `Access-Control-Request-Headers`. It removes `Content-Length` and `Content-Type` and returns `204 No Content`.

Sources: [src/middleware/cors/index.ts:114-148](repo://src/middleware/cors/index.ts#L114-L148)

## csrf

`csrf` blocks requests that a form on another site could send. A request is refused only when all four conditions hold:

Sources: [src/middleware/csrf/index.ts:28-30](repo://src/middleware/csrf/index.ts#L28-L30), [src/middleware/csrf/index.ts:126-150](repo://src/middleware/csrf/index.ts#L126-L150)

1. the method is not `GET` or `HEAD`;
2. the content type is one a form element can send: `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`, with a missing header counted as `text/plain`;
3. the `Sec-Fetch-Site` header is missing, not one of its four standard values, or not allowed;
4. the `Origin` header is missing or not allowed.

Sources: [src/middleware/csrf/index.ts:28-30](repo://src/middleware/csrf/index.ts#L28-L30), [src/middleware/csrf/index.ts:126-150](repo://src/middleware/csrf/index.ts#L126-L150)

By default only `Sec-Fetch-Site: same-origin` and an `Origin` equal to the request URL's origin are allowed. Each option accepts a value, a list or a function: `origin` for origins, `secFetchSite` for `same-origin`, `same-site`, `none` or `cross-site`. A JSON request is never blocked, since a form cannot send that content type.

Sources: [src/middleware/csrf/index.ts:12-26](repo://src/middleware/csrf/index.ts#L12-L26), [src/middleware/csrf/index.ts:94-125](repo://src/middleware/csrf/index.ts#L94-L125)

## secureHeaders

`secureHeaders` sets its headers after the handler runs, on `c.res`, and removes `X-Powered-By` unless `removePoweredBy` is `false`. Each header option is `true` for the default value, a string to replace it, or `false` to omit it.

Sources: [src/middleware/secure-headers/secure-headers.ts:179-238](repo://src/middleware/secure-headers/secure-headers.ts#L179-L238), [src/middleware/secure-headers/secure-headers.ts:330-334](repo://src/middleware/secure-headers/secure-headers.ts#L330-L334)

| Option | Header | Default value | On by default |
| --- | --- | --- | --- |
| `crossOriginEmbedderPolicy` | `Cross-Origin-Embedder-Policy` | `require-corp` | no |
| `crossOriginResourcePolicy` | `Cross-Origin-Resource-Policy` | `same-origin` | yes |
| `crossOriginOpenerPolicy` | `Cross-Origin-Opener-Policy` | `same-origin` | yes |
| `originAgentCluster` | `Origin-Agent-Cluster` | `?1` | yes |
| `referrerPolicy` | `Referrer-Policy` | `no-referrer` | yes |
| `strictTransportSecurity` | `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` | yes |
| `xContentTypeOptions` | `X-Content-Type-Options` | `nosniff` | yes |
| `xDnsPrefetchControl` | `X-DNS-Prefetch-Control` | `off` | yes |
| `xDownloadOptions` | `X-Download-Options` | `noopen` | yes |
| `xFrameOptions` | `X-Frame-Options` | `SAMEORIGIN` | yes |
| `xPermittedCrossDomainPolicies` | `X-Permitted-Cross-Domain-Policies` | `none` | yes |
| `xXssProtection` | `X-XSS-Protection` | `0` | yes |

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124)

`contentSecurityPolicy` and `contentSecurityPolicyReportOnly` take an object of camel-case directives, each a list of sources, and write `Content-Security-Policy` and its report-only form with kebab-case names. `permissionsPolicy` writes `Permissions-Policy`: `true` becomes `*`, `false` becomes `none`, an empty list `()`, and other lists quote every origin except `self` and `src`. `reportingEndpoints` and `reportTo` write `Reporting-Endpoints` and `Report-To`.

Sources: [src/middleware/secure-headers/secure-headers.ts:184-213](repo://src/middleware/secure-headers/secure-headers.ts#L184-L213), [src/middleware/secure-headers/secure-headers.ts:240-328](repo://src/middleware/secure-headers/secure-headers.ts#L240-L328)

A CSP source can be a function `(c, directive) => string`, evaluated per request. The exported `NONCE` is one: it creates a random 16-byte base64 nonce, stores it as `c.get('secureHeadersNonce')`, and returns `'nonce-...'`. The functions run before `next()`, as the code's comment says, so the handler can read the nonce and put it on its inline scripts.

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:215-223](repo://src/middleware/secure-headers/secure-headers.ts#L215-L223)

```ts
app.use(
  secureHeaders({
    contentSecurityPolicy: { scriptSrc: [NONCE] },
  })
)
app.get('/', (c) => c.html(`<script nonce="${c.get('secureHeadersNonce')}">...</script>`))
```

Sources: [src/middleware/secure-headers/secure-headers.ts:11-13](repo://src/middleware/secure-headers/secure-headers.ts#L11-L13), [src/middleware/secure-headers/secure-headers.ts:137-145](repo://src/middleware/secure-headers/secure-headers.ts#L137-L145)

## ipRestriction

`ipRestriction(getIP, { denyList, allowList }, onError)` takes the client address from `getIP`: either a runtime's `getConnInfo`, listed on [[Runtime Adapters]], or a function returning the address as a string. A missing address is refused.

Sources: [src/middleware/ip-restriction/index.ts:218-247](repo://src/middleware/ip-restriction/index.ts#L218-L247)

The deny list is checked first; a match is refused. Then a match on the allow list proceeds. An address on neither list proceeds only when the allow list is empty. `onError(remote, c)`, when given, returns the response for a refused address instead of the 403. An address that cannot be parsed is refused.

Sources: [src/middleware/ip-restriction/index.ts:249-278](repo://src/middleware/ip-restriction/index.ts#L249-L278)

A rule is `*`, a static IPv4 or IPv6 address, a CIDR range such as `192.168.0.0/16` or `2001:db8::/32`, or a function of `{ addr, type }`. `buildMatcher` turns static addresses and ranges into `bigint` values and masks once, at creation, and invalid rules throw a `TypeError` then. IPv4 addresses and their IPv4-mapped IPv6 forms (`::ffff:a.b.c.d`) match each other in both directions.

Sources: [src/middleware/ip-restriction/index.ts:40-120](repo://src/middleware/ip-restriction/index.ts#L40-L120), [src/middleware/ip-restriction/index.ts:122-167](repo://src/middleware/ip-restriction/index.ts#L122-L167), [src/utils/ipaddr.ts:313-320](repo://src/utils/ipaddr.ts#L313-L320)

## bodyLimit

`bodyLimit({ maxSize })` refuses request bodies larger than `maxSize` bytes. A request without a body passes. When only `Content-Length` is present, its value is trusted and the body is not read.

Sources: [src/middleware/body-limit/index.ts:61-74](repo://src/middleware/body-limit/index.ts#L61-L74)

With `Transfer-Encoding`, or with no length header, the middleware reads the whole body before the handler runs, stopping as soon as the size passes the limit. It then replaces `c.req.raw` with a new request whose body replays the chunks read. The comment gives the reason: the check is final before the handler runs, however the handler reads the body, and `Transfer-Encoding` takes precedence over `Content-Length` as RFC 7230 says.

Sources: [src/middleware/body-limit/index.ts:76-110](repo://src/middleware/body-limit/index.ts#L76-L110)
