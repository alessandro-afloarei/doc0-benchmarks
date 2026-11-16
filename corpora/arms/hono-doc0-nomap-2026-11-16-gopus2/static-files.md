---
title: "Serving Static Files"
---
## Overview

Reading a file is different on every runtime, so `serveStatic` is split in two. The shared middleware in `middleware/serve-static` decides which path to serve, guards against path traversal, picks the content type and handles precompressed variants. It delegates the actual read to a `getContent(path, c)` function supplied by a runtime adapter: Bun reads from the file system with `Bun.file`, Deno with `Deno.open`, and Cloudflare Workers from the KV namespace of Workers Sites. The app imports `serveStatic` from its runtime's adapter, as listed in [[Runtime Adapters]].

Sources: [src/middleware/serve-static/index.ts:35-126](repo://src/middleware/serve-static/index.ts#L35-L126), [src/adapter/bun/serve-static.ts:8-32](repo://src/adapter/bun/serve-static.ts#L8-L32), [src/adapter/deno/serve-static.ts:8-42](repo://src/adapter/deno/serve-static.ts#L8-L42), [src/adapter/cloudflare-workers/serve-static.ts:21-42](repo://src/adapter/cloudflare-workers/serve-static.ts#L21-L42)

```ts
import { serveStatic } from 'hono/bun'

app.use('/static/*', serveStatic({ root: './' }))
app.get('/favicon.ico', serveStatic({ path: './favicon.ico' }))
```

Sources: [src/middleware/serve-static/index.ts:13-21](repo://src/middleware/serve-static/index.ts#L13-L21), [src/adapter/bun/serve-static.ts:8-32](repo://src/adapter/bun/serve-static.ts#L8-L32)

## Options

| Option | Default | Effect |
| --- | --- | --- |
| `root` | `./` | Directory the request path is resolved against |
| `path` | none | Serve this one file for every request, ignoring the URL |
| `rewriteRequestPath(path)` | none | Change the request path before it is joined with `root` |
| `mimes` | none | Extra extension-to-type map, checked before the built-in one |
| `precompressed` | `false` | Serve `.br`, `.zst` or `.gz` siblings when the client accepts them |
| `onFound(path, c)` | none | Called before a found file is returned, for example to set `Cache-Control` |
| `onNotFound(path, c)` | none | Called when nothing is served, before `next()` |

Sources: [src/middleware/serve-static/index.ts:13-21](repo://src/middleware/serve-static/index.ts#L13-L21)

## Resolving the path

### From URL to file path

The middleware does nothing when the context is already finalized, so it can sit after handlers that may have answered. Otherwise the filename is `options.path`, or the request path decoded with `tryDecodeURI`. A decoded path containing a `.` or `..` segment, two or more consecutive slashes or backslashes, or any backslash is rejected: `onNotFound` is called and the request falls through with `next()`. This check runs after decoding, so `%2e%2e` cannot slip past it.

Sources: [src/middleware/serve-static/index.ts:54-74](repo://src/middleware/serve-static/index.ts#L54-L74), [src/utils/url.ts:94-104](repo://src/utils/url.ts#L94-L104)

The filename, after `rewriteRequestPath` if given, is joined with `root`. The shared `defaultJoin` joins with `/`, collapses repeated slashes and resolves `.` and `..`, without Windows path support; the Bun and Deno adapters pass `join` from `node:path` instead. When the adapter provides `isDir` and the path is a directory, `index.html` is appended.

Sources: [src/middleware/serve-static/index.ts:76-83](repo://src/middleware/serve-static/index.ts#L76-L83), [src/middleware/serve-static/path.ts:1-25](repo://src/middleware/serve-static/path.ts#L1-L25)

### Reading and responding

`getContent(path, c)` returns the file's data, a full `Response`, or `null`. A `Response` is returned through `c.newResponse`, keeping headers set earlier. `null` calls `onNotFound` and then `next()`, so a later route or the app's not-found handler can answer.

Sources: [src/middleware/serve-static/index.ts:85-125](repo://src/middleware/serve-static/index.ts#L85-L125)

For data, `Content-Type` comes from the extension: the `mimes` option first, then the built-in table, then `application/octet-stream`. `getMimeType` matches the last `.ext` case-insensitively.

Sources: [src/middleware/serve-static/index.ts:92-94](repo://src/middleware/serve-static/index.ts#L92-L94), [src/utils/mime.ts:1-16](repo://src/utils/mime.ts#L1-L16)

## Precompressed files

With `precompressed: true` and a compressible content type (per `COMPRESSIBLE_CONTENT_TYPE_REGEX`, or no known type), the middleware reads `Accept-Encoding` and tries the variants in a fixed order of preference: `br` (`.br`), then `zstd` (`.zst`), then `gzip` (`.gz`). The first one the client lists and `getContent` finds replaces the content, with `Content-Encoding` set and `Accept-Encoding` appended to `Vary`. The original file must exist for this to happen, since its MIME type is determined first.

Sources: [src/middleware/serve-static/index.ts:23-28](repo://src/middleware/serve-static/index.ts#L23-L28), [src/middleware/serve-static/index.ts:96-119](repo://src/middleware/serve-static/index.ts#L96-L119), [src/utils/compress.ts:6-10](repo://src/utils/compress.ts#L6-L10)

## Runtime back ends

### Bun

`hono/bun`'s `serveStatic` builds its `getContent` with `Bun.file(path)`, returning the file when `file.exists()` is true and `null` otherwise. `isDir` uses `stat` from `node:fs/promises`, and `join` comes from `node:path`.

Sources: [src/adapter/bun/serve-static.ts:1-32](repo://src/adapter/bun/serve-static.ts#L1-L32)

### Deno

`hono/deno`'s version opens the file with `Deno.open` and returns its `readable` stream. A directory returns `null` from `getContent`, and errors other than `NotFound` are logged with `console.warn` before returning `null`. `isDir` uses `Deno.lstatSync`.

Sources: [src/adapter/deno/serve-static.ts:1-42](repo://src/adapter/deno/serve-static.ts#L1-L42)

### Cloudflare Workers

`hono/cloudflare-workers`'s version reads Workers Sites assets. `getContentFromKVAsset` looks the path up in the asset manifest (the `manifest` option, or the global `__STATIC_CONTENT_MANIFEST`, parsed when it is a string) to get the KV key, then reads that key as a stream from the namespace (the `namespace` option, `c.env.__STATIC_CONTENT`, or the global `__STATIC_CONTENT`). A path missing from the manifest returns `null`.

Sources: [src/adapter/cloudflare-workers/serve-static.ts:1-42](repo://src/adapter/cloudflare-workers/serve-static.ts#L1-L42), [src/adapter/cloudflare-workers/utils.ts:1-50](repo://src/adapter/cloudflare-workers/utils.ts#L1-L50)

The adapter's index exports the ES-module variant, which takes the same options without `namespace`. The function is marked deprecated in its doc comment, which points to Cloudflare Static Assets or Cloudflare Pages instead.

Sources: [src/adapter/cloudflare-workers/serve-static-module.ts:1-12](repo://src/adapter/cloudflare-workers/serve-static-module.ts#L1-L12), [src/adapter/cloudflare-workers/serve-static.ts:12-20](repo://src/adapter/cloudflare-workers/serve-static.ts#L12-L20), [src/adapter/cloudflare-workers/index.ts:1-8](repo://src/adapter/cloudflare-workers/index.ts#L1-L8)

## File path utility

`utils/filepath` holds an older path helper, `getFilePath({ filename, root, defaultDocument })`. It appends `index.html` to paths ending in `/` or without an extension, returns `undefined` for any `..` segment, normalises backslashes to slashes, and joins with `root`, refusing a result that became absolute when `root` was relative. The shared middleware itself relies on the checks above rather than on this helper.

Sources: [src/utils/filepath.ts:1-60](repo://src/utils/filepath.ts#L1-L60)
