---
title: "Serving Static Files"
---
## Overview

`serveStatic` is a middleware that answers a request with a file. It maps the request path to a path under `root`, asks a `getContent` function for the file, and sends it with a content type. It does not read the disk itself: the core in `src/middleware/serve-static` takes `getContent` as an option, and each runtime adapter supplies one that reads its own storage. This page covers the core flow, the path checks, the precompressed variants, and the Deno, Bun and Cloudflare Workers adapters. Building a site from the same handlers, which writes the files out once, is on [[Static Site Generation]].

Sources: [src/middleware/serve-static/index.ts:13-21](repo://src/middleware/serve-static/index.ts#L13-L21), [src/middleware/serve-static/index.ts:35-49](repo://src/middleware/serve-static/index.ts#L35-L49)

## Choosing the file

The middleware passes the request on unchanged when a response is already set. Otherwise it takes the file name from the `path` option when one is given, and from the request path decoded with `tryDecodeURI` when not. A file name that contains a `.` or `..` segment, a double slash, or a backslash is treated as not found, and the request continues to `next()`.

Sources: [src/middleware/serve-static/index.ts:54-74](repo://src/middleware/serve-static/index.ts#L54-L74)

The path is built by `join(root, name)`, where `name` is the file name after the optional `rewriteRequestPath` function. `join` defaults to `defaultJoin`, which uses `/` separators and removes empty parts and repeated slashes, and resolves `.` and `..`. If the `isDir` option says the path is a directory, `index.html` is appended.

Sources: [src/middleware/serve-static/index.ts:76-83](repo://src/middleware/serve-static/index.ts#L76-L83), [src/middleware/serve-static/path.ts:1-12](repo://src/middleware/serve-static/path.ts#L1-L12)

## Sending the file

`getContent(path, c)` returns the file body, a complete `Response`, or `null`. A `Response` is returned as the answer, with its own headers. A `null` means the file does not exist: `onNotFound` runs and the chain continues with `next()`.

Sources: [src/middleware/serve-static/index.ts:85-90](repo://src/middleware/serve-static/index.ts#L85-L90), [src/middleware/serve-static/index.ts:122-124](repo://src/middleware/serve-static/index.ts#L122-L124)

A body gets its `Content-Type` from the file extension through `getMimeType`, with the `mimes` option taking priority. An unknown extension gets `application/octet-stream`. The body is sent with `c.body`, and `onFound` runs before that.

Sources: [src/middleware/serve-static/index.ts:92-95](repo://src/middleware/serve-static/index.ts#L92-L95), [src/middleware/serve-static/index.ts:118-119](repo://src/middleware/serve-static/index.ts#L118-L119)

## Precompressed files

With `precompressed` set, the middleware looks for a `.br`, `.zst` or `.gz` copy of a compressible file when the client's `Accept-Encoding` lists that encoding. The order is Brotli, Zstandard, then gzip. The first copy found is sent with `Content-Encoding` set, and `Vary: Accept-Encoding` is added.

Sources: [src/middleware/serve-static/index.ts:23-28](repo://src/middleware/serve-static/index.ts#L23-L28), [src/middleware/serve-static/index.ts:96-117](repo://src/middleware/serve-static/index.ts#L96-L117)

## Runtime adapters

The Bun adapter's `getContent` returns a `Bun.file` when the file exists and `null` otherwise. Its `isDir` uses `stat` from `node:fs/promises`, and it passes `join` from `node:path` as the join function, which the core's `defaultJoin` comment recommends for Windows paths.

Sources: [src/adapter/bun/serve-static.ts:8-31](repo://src/adapter/bun/serve-static.ts#L8-L31)

The Deno adapter uses `Deno.open` and returns the file's readable stream. It checks directories with `lstatSync` first, and returns `null` for a directory or a missing file. Any other open error is logged with `console.warn`.

Sources: [src/adapter/deno/serve-static.ts:8-33](repo://src/adapter/deno/serve-static.ts#L8-L33)

The Cloudflare Workers adapter's `serveStatic` is marked deprecated, and the comment points to Cloudflare Static Assets. Its `getContent` reads from a KV asset namespace, taken from the `namespace` option or from the `__STATIC_CONTENT` binding, and passes the `manifest` option to the lookup.

Sources: [src/adapter/cloudflare-workers/serve-static.ts:12-42](repo://src/adapter/cloudflare-workers/serve-static.ts#L12-L42)
