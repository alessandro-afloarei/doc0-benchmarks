---
title: "Static Assets and Generation"
---
## Overview

Static serving turns a request path into stored content; static site generation runs registered routes and saves their responses as files. Both connect HTTP behavior to a content loader or filesystem interface. The shared serving middleware delegates storage access to runtime wrappers, while toSSG uses the normal app request pipeline, including the renderers in [[HTML and Server Rendering]].

Sources: [src/middleware/serve-static/index.ts:32-49](repo://src/middleware/serve-static/index.ts#L32-L49), [src/helper/ssg/ssg.ts:243-284](repo://src/helper/ssg/ssg.ts#L243-L284), [src/middleware/jsx-renderer/index.ts:61-79](repo://src/middleware/jsx-renderer/index.ts#L61-L79)

## Resolve a static request

serveStatic first skips work when the context is already finalized. Without an explicit path option, it decodes the request path and rejects dot segments, repeated separators, and backslashes. Invalid paths invoke onNotFound with the original request path and continue to next. An explicit path bypasses this request-path check; rewriteRequestPath runs only when no fixed path was provided, after validation.

Sources: [src/middleware/serve-static/index.ts:50-79](repo://src/middleware/serve-static/index.ts#L50-L79)

The middleware joins the root, which defaults to ./, with the selected filename. If the runtime's isDir says the result is a directory, it appends index.html. The default join normalizes slashes and dot segments using slash separators; its source explicitly excludes Windows path support. Bun and Deno wrappers supply node:path join instead. Fixed paths and rewritten paths are application configuration, not inputs rechecked by the request-path guard.

Sources: [src/middleware/serve-static/index.ts:50-86](repo://src/middleware/serve-static/index.ts#L50-L86), [src/middleware/serve-static/path.ts:1-25](repo://src/middleware/serve-static/path.ts#L1-L25), [src/adapter/bun/serve-static.ts:25-30](repo://src/adapter/bun/serve-static.ts#L25-L30), [src/adapter/deno/serve-static.ts:35-40](repo://src/adapter/deno/serve-static.ts#L35-L40)

getContent may return data, a Response, or null. A Response is immediately wrapped through c.newResponse, bypassing MIME selection and onFound. Ordinary content receives a MIME type from custom mappings or built-in mappings, falling back to application/octet-stream, then invokes onFound before returning c.body. A missing resource invokes onNotFound and awaits downstream middleware, allowing another handler to produce the response.

Sources: [src/middleware/serve-static/index.ts:85-125](repo://src/middleware/serve-static/index.ts#L85-L125)

## Choose a runtime content loader

| Loader | Storage operation | Missing-content behavior |
| --- | --- | --- |
| Bun serveStatic | Bun.file plus file.exists; stat identifies directories | Returns null when the file does not exist |
| Deno serveStatic | Deno.open supplies file.readable; lstatSync identifies directories | Returns null on open failure and warns for errors other than NotFound |
| Workers serveStatic | Resolves a manifest key and fetches a KV stream | Returns null for a missing key or content |
| Pages serveStatic | Calls the ASSETS binding's fetch with the raw request | Converts an asset 404 through c.notFound |

Sources: [src/adapter/bun/serve-static.ts:8-32](repo://src/adapter/bun/serve-static.ts#L8-L32), [src/adapter/deno/serve-static.ts:6-42](repo://src/adapter/deno/serve-static.ts#L6-L42), [src/adapter/cloudflare-workers/utils.ts:11-50](repo://src/adapter/cloudflare-workers/utils.ts#L11-L50), [src/adapter/cloudflare-pages/handler.ts:114-123](repo://src/adapter/cloudflare-pages/handler.ts#L114-L123)

The Workers KV wrapper accepts a manifest object or JSON string and a namespace override, otherwise consulting bindings and global asset values. This serveStatic export is marked deprecated in its source. Pages uses a separate ASSETS fetch path, so its behavior does not pass through the shared filesystem middleware. [[Runtime Adapters]] explains how Pages installs the bindings that make that asset call possible.

Sources: [src/adapter/cloudflare-workers/serve-static.ts:6-40](repo://src/adapter/cloudflare-workers/serve-static.ts#L6-L40), [src/adapter/cloudflare-workers/utils.ts:17-37](repo://src/adapter/cloudflare-workers/utils.ts#L17-L37), [src/adapter/cloudflare-pages/handler.ts:32-46](repo://src/adapter/cloudflare-pages/handler.ts#L32-L46), [src/adapter/cloudflare-pages/handler.ts:114-123](repo://src/adapter/cloudflare-pages/handler.ts#L114-L123)

## Serve precompressed files

With precompressed enabled, the shared middleware probes compressed variants only after finding the original resource and determining that its MIME type is compressible or unknown. It checks br, zstd, then gzip, looking for .br, .zst, and .gz files. A found variant replaces the body, sets Content-Encoding, and appends Accept-Encoding to Vary; the MIME type remains the original file's type.

Sources: [src/middleware/serve-static/index.ts:23-28](repo://src/middleware/serve-static/index.ts#L23-L28), [src/middleware/serve-static/index.ts:92-119](repo://src/middleware/serve-static/index.ts#L92-L119)

Accept-Encoding is split on commas and trimmed into a Set. Selection uses exact membership, without parsing quality values: a token such as gzip;q=1 does not match gzip. The ordering is the implementation's fixed encoding order, not the header's order. onFound receives the original resolved path even when a compressed sibling supplied the body.

Sources: [src/middleware/serve-static/index.ts:96-119](repo://src/middleware/serve-static/index.ts#L96-L119)

## Enumerate generated routes

toSSG is experimental and accepts an app, a filesystem module, and options. It defaults to ./static and concurrency 2. Route discovery selects GET and ALL registrations whose target handler is not classified as middleware; that classification uses function arity greater than one, after unwrapping composed handlers. Discovery reads registered routes rather than crawling links in rendered HTML.

Sources: [src/helper/ssg/ssg.ts:17-36](repo://src/helper/ssg/ssg.ts#L17-L36), [src/helper/ssg/ssg.ts:363-372](repo://src/helper/ssg/ssg.ts#L363-L372), [src/helper/ssg/ssg.ts:420-435](repo://src/helper/ssg/ssg.ts#L420-L435), [src/helper/ssg/utils.ts:61-75](repo://src/helper/ssg/utils.ts#L61-L75), [src/utils/handler.ts:8-15](repo://src/utils/handler.ts#L8-L15)

Each candidate first receives a localhost request through app.fetch with HONO_SSG_CONTEXT set in bindings. ssgParams recognizes a dynamic path, writes its parameter array onto the raw request, and returns notFound to prevent later handlers running during this discovery request. The array can be supplied directly or generated asynchronously from the context. Dynamic candidates without parameters are skipped; static candidates receive one empty parameter object.

Sources: [src/helper/ssg/ssg.ts:222-250](repo://src/helper/ssg/ssg.ts#L222-L250), [src/helper/ssg/middleware.ts:24-49](repo://src/helper/ssg/middleware.ts#L24-L49), [src/helper/ssg/utils.ts:73-75](repo://src/helper/ssg/utils.ts#L73-L75)

The generator substitutes each parameter set, then makes a second request with the discovery request's method and headers and the SSG binding. Consequently, a static route can execute during discovery and again during content collection. Responses carrying x-hono-disable-ssg are skipped before response hooks. disableSSG emits this marker only during generation; onlySSG returns notFound outside generation.

Sources: [src/helper/ssg/ssg.ts:243-284](repo://src/helper/ssg/ssg.ts#L243-L284), [src/helper/ssg/middleware.ts:56-83](repo://src/helper/ssg/middleware.ts#L56-L83)

## Transform and filter generation

Plugins expose beforeRequestHook, afterResponseHook, and afterGenerateHook. Request and response hook arrays run sequentially, passing replacements forward and stopping when a hook returns false. beforeRequestHook acts on the discovery request, rather than independently on every expanded parameter request. Deprecated top-level hooks are still collected before plugin hooks.

Sources: [src/helper/ssg/ssg.ts:110-179](repo://src/helper/ssg/ssg.ts#L110-L179), [src/helper/ssg/ssg.ts:181-198](repo://src/helper/ssg/ssg.ts#L181-L198), [src/helper/ssg/ssg.ts:229-240](repo://src/helper/ssg/ssg.ts#L229-L240), [src/helper/ssg/ssg.ts:372-419](repo://src/helper/ssg/ssg.ts#L372-L419)

When plugins is omitted, defaultPlugin skips responses whose status is not 200. Providing a plugins array replaces that default, including when the array is empty. redirectPlugin converts supported redirect responses with a Location header into 200 HTML redirect pages. Place it before defaultPlugin so the status filter sees the converted response; the following call is the ordering shown in the plugin source.

Sources: [src/helper/ssg/ssg.ts:372-375](repo://src/helper/ssg/ssg.ts#L372-L375), [src/helper/ssg/plugins.ts:11-22](repo://src/helper/ssg/plugins.ts#L11-L22), [src/helper/ssg/plugins.ts:38-72](repo://src/helper/ssg/plugins.ts#L38-L72)

```ts
toSSG(app, fs, { plugins: [redirectPlugin(), defaultPlugin()] })
```

Sources: [src/helper/ssg/plugins.ts:43-48](repo://src/helper/ssg/plugins.ts#L43-L48)

## Write output and handle failures

Content-Type determines the extension after its parameters are removed, with text/plain used when absent. The extension map handles HTML, XML-family formats, and YAML; a custom map replaces it, with MIME lookup and finally html as fallbacks. Root and trailing-slash paths become index files; other paths receive an extension unless already present. The normalized output path must remain inside the output directory or generation throws.

Sources: [src/helper/ssg/ssg.ts:19-25](repo://src/helper/ssg/ssg.ts#L19-L25), [src/helper/ssg/ssg.ts:50-108](repo://src/helper/ssg/ssg.ts#L50-L108), [src/helper/ssg/ssg.ts:282-284](repo://src/helper/ssg/ssg.ts#L282-L284), [src/helper/ssg/utils.ts:77-87](repo://src/helper/ssg/utils.ts#L77-L87)

The filesystem contract requires asynchronous writeFile and recursive mkdir. Response text or JSON is read as a string; other bodies become ArrayBuffers and are written as Uint8Array. Directory creation is tracked by an in-memory set. Bun's wrapper supplies Bun.write and a no-op mkdir; Deno's wrapper encodes strings and calls Deno.writeFile and Deno.mkdir.

Sources: [src/helper/ssg/ssg.ts:34-37](repo://src/helper/ssg/ssg.ts#L34-L37), [src/helper/ssg/ssg.ts:74-87](repo://src/helper/ssg/ssg.ts#L74-L87), [src/helper/ssg/ssg.ts:309-334](repo://src/helper/ssg/ssg.ts#L309-L334), [src/adapter/bun/ssg.ts:13-27](repo://src/adapter/bun/ssg.ts#L13-L27), [src/adapter/deno/ssg.ts:9-27](repo://src/adapter/deno/ssg.ts#L9-L27)

toSSG returns success and generated file paths, or success false with an empty files list and an Error. That failure result does not roll back files already written. afterGenerate hooks run after this result is formed, on either success or failure, and their errors can reject the call because they execute outside the generation catch block.

Sources: [src/helper/ssg/ssg.ts:436-470](repo://src/helper/ssg/ssg.ts#L436-L470)

