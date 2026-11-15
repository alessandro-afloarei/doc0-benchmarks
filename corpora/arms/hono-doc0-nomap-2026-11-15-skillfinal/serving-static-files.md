---
title: "Serving Static Files"
---
## Overview

Reading a file is one of the few things that differ on every runtime, so `serveStatic` is split in two. The base middleware in `hono/serve-static` turns the request path into a file path, picks the MIME type and precompressed variant, and builds the response; it reads nothing itself, and its comment says users should not call it directly. Each adapter (`hono/bun`, `hono/deno`, `hono/cloudflare-workers`) wraps it with a `getContent(path)` that reads from the runtime's storage, plus, where possible, a `join` and an `isDir`. Cloudflare Pages has a separate `serveStatic` that defers to the platform.

Sources: [src/middleware/serve-static/index.ts:13-49](repo://src/middleware/serve-static/index.ts#L13-L49), [src/adapter/bun/serve-static.ts:8-32](repo://src/adapter/bun/serve-static.ts#L8-L32)

## Options

| Option | Effect |
| --- | --- |
| `root` | directory joined in front of the path (default `./`) |
| `path` | serve this one file for every request instead of using the request path |
| `rewriteRequestPath(path)` | transform the request path before joining (ignored when `path` is set) |
| `mimes` | extra extension-to-type map consulted before the built-in one |
| `precompressed` | look for `.br`, `.zst` and `.gz` siblings the client accepts |
| `onFound(path, c)` | called before a found file is returned |
| `onNotFound(path, c)` | called when nothing is served |

Sources: [src/middleware/serve-static/index.ts:13-21](repo://src/middleware/serve-static/index.ts#L13-L21), [src/middleware/serve-static/index.ts:50-79](repo://src/middleware/serve-static/index.ts#L50-L79)

## How a request is resolved

### Path checks

The middleware does nothing when the context already has a response, and calls `next()`. Otherwise, unless `path` is set, it decodes the request path with `tryDecodeURI` and rejects, by calling `onNotFound` and `next()`, any path with a `.` or `..` segment, repeated slashes, or a backslash. A rejected path never reaches `getContent`.

Sources: [src/middleware/serve-static/index.ts:54-74](repo://src/middleware/serve-static/index.ts#L54-L74)

### Building the file path

The file path is `join(root, path)`. The default `join` filters empty parts, collapses repeated slashes and resolves `.` and `..`; its comment notes it only handles `/` separators and suggests `node:path`'s `join` for Windows, which is what the Bun and Deno wrappers pass. When the adapter provides `isDir` and the path is a directory, `index.html` is appended.

Sources: [src/middleware/serve-static/index.ts:76-83](repo://src/middleware/serve-static/index.ts#L76-L83), [src/middleware/serve-static/path.ts:1-25](repo://src/middleware/serve-static/path.ts#L1-L25)

### Building the response

`getContent(path, c)` may return a `Response`, which is passed through `c.newResponse` with its own status and headers, a body (string, buffer or stream), or `null` for not found. For a body, `Content-Type` comes from `mimes`, then the built-in table by lower-case extension, else `application/octet-stream`.

Sources: [src/middleware/serve-static/index.ts:85-94](repo://src/middleware/serve-static/index.ts#L85-L94), [src/utils/mime.ts:6-16](repo://src/utils/mime.ts#L6-L16)

With `precompressed`, and only for types matching the compressible-type pattern (or unknown types), the middleware reads `Accept-Encoding` and tries `br`, `zstd` and `gzip` in that order, calling `getContent` for `path.br`, `path.zst` or `path.gz`. The first one found replaces the body, with `Content-Encoding` set and `Accept-Encoding` appended to `Vary`. Then `onFound` runs and `c.body(content)` is returned.

Sources: [src/middleware/serve-static/index.ts:23-28](repo://src/middleware/serve-static/index.ts#L23-L28), [src/middleware/serve-static/index.ts:96-120](repo://src/middleware/serve-static/index.ts#L96-L120), [src/utils/compress.ts:6-10](repo://src/utils/compress.ts#L6-L10)

When nothing is found, `onNotFound` runs and the middleware calls `next()`, so a later route or the app's not-found handler answers ([[Request Lifecycle and Middleware Composition]]).

Sources: [src/middleware/serve-static/index.ts:122-125](repo://src/middleware/serve-static/index.ts#L122-L125)

## Runtime implementations

### Comparison

| Runtime | `getContent` | Directories |
| --- | --- | --- |
| Bun | `Bun.file(path)` when it exists | `stat().isDirectory()` from `node:fs/promises` |
| Deno | `Deno.open(path)` and its `readable` stream; errors other than `NotFound` are logged | `Deno.lstatSync(path).isDirectory`; a directory itself returns `null` |
| Cloudflare Workers | Workers Sites KV: the manifest maps the path to a key, and the value is read from the namespace as a stream | not supported |
| Cloudflare Pages | not a wrapper: `env.ASSETS.fetch(c.req.raw)`, with `404` turned into `c.notFound()` | handled by Pages |

Sources: [src/adapter/bun/serve-static.ts:8-32](repo://src/adapter/bun/serve-static.ts#L8-L32), [src/adapter/deno/serve-static.ts:6-42](repo://src/adapter/deno/serve-static.ts#L6-L42), [src/adapter/cloudflare-workers/utils.ts:11-50](repo://src/adapter/cloudflare-workers/utils.ts#L11-L50), [src/adapter/cloudflare-pages/handler.ts:104-123](repo://src/adapter/cloudflare-pages/handler.ts#L104-L123)

### Cloudflare Workers KV

The Workers adapter takes the manifest from `options.manifest` (an object or a JSON string) or the global `__STATIC_CONTENT_MANIFEST`, and the namespace from `options.namespace`, `c.env.__STATIC_CONTENT`, or the global of that name. A path missing from the manifest, or a key with no value, yields `null`. The exported module-mode `serveStatic` omits the `namespace` option. The adapter is marked deprecated in favour of Cloudflare Static Assets, with Cloudflare Pages suggested as the alternative.

Sources: [src/adapter/cloudflare-workers/serve-static.ts:6-42](repo://src/adapter/cloudflare-workers/serve-static.ts#L6-L42), [src/adapter/cloudflare-workers/utils.ts:1-50](repo://src/adapter/cloudflare-workers/utils.ts#L1-L50), [src/adapter/cloudflare-workers/serve-static-module.ts:1-12](repo://src/adapter/cloudflare-workers/serve-static-module.ts#L1-L12)

### Cloudflare Pages

The Pages `serveStatic()` is meant for Pages' advanced mode, per its comment: it forwards the raw request to the `ASSETS` binding and returns the asset response, or the app's not-found response when the asset is missing. It never calls `next()`, so handlers registered after it on the same path do not run.

Sources: [src/adapter/cloudflare-pages/handler.ts:104-123](repo://src/adapter/cloudflare-pages/handler.ts#L104-L123)
