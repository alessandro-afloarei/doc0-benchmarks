---
title: "Static Site Generation"
---
## Overview

`toSSG` runs the app once per static route and writes each response to a file. It does not start a server: it calls `app.fetch` and `app.request` directly, so the same handlers that serve requests produce the files. Runtime-specific file access comes from the `fs` argument, which the adapters supply as described in [[Runtime Adapters]].

Sources: [src/helper/ssg/ssg.ts:368-375](repo://src/helper/ssg/ssg.ts#L368-L375), [src/helper/ssg/ssg.ts:34-42](repo://src/helper/ssg/ssg.ts#L34-L42)

## Choosing routes and hooks

`toSSG` collects three kinds of hooks: before-request, after-response and after-generate. Each can be given as a single function or an array in `options`, and each plugin can add its own. The plugin list defaults to one plugin, which drops every response whose status is not 200.

Sources: [src/helper/ssg/ssg.ts:368-412](repo://src/helper/ssg/ssg.ts#L368-L412), [src/helper/ssg/plugins.ts:11-20](repo://src/helper/ssg/plugins.ts#L11-L20)

The generator `fetchRoutesContent` walks the app's static routes with `filterStaticGenerateRoutes`. For each route it first sends a request marked with the SSG context and reads the `ssgParams` the handler set. A dynamic route with no params is skipped, and a static route without params is generated once with empty params.

Sources: [src/helper/ssg/ssg.ts:205-240](repo://src/helper/ssg/ssg.ts#L205-L240), [src/helper/ssg/utils.ts:61-80](repo://src/helper/ssg/utils.ts#L61-L80)

## Requesting each page

For each param set, the route path is filled in with `replaceUrlParam`, and the page is requested with `app.request`. The request passes the SSG context as bindings. A response carrying the disable header is dropped, and the after-response hooks may return `false` to drop the page or return a different response.

Sources: [src/helper/ssg/ssg.ts:246-270](repo://src/helper/ssg/ssg.ts#L246-L270)

The response is turned into content by `parseResponseContent`, and its `Content-Type` gives the MIME type. The result is passed on as `routePath`, `mimeType` and `content`. A failed request rejects that page's promise, and `toSSG` throws that error only after the remaining pages have been requested.

Sources: [src/helper/ssg/ssg.ts:262-285](repo://src/helper/ssg/ssg.ts#L262-L285), [src/helper/ssg/ssg.ts:74-88](repo://src/helper/ssg/ssg.ts#L74-L88), [src/helper/ssg/ssg.ts:440-455](repo://src/helper/ssg/ssg.ts#L440-L455)

Requests run through a pool created with the `concurrency` value that `toSSG` passes in, which defaults to `DEFAULT_CONCURRENCY`. The pool limits how many `app.fetch` and `app.request` calls run at once across all routes.

Sources: [src/helper/ssg/ssg.ts:223-223](repo://src/helper/ssg/ssg.ts#L223-L223), [src/helper/ssg/ssg.ts:17-18](repo://src/helper/ssg/ssg.ts#L17-L18)

## Writing files

`toSSG` consumes the generator, and each page's save promise is started as soon as its content is ready. After every request has finished, it waits for the saves in order and collects the written paths. The first save error stops the result and is thrown.

Sources: [src/helper/ssg/ssg.ts:420-455](repo://src/helper/ssg/ssg.ts#L420-L455)

`saveContentToFile` creates the directory once per path, then writes the string or the buffer. `generateFilePath` maps a route to a file: a route ending in the extension is used as is, `/` becomes `index`, a route ending in `/` becomes `index` inside that folder, and any other route gets the extension. The path must stay inside the output directory, and `ensureWithinOutDir` throws otherwise.

Sources: [src/helper/ssg/ssg.ts:310-339](repo://src/helper/ssg/ssg.ts#L310-L339), [src/helper/ssg/ssg.ts:50-72](repo://src/helper/ssg/ssg.ts#L50-L72)

## Pages

- [[Runtime Adapters]] lists the runtime file system modules that `fs` comes from.
- [[Built-in Middleware]] lists `serveStatic`, which serves the same files at run time.

Sources: [src/adapter/bun/ssg.ts:1-27](repo://src/adapter/bun/ssg.ts#L1-L27)
