---
title: "Security Middleware"
---
## Overview

Four built-in middleware deal with cross-origin and network-level protection. `cors` answers preflight requests and adds CORS headers. `csrf` rejects cross-site form submissions. `secureHeaders` adds a set of hardening headers to every response. `ipRestriction` allows or denies clients by IP address. Each is a factory that takes options and returns a `MiddlewareHandler`; the ones that reject a request throw an `HTTPException` carrying the response ([[Request Dispatch and Middleware]]).

Sources: [src/middleware/cors/index.ts:63-63](repo://src/middleware/cors/index.ts#L63-L63), [src/middleware/csrf/index.ts:94-151](repo://src/middleware/csrf/index.ts#L94-L151), [src/middleware/secure-headers/secure-headers.ts:179-229](repo://src/middleware/secure-headers/secure-headers.ts#L179-L229), [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279)

| Middleware | Import | Use it to |
| --- | --- | --- |
| `cors` | `hono/cors` | Let browsers on other origins call the API |
| `csrf` | `hono/csrf` | Refuse unsafe form-type requests from other sites |
| `secureHeaders` | `hono/secure-headers` | Add CSP, HSTS, frame and referrer headers |
| `ipRestriction` | `hono/ip-restriction` | Allow or block clients by address or CIDR range |

Sources: [package.json:89-93](repo://package.json#L89-L93), [package.json:124-133](repo://package.json#L124-L133)

## cors

`cors(options?)` starts from `origin: '*'` and the methods `GET`, `HEAD`, `PUT`, `POST`, `DELETE` and `PATCH`, and merges the options over them.

Sources: [src/middleware/cors/index.ts:63-70](repo://src/middleware/cors/index.ts#L63-L70)

| Option | Effect |
| --- | --- |
| `origin` | `'*'`, one origin, a list, or a function `(origin, c)` returning the origin to allow, or `null` |
| `allowMethods` | A list, or a function `(origin, c)` returning one; sent on preflight |
| `allowHeaders` | Sent on preflight; when empty, the request's `Access-Control-Request-Headers` is echoed |
| `exposeHeaders` | `Access-Control-Expose-Headers` |
| `maxAge` | `Access-Control-Max-Age` on preflight |
| `credentials` | Sends `Access-Control-Allow-Credentials: true` |

Sources: [src/middleware/cors/index.ts:9-22](repo://src/middleware/cors/index.ts#L9-L22), [src/middleware/cors/index.ts:72-94](repo://src/middleware/cors/index.ts#L72-L94)

On every request the middleware resolves the allowed origin from the request's `Origin` header and sets `Access-Control-Allow-Origin` when there is one, along with the credentials and expose headers. It writes to `c.res.headers` before calling the handler; the Context copies those headers onto the handler's response later ([[Context and Responses]]).

Sources: [src/middleware/cors/index.ts:96-112](repo://src/middleware/cors/index.ts#L96-L112)

An `OPTIONS` request is answered by the middleware itself with `204 No Content`, without calling any handler. It adds `Vary: Origin` when the origin is not `*`, the max age, the allowed methods and the allowed headers, and removes `Content-Length` and `Content-Type`. For other methods it calls `next()` and then appends `Vary: Origin` when the origin is not `*`; a comment explains this is because the response then names an explicit origin.

Sources: [src/middleware/cors/index.ts:114-156](repo://src/middleware/cors/index.ts#L114-L156)

## csrf

`csrf(options?)` blocks a request only when all four of these hold:

Sources: [src/middleware/csrf/index.ts:28-30](repo://src/middleware/csrf/index.ts#L28-L30), [src/middleware/csrf/index.ts:106-147](repo://src/middleware/csrf/index.ts#L106-L147)

1. The method is not `GET` or `HEAD`.
2. The `Content-Type` is one a plain HTML form can send: `application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`. A missing header counts as `text/plain`.
3. The `Sec-Fetch-Site` header is missing, not one of its four known values, or not allowed.
4. The `Origin` header is missing or not allowed.

Sources: [src/middleware/csrf/index.ts:28-30](repo://src/middleware/csrf/index.ts#L28-L30), [src/middleware/csrf/index.ts:106-147](repo://src/middleware/csrf/index.ts#L106-L147)

A blocked request gets `403 Forbidden`, thrown as an `HTTPException`. JSON requests pass this check by design, since a cross-site form cannot send `application/json`.

Sources: [src/middleware/csrf/index.ts:138-150](repo://src/middleware/csrf/index.ts#L138-L150)

| Option | Default | Accepts |
| --- | --- | --- |
| `origin` | The request URL's own origin | A string, a list, or `(origin, c) => boolean` |
| `secFetchSite` | `same-origin` | `same-origin`, `same-site`, `none` or `cross-site`, a list of them, or `(value, c) => boolean` |

Sources: [src/middleware/csrf/index.ts:10-26](repo://src/middleware/csrf/index.ts#L10-L26), [src/middleware/csrf/index.ts:94-136](repo://src/middleware/csrf/index.ts#L94-L136)

Either check passing is enough: a browser that sends `Sec-Fetch-Site: same-origin` passes without an `Origin` header, and one that sends an allowed `Origin` passes without `Sec-Fetch-Site`.

Sources: [src/middleware/csrf/index.ts:139-144](repo://src/middleware/csrf/index.ts#L139-L144)

## secureHeaders

### Default headers

`secureHeaders(options?)` sets these headers by default:

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124)

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

Sources: [src/middleware/secure-headers/secure-headers.ts:94-124](repo://src/middleware/secure-headers/secure-headers.ts#L94-L124)

`crossOriginEmbedderPolicy` (`require-corp`) is off by default. Each option is `true` for the default value, `false` to omit the header, or a string to replace the value. `removePoweredBy`, on by default, deletes `X-Powered-By` from the response.

Sources: [src/middleware/secure-headers/secure-headers.ts:67-88](repo://src/middleware/secure-headers/secure-headers.ts#L67-L88), [src/middleware/secure-headers/secure-headers.ts:109-124](repo://src/middleware/secure-headers/secure-headers.ts#L109-L124), [src/middleware/secure-headers/secure-headers.ts:231-238](repo://src/middleware/secure-headers/secure-headers.ts#L231-L238)

The header list is computed once when the middleware is created. For each request, the middleware calls `next()` and then sets the headers on `c.res`, overwriting any a handler set with the same names.

Sources: [src/middleware/secure-headers/secure-headers.ts:179-229](repo://src/middleware/secure-headers/secure-headers.ts#L179-L229), [src/middleware/secure-headers/secure-headers.ts:330-334](repo://src/middleware/secure-headers/secure-headers.ts#L330-L334)

### Content Security Policy and nonces

`contentSecurityPolicy` and `contentSecurityPolicyReportOnly` take directives in camel case, such as `scriptSrc`, which `getCSPDirectives` converts to `script-src`. Values are strings or functions `(c, directive) => string`.

Sources: [src/middleware/secure-headers/secure-headers.ts:15-44](repo://src/middleware/secure-headers/secure-headers.ts#L15-L44), [src/middleware/secure-headers/secure-headers.ts:240-288](repo://src/middleware/secure-headers/secure-headers.ts#L240-L288)

The exported `NONCE` is such a function. It generates 16 random bytes encoded as base64, stores them in the Context as `secureHeadersNonce` (reusing a value already set), and returns `'nonce-…'`. Function values are evaluated before `next()`, as a comment in the middleware notes, so the handler can read `c.get('secureHeadersNonce')` and put the same nonce on its `<script>` tags.

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:215-222](repo://src/middleware/secure-headers/secure-headers.ts#L215-L222), [src/middleware/secure-headers/index.ts:1-8](repo://src/middleware/secure-headers/index.ts#L1-L8)

```ts
import { secureHeaders, NONCE } from 'hono/secure-headers'

app.use(secureHeaders({ contentSecurityPolicy: { scriptSrc: [NONCE] } }))

app.get('/', (c) =>
  c.html(`<script nonce="${c.get('secureHeadersNonce')}">console.log(1)</script>`)
)
```

Sources: [src/middleware/secure-headers/secure-headers.ts:137-145](repo://src/middleware/secure-headers/secure-headers.ts#L137-L145)

### Permissions and reporting

`permissionsPolicy` maps camel-case features from the `PermissionsPolicyDirective` list to a value: `true` gives `feature=*`, `false` gives `feature=none`, `[]` gives `feature=()`, and a list gives `feature=(self "https://a.example")`, with `self` and `src` left unquoted. `reportingEndpoints` writes `Reporting-Endpoints` as `name="url"` pairs, and `reportTo` writes each group as JSON in `Report-To`.

Sources: [src/middleware/secure-headers/secure-headers.ts:290-328](repo://src/middleware/secure-headers/secure-headers.ts#L290-L328), [src/middleware/secure-headers/permissions-policy.ts:1-20](repo://src/middleware/secure-headers/permissions-policy.ts#L1-L20)

## ipRestriction

`ipRestriction(getIP, { denyList, allowList }, onError?)` needs a way to find the client address. `getIP` is either a `GetConnInfo` function from an adapter, described on [[Runtime and Connection Info]], or any function `(c) => string`.

Sources: [src/middleware/ip-restriction/index.ts:23-23](repo://src/middleware/ip-restriction/index.ts#L23-L23), [src/middleware/ip-restriction/index.ts:218-225](repo://src/middleware/ip-restriction/index.ts#L218-L225)

```ts
import { ipRestriction } from 'hono/ip-restriction'
import { getConnInfo } from 'hono/cloudflare-workers'

app.use(
  '/admin/*',
  ipRestriction(getConnInfo, { denyList: ['192.168.2.0/24'], allowList: ['127.0.0.1', '::1'] })
)
```

Sources: [src/middleware/ip-restriction/index.ts:218-279](repo://src/middleware/ip-restriction/index.ts#L218-L279), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8)

The decision follows this order:

Sources: [src/middleware/ip-restriction/index.ts:238-279](repo://src/middleware/ip-restriction/index.ts#L238-L279)

1. No address: 403.
2. The address matches the deny list: `onError` if given, else 403.
3. The address matches the allow list: `next()`.
4. The allow list is empty: `next()`.
5. Otherwise: `onError` if given, else 403.

Sources: [src/middleware/ip-restriction/index.ts:238-279](repo://src/middleware/ip-restriction/index.ts#L238-L279)

A malformed address is treated like a missing one and answers 403, recognised by the `ERR_INVALID_IP_ADDRESS` code on the `TypeError` the ipaddr utilities throw.

Sources: [src/middleware/ip-restriction/index.ts:259-268](repo://src/middleware/ip-restriction/index.ts#L259-L268), [src/utils/ipaddr.ts:41-44](repo://src/utils/ipaddr.ts#L41-L44)

Each rule is `'*'`, an address, a CIDR range, or a function `({ addr, type }) => boolean`. `buildMatcher` compiles the list once. Plain addresses go into sets of strings and of `bigint` binaries, both in IPv4 and in IPv4-mapped IPv6 form, so `127.0.0.1` also matches `::ffff:127.0.0.1`. CIDR ranges become a masked `bigint` and a mask; an IPv4-mapped IPv6 range with a prefix of 96 or more is converted to an IPv4 range. A `/32` or `/128` range is treated as a plain address, and an invalid rule throws `TypeError: Invalid rule` at setup.

Sources: [src/middleware/ip-restriction/index.ts:37-120](repo://src/middleware/ip-restriction/index.ts#L37-L120)

At match time the string set is checked first, then the binary sets, then each CIDR range, then the function rules. A `'*'` anywhere in a list makes it match everything.

Sources: [src/middleware/ip-restriction/index.ts:82-85](repo://src/middleware/ip-restriction/index.ts#L82-L85), [src/middleware/ip-restriction/index.ts:122-166](repo://src/middleware/ip-restriction/index.ts#L122-L166)
