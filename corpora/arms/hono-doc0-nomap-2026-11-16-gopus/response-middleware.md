---
title: "Response Middleware"
---
## Overview

These middleware change or reuse the response a handler produced. Except for `serveStatic`, which produces the response itself, each one awaits `next()` and then inspects `c.res`, replacing it when it applies. Replacing `c.res` keeps the headers already set, as [[Context and Responses]] explains, so they can be stacked in any order the app needs: the order of registration is the order of the onion described on [[Request Lifecycle and Error Handling]].

Sources: [src/middleware/compress/index.ts:86-121](repo://src/middleware/compress/index.ts#L86-L121), [src/middleware/etag/index.ts:84-128](repo://src/middleware/etag/index.ts#L84-L128), [src/context.ts:414-434](repo://src/context.ts#L414-L434)

| Middleware | Import | Does |
| --- | --- | --- |
| `compress(options)` | `hono/compress` | Gzip or deflate the body with `CompressionStream` |
| `etag(options)` | `hono/etag` | Add an `ETag` and answer `304 Not Modified` on a match |
| `cache(options)` | `hono/cache` | Store and serve responses with the Web Cache API |
| `prettyJSON(options)` | `hono/pretty-json` | Re-indent JSON bodies on request |
| `serveStatic(options)` | `hono/serve-static` and runtime adapters | Serve files from a root directory |

Sources: [src/middleware/compress/index.ts:70-72](repo://src/middleware/compress/index.ts#L70-L72), [src/middleware/etag/index.ts:79-82](repo://src/middleware/etag/index.ts#L79-L82), [src/middleware/cache/index.ts:64-72](repo://src/middleware/cache/index.ts#L64-L72), [src/middleware/pretty-json/index.ts:46-56](repo://src/middleware/pretty-json/index.ts#L46-L56), [src/middleware/serve-static/index.ts:35-49](repo://src/middleware/serve-static/index.ts#L35-L49)

## compress

`compress` leaves the response alone when any of these hold: the status is 206 (the comment notes `Content-Range` refers to uncompressed bytes), it already has `Content-Encoding` or `Transfer-Encoding`, the request is `HEAD`, `Content-Length` is below `threshold` (1024 bytes by default), the content type is not compressible, or `Cache-Control` contains `no-transform`.

Sources: [src/middleware/compress/index.ts:86-102](repo://src/middleware/compress/index.ts#L86-L102), [src/middleware/compress/index.ts:124-129](repo://src/middleware/compress/index.ts#L124-L129)

The encoding is chosen from `Accept-Encoding` with `parseAccept`. Among `gzip` and `deflate`, or the single `encoding` option, the first with quality 1 wins, otherwise the highest positive quality; a `*` entry gives its quality to encodings not listed. The body is piped through `CompressionStream`, `Content-Length` is removed, `Content-Encoding` is set, and a strong `ETag` is made weak because the bytes changed.

Sources: [src/middleware/compress/index.ts:24-44](repo://src/middleware/compress/index.ts#L24-L44), [src/middleware/compress/index.ts:104-121](repo://src/middleware/compress/index.ts#L104-L121)

Compressible types come from `COMPRESSIBLE_CONTENT_TYPE_REGEX`: `text/*` except `text/event-stream`, a list of `application/*` types such as JSON, JavaScript and XML, some font and image types, and any `+json`, `+xml`, `+text`, `+yaml` or `+msgpack` suffix. `contentTypeFilter` replaces it with a regular expression or a function.

Sources: [src/utils/compress.ts:1-10](repo://src/utils/compress.ts#L1-L10), [src/middleware/compress/index.ts:74-84](repo://src/middleware/compress/index.ts#L74-L84)

## etag

When the response has no `ETag`, `etag` computes one from a clone of the body. The digest is SHA-1 through `crypto.subtle` unless `generateDigest` is given, and is fed chunk by chunk: each step hashes the previous digest followed by the next chunk. The hex result is quoted, with `W/` in front when `weak` is set. Without `crypto.subtle` and without a custom generator, no tag is added.

Sources: [src/middleware/etag/index.ts:38-54](repo://src/middleware/etag/index.ts#L38-L54), [src/middleware/etag/index.ts:89-105](repo://src/middleware/etag/index.ts#L89-L105), [src/middleware/etag/digest.ts:16-43](repo://src/middleware/etag/digest.ts#L16-L43)

The request's `If-None-Match` is compared ignoring `W/` prefixes, against each comma-separated tag; `*` matches any successful `GET` or `HEAD`. On a match the response becomes `304 Not Modified` with an empty body, keeping only the headers in `retainedHeaders`: `cache-control`, `content-location`, `date`, `etag`, `expires` and `vary` by default.

Sources: [src/middleware/etag/index.ts:21-36](repo://src/middleware/etag/index.ts#L21-L36), [src/middleware/etag/index.ts:107-128](repo://src/middleware/etag/index.ts#L107-L128)

## cache

`cache` uses the global `caches` object of runtimes that implement the Cache API. Where it is missing, the middleware becomes a pass-through and logs a message, which `onCacheNotAvailable` replaces with a callback or, set to `false`, silences.

Sources: [src/middleware/cache/index.ts:73-82](repo://src/middleware/cache/index.ts#L73-L82)

Only `GET` requests without an `Authorization` header are cached. The key is the URL, or the result of `keyGenerator(c)`, with `::name=value` appended for each header named in `vary`. A hit is returned at once without running the handler. On a miss the handler runs, and its response is stored when:

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:141-176](repo://src/middleware/cache/index.ts#L141-L176)

1. its status is in `cacheableStatusCodes` (`[200]` by default);
2. its own `Vary` names no header outside the `vary` option;
3. its `Cache-Control` has no `private`, `no-store` or `no-cache`;
4. it sets no cookie.

Sources: [src/middleware/cache/index.ts:13-35](repo://src/middleware/cache/index.ts#L13-L35), [src/middleware/cache/index.ts:141-176](repo://src/middleware/cache/index.ts#L141-L176)

Before that check, the `cacheControl` option's directives are appended to the response's `Cache-Control` unless a directive of the same name is already there, and the `vary` option is merged into the response's `Vary`. A `vary` option containing `*` throws at creation, citing RFC 7231. The write uses `c.executionCtx.waitUntil` so the response is not delayed, unless `wait: true` asks to await it, for runtimes without an execution context.

Sources: [src/middleware/cache/index.ts:84-139](repo://src/middleware/cache/index.ts#L84-L139), [src/middleware/cache/index.ts:177-183](repo://src/middleware/cache/index.ts#L177-L183)

## prettyJSON

`prettyJSON` re-serializes a JSON response with indentation (`space`, 2 by default) when the request has the `query` parameter, `?pretty` by default, with or without a value, or always when `force` is set. Only responses whose `Content-Type` starts with `application/json` are touched.

Sources: [src/middleware/pretty-json/index.ts:8-56](repo://src/middleware/pretty-json/index.ts#L8-L56)

## serveStatic

### Resolving a path

The generic `serveStatic` in `hono/serve-static` knows nothing about file systems; each runtime adapter wraps it with a `getContent(path, c)` function and, where needed, `join`, `isDir` and `pathResolve`. [[Runtime Adapters]] lists those wrappers. A context that is already finalized is passed through.

Sources: [src/middleware/serve-static/index.ts:35-58](repo://src/middleware/serve-static/index.ts#L35-L58)

The file name is `options.path` when given, otherwise the request path, URI-decoded. A decoded path containing a `.` or `..` segment, two slashes in a row, or a backslash is refused as not found, which prevents escaping the root. `rewriteRequestPath` can change the name, and the result is joined to `root` (`./` by default) by `defaultJoin`, which normalizes slashes and resolves `.` and `..`. When `isDir` says the path is a directory, `index.html` is appended.

Sources: [src/middleware/serve-static/index.ts:60-83](repo://src/middleware/serve-static/index.ts#L60-L83), [src/middleware/serve-static/path.ts:5-25](repo://src/middleware/serve-static/path.ts#L5-L25)

### Sending the file

`getContent` may return a `Response`, which is sent as it is, or data, or `null`. For data, `Content-Type` comes from the extension through `options.mimes` first, then the built-in table in `utils/mime`, then `application/octet-stream`. With `precompressed: true` and a compressible type, the middleware looks for `.br`, `.zst` and `.gz` siblings in that order, for encodings the request accepts, and serves the first found with `Content-Encoding` and `Vary: Accept-Encoding`.

Sources: [src/middleware/serve-static/index.ts:85-120](repo://src/middleware/serve-static/index.ts#L85-L120), [src/utils/mime.ts:6-16](repo://src/utils/mime.ts#L6-L16)

`onFound(path, c)` runs before a file is sent, which is where an app can add caching headers. When nothing is found, `onNotFound(path, c)` runs and the middleware calls `next()`, so a later route can still answer.

Sources: [src/middleware/serve-static/index.ts:118-125](repo://src/middleware/serve-static/index.ts#L118-L125)
