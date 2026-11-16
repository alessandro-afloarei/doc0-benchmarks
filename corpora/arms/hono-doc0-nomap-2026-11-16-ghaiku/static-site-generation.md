---
title: "Static Site Generation"
---
## Overview

`toSSG` runs an app's GET routes once, and writes each response to a file under an output directory, so that the site can be served without the app. It takes the app, a file system object and options. The work is split in two: a generator walks the routes and starts a request for each one, and a second pass writes the results to disk. Hooks and plugins change which responses are kept, and three middlewares change what a route does during generation. This page covers that flow. Serving the generated files later is on [[Serving Static Files]].

Sources: [src/helper/ssg/ssg.ts:368-375](repo://src/helper/ssg/ssg.ts#L368-L375), [src/helper/ssg/ssg.ts:27-27](repo://src/helper/ssg/ssg.ts#L27-L27)

## Choosing the routes

`filterStaticGenerateRoutes` takes the app's `routes` list and keeps the routes whose method is `GET` or `ALL`, and whose handler is not middleware. The handler is first resolved with `findTargetHandler`, so a sub-app's wrapper is judged by the handler it wraps.

Sources: [src/helper/ssg/utils.ts:61-71](repo://src/helper/ssg/utils.ts#L61-L71), [src/helper/ssg/utils.ts:73-75](repo://src/helper/ssg/utils.ts#L73-L75)

For each route, `fetchRoutesContent` builds a request to `http://localhost` plus the route path, and runs the before-request hook on it. A hook that returns a falsy value skips the route. The request is then sent through the app, and the response goes through the after-response hook before it is turned into content.

Sources: [src/helper/ssg/ssg.ts:205-240](repo://src/helper/ssg/ssg.ts#L205-L240)

## Hooks and plugins

`toSSG` gathers the hooks from three places: the `beforeRequestHook`, `afterResponseHook` and `afterGenerateHook` options, which each take a function or a list, then the same three hooks of every plugin. The hooks of each kind are combined into one function. A request hook runs in the order it was added, and a response hook runs in the same order.

Sources: [src/helper/ssg/ssg.ts:372-419](repo://src/helper/ssg/ssg.ts#L372-L419)

The default plugin is used when no plugin is given. It returns `false` for any response that is not status 200, so the route is not written. `redirectPlugin` turns a 301, 302, 303, 307 or 308 response into a small HTML page with a refresh and a link to the target. The `redirectPlugin` docs say it must come before `defaultPlugin` in the list, because the default one would drop the redirect first.

Sources: [src/helper/ssg/plugins.ts:11-20](repo://src/helper/ssg/plugins.ts#L11-L20), [src/helper/ssg/plugins.ts:22-54](repo://src/helper/ssg/plugins.ts#L22-L54)

## Writing the files

`toSSG` iterates the route generator, and for each route that was kept it queues `saveContentToFile` for each piece of content. The writes run in parallel, and after all the route work has finished, each save is awaited in order. The first failed save ends the run with `success: false` and an empty `files` list; otherwise the result lists every written path.

Sources: [src/helper/ssg/ssg.ts:430-469](repo://src/helper/ssg/ssg.ts#L430-L469)

`saveContentToFile` skips a route whose data is missing, so a dropped response writes no file. It makes the directory with `mkdir` the first time it sees it, and writes a string or an `ArrayBuffer` with `writeFile`. The output directory defaults to `./static`.

Sources: [src/helper/ssg/ssg.ts:310-334](repo://src/helper/ssg/ssg.ts#L310-L334), [src/helper/ssg/ssg.ts:27-27](repo://src/helper/ssg/ssg.ts#L27-L27)

## Middleware used during generation

`ssgParams(params)` is for a dynamic route such as `/posts/:id`. When it runs, it stores the list of parameter sets on the request, either given directly or returned by a function, and then answers 404 so the handler does not run. The generator reads that list to request each concrete path.

Sources: [src/helper/ssg/middleware.ts:43-49](repo://src/helper/ssg/middleware.ts#L43-L49), [src/helper/ssg/utils.ts:73-75](repo://src/helper/ssg/utils.ts#L73-L75)

`isSSGContext` checks the `HONO_SSG_CONTEXT` binding. `disableSSG` answers 404 during generation and adds the `x-hono-disable-ssg` header on the response. `onlySSG` answers 404 outside generation, so a route exists only in the static output.

Sources: [src/helper/ssg/middleware.ts:5-6](repo://src/helper/ssg/middleware.ts#L5-L6), [src/helper/ssg/middleware.ts:56-83](repo://src/helper/ssg/middleware.ts#L56-L83)
