---
title: "Response Middleware"
---
## Overview

These middleware work on the way out: they call `await next()`, then rewrite or annotate `c.res`. Replacing `c.res` keeps headers set by earlier layers, and headers they add go onto the final response, both thanks to the `c.res` setter described in [[Context]]. Because they run after the handler, their position in the chain matters: a middleware registered earlier wraps the ones registered later, so it sees their output (see [[Request Lifecycle and Middleware Composition]]).

Sources: [src/context.ts:409-434](repo://src/context.ts#L409-L434), [src/compose.ts:32-51](repo://src/compose.ts#L32-L51)

| Middleware | Import | What it does | Choose it when |
| --- | --- | --- | --- |
| `compress` | `hono/compress` | gzip or deflate response bodies | The runtime or proxy does not already compress |
| `etag` | `hono/etag` | Adds an `ETag`, answers 304 to matching `If-None-Match` | Clients revalidate cached responses |
| `cache` | `hono/cache` | Stores responses in the Web Cache API | Cloudflare Workers or Deno, with a `caches` global |
| `secureHeaders` | `hono/secure-headers` | Sets security headers, CSP with nonces, Permissions-Policy | Any app served to browsers |
| `prettyJSON` | `hono/pretty-json` | Re-indents JSON when `?pretty` is present | Debugging APIs by hand |
| `poweredBy` | `hono/powered-by` | `X-Powered-By: Hono` | Advertising the server |
| `trimTrailingSlash`, `appendTrailingSlash` | `hono/trailing-slash` | 301 to the canonical slash form | Strict routing with one URL per page |

Sources: [package.json:94-142](repo://package.json#L94-L142)

## compress

`compress({ encoding, threshold, contentTypeFilter })` leaves the response alone when it is a 206, already has `Content-Encoding` or `Transfer-Encoding`, answers a `HEAD` request, declares a `Content-Length` below `threshold` (default 1024 bytes), has a content type that is not compressible, or carries `Cache-Control: no-transform`. The default filter, `COMPRESSIBLE_CONTENT_TYPE_REGEX`, covers text types (except `text/event-stream`), JSON, XML, JavaScript, WebAssembly and other compressible formats.

Sources: [src/middleware/compress/index.ts:70-102](repo://src/middleware/compress/index.ts#L70-L102), [src/utils/compress.ts:1-10](repo://src/utils/compress.ts#L1-L10)

Otherwise it picks an encoding from `Accept-Encoding` by quality value (gzip before deflate on a tie, `*` counting for both, `q=0` excluding), pipes the body through a `CompressionStream`, removes `Content-Length`, sets `Content-Encoding`, and weakens a strong `ETag` to `W/"..."` because the compressed bytes differ.

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/compress/index.ts:104-121](repo://src/middleware/compress/index.ts#L104-L121)

## etag

`etag({ weak, retainedHeaders, generateDigest })` reads `If-None-Match` before the handler runs. Afterwards it uses the response's own `ETag` if present; otherwise it hashes a clone of the body, chunk by chunk, with SHA-1 from WebCrypto (or the given `generateDigest`) and formats it as `"hex"` or `W/"hex"`. When the runtime has no `crypto.subtle` and no generator is given, the middleware does nothing.

Sources: [src/middleware/etag/index.ts:38-105](repo://src/middleware/etag/index.ts#L38-L105), [src/middleware/etag/digest.ts:16-43](repo://src/middleware/etag/digest.ts#L16-L43)

Tags are compared weakly (the `W/` prefix is ignored) against every tag in `If-None-Match`; `*` matches any successful `GET` or `HEAD`. On a match the response becomes an empty 304 that keeps only the headers in `retainedHeaders` (by default `Cache-Control`, `Content-Location`, `Date`, `ETag`, `Expires` and `Vary`). Register `etag` after `compress`: the later middleware is the inner layer, so `etag` hashes the uncompressed body and `compress` then weakens the tag.

Sources: [src/middleware/etag/index.ts:21-36](repo://src/middleware/etag/index.ts#L21-L36), [src/middleware/etag/index.ts:107-128](repo://src/middleware/etag/index.ts#L107-L128)

## cache

`cache({ cacheName, cacheControl, vary, keyGenerator, wait, cacheableStatusCodes })` uses the platform's `caches` storage. When `caches` does not exist the factory returns a pass-through middleware and logs once (or calls `onCacheNotAvailable`, or stays silent with `false`). A `vary` containing `*` throws at creation.

Sources: [src/middleware/cache/index.ts:64-103](repo://src/middleware/cache/index.ts#L64-L103)

For each `GET` without an `Authorization` header it builds a key from the URL (or `keyGenerator`) plus the values of the `vary` request headers, and returns a cached copy when one exists. On a miss it runs the handler; a response with a cacheable status (200 by default) gets the configured `Cache-Control` directives (not overriding those the handler set) and `Vary` merged in. It is not stored when its `Cache-Control` says `private`, `no-store` or `no-cache`, when it sets cookies, or when it varies on headers the middleware was not told about. Storing happens through `c.executionCtx.waitUntil` so the response is not delayed, unless `wait: true` (needed on Deno, which has no execution context).

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:105-183](repo://src/middleware/cache/index.ts#L105-L183)

## secureHeaders

### Default headers

`secureHeaders(options)` sets a list of headers after the handler and removes `X-Powered-By`. Each option is `true` (the default value), `false` (omit) or a string (custom value).

Sources: [src/middleware/secure-headers/secure-headers.ts:179-229](repo://src/middleware/secure-headers/secure-headers.ts#L179-L229)

| Header | Default value | On by default |
| --- | --- | --- |
| `Cross-Origin-Resource-Policy` | `same-origin` | yes |
| `Cross-Origin-Opener-Policy` | `same-origin` | yes |
| `Cross-Origin-Embedder-Policy` | `require-corp` | no |
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

### Content Security Policy and nonces

`contentSecurityPolicy` (and `contentSecurityPolicyReportOnly`) take camelCase directives with arrays of sources, converted to the header syntax once at creation. A source may be a function of `(c, directive)`, evaluated per request before the handler runs. The exported `NONCE` is such a function: it generates 16 random bytes in base64, stores them as `c.get('secureHeadersNonce')`, and emits `'nonce-...'`, so the handler can put the same nonce on its inline scripts.

Sources: [src/middleware/secure-headers/secure-headers.ts:131-145](repo://src/middleware/secure-headers/secure-headers.ts#L131-L145), [src/middleware/secure-headers/secure-headers.ts:240-288](repo://src/middleware/secure-headers/secure-headers.ts#L240-L288)

```tsx
app.use(secureHeaders({ contentSecurityPolicy: { scriptSrc: [NONCE] } }))
app.get('/', (c) =>
  c.html(<script nonce={c.get('secureHeadersNonce')}>console.log('ok')</script>)
)
```

Sources: [src/middleware/secure-headers/index.ts:1-8](repo://src/middleware/secure-headers/index.ts#L1-L8)

`permissionsPolicy` maps camelCase features to `true` (`*`), `false` (`none`), or a list of origins with `self` and `src` kept bare; `reportingEndpoints` and `reportTo` produce the reporting headers.

Sources: [src/middleware/secure-headers/secure-headers.ts:290-328](repo://src/middleware/secure-headers/secure-headers.ts#L290-L328)

## Small response helpers

`prettyJSON({ space, query, force })` checks for the query parameter (default `pretty`, present with or without a value) before the handler, and afterwards re-serializes a JSON response with `JSON.stringify(obj, null, space)` (default 2 spaces). `force: true` formats every JSON response.

Sources: [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56)

`poweredBy({ serverName })` sets `X-Powered-By` to `serverName` or `Hono` after the handler. `secureHeaders` removes the same header, so registering both is contradictory.

Sources: [src/middleware/powered-by/index.ts:30-35](repo://src/middleware/powered-by/index.ts#L30-L35)

`trimTrailingSlash()` and `appendTrailingSlash()` normalize URLs for `GET` and `HEAD`. By default they act only when the handler answered 404: then they redirect with 301 to the path without (or with) the trailing slash, so existing routes keep working in both forms. With `alwaysRedirect: true` they redirect before routing whenever the path is not in canonical form. `appendTrailingSlash` accepts `skip(path)` to exclude paths such as files with extensions. Both are meant for apps created with `strict: true`, the default (see [[The Hono Application]]).

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-158](repo://src/middleware/trailing-slash/index.ts#L128-L158)
