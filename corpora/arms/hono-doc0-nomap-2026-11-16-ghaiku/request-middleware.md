---
title: "Request Middleware"
---
## Overview

A request middleware looks at the request before the rest of the chain runs. It may refuse the request, rewrite it, or record something about it, and then calls `next()`. The built-in middlewares in this group guard the origin of a request, limit its size, set its method, give it an ID, rewrite its path, or time it out. The condition helpers in `combine` decide whether another middleware runs at all. This page is a catalogue of these middlewares. The authentication ones are on [[Authentication Middleware]], and the ones that change the response are on [[Response Middleware]].

Sources: [src/middleware/cors/index.ts:96-101](repo://src/middleware/cors/index.ts#L96-L101), [src/middleware/body-limit/index.ts:61-74](repo://src/middleware/body-limit/index.ts#L61-L74)

## Origin checks

`cors` sets the `Access-Control-Allow-Origin` header from the `Origin` request header. The `origin` option can be `*`, one string, a list of strings, or a function that returns the origin to allow. The `*` default answers every origin. A preflight `OPTIONS` request is answered at once with status 204, and the allowed methods and headers are set on that response before it is returned, so the handler never runs for it.

Sources: [src/middleware/cors/index.ts:63-84](repo://src/middleware/cors/index.ts#L63-L84), [src/middleware/cors/index.ts:114-148](repo://src/middleware/cors/index.ts#L114-L148)

For a non-preflight request, `cors` sets the origin and credential headers before `next()`, and adds `Vary: Origin` after it when the origin is not `*`, so a shared cache keeps the answers apart.

Sources: [src/middleware/cors/index.ts:101-112](repo://src/middleware/cors/index.ts#L101-L112), [src/middleware/cors/index.ts:149-154](repo://src/middleware/cors/index.ts#L149-L154)

`csrf` refuses a request that could come from a form on another site. It checks only methods other than `GET` and `HEAD`, and only when the content type is a form type (`application/x-www-form-urlencoded`, `multipart/form-data` or `text/plain`). The request passes if its `Sec-Fetch-Site` header is `same-origin` by default, or if its `Origin` is the app's own origin. Otherwise it gets a 403.

Sources: [src/middleware/csrf/index.ts:138-150](repo://src/middleware/csrf/index.ts#L138-L150), [src/middleware/csrf/index.ts:94-125](repo://src/middleware/csrf/index.ts#L94-L125)

`ipRestriction` compares the client address with a list of rules. A rule is an IPv4 or IPv6 address, a CIDR range, or a function. The rules are compiled once, into sets of exact addresses and lists of ranges, so each request is checked against prepared data. The client address comes from the runtime's connection info, as [[Runtime Adapters]] describes.

Sources: [src/middleware/ip-restriction/index.ts:23-38](repo://src/middleware/ip-restriction/index.ts#L23-L38), [src/middleware/ip-restriction/index.ts:51-80](repo://src/middleware/ip-restriction/index.ts#L51-L80), [src/middleware/ip-restriction/index.ts:218-218](repo://src/middleware/ip-restriction/index.ts#L218-L218)

## Size and method

`bodyLimit` refuses a body larger than `maxSize` with status 413. When the request has a `Content-Length` and no `Transfer-Encoding`, that header is compared first and the body is not read. Otherwise the body is read in chunks, and the read stops as soon as the total passes the limit. The read chunks are put into a new `Request`, so the handler can read the body again. The default refusal throws an `HTTPException` with status 413 and the text `Payload Too Large`, and `onError` can replace that response.

Sources: [src/middleware/body-limit/index.ts:50-74](repo://src/middleware/body-limit/index.ts#L50-L74), [src/middleware/body-limit/index.ts:81-110](repo://src/middleware/body-limit/index.ts#L81-L110)

`methodOverride` changes the method of a non-`GET` request to the value of a form field, a header or a query parameter, whichever option is set. For a form body it reads the form, takes the method from the `_method` field by default, and sends a new request with that method through `app.fetch`. The header and query forms do the same with the header or the query value, and remove that header or parameter from the new request. `GET` requests are passed on without change.

Sources: [src/middleware/method-override/index.ts:33-34](repo://src/middleware/method-override/index.ts#L33-L34), [src/middleware/method-override/index.ts:60-97](repo://src/middleware/method-override/index.ts#L60-L97), [src/middleware/method-override/index.ts:106-136](repo://src/middleware/method-override/index.ts#L106-L136)

## Identity and paths

`requestId` reuses the value of the `X-Request-Id` header when it is at most `limitLength` characters and contains only word characters, hyphens and equals signs. Otherwise it generates one with `crypto.randomUUID`. The value is stored with `c.set('requestId', ...)` and written to the response header before `next()` runs.

Sources: [src/middleware/request-id/request-id.ts:41-58](repo://src/middleware/request-id/request-id.ts#L41-L58)

`trimTrailingSlash` removes a trailing slash from a `GET` path. With `alwaysRedirect` it redirects with a 301 before running the chain. Without it, the middleware runs the chain and redirects only when the result is a 404. `appendTrailingSlash` is the reverse, and its `skip` option names paths that must not get one.

Sources: [src/middleware/trailing-slash/index.ts:44-74](repo://src/middleware/trailing-slash/index.ts#L44-L74), [src/middleware/trailing-slash/index.ts:128-150](repo://src/middleware/trailing-slash/index.ts#L128-L150)

## Time and logs

`timeout(duration, exception)` races the rest of the chain against a timer. If the timer fires first, the exception is thrown, and its default is an `HTTPException` with status 504 and the message `Gateway Timeout`. The timer is cleared when the chain finishes. The chain itself is not cancelled, so a handler that keeps running is not stopped.

Sources: [src/middleware/timeout/index.ts:12-14](repo://src/middleware/timeout/index.ts#L12-L14), [src/middleware/timeout/index.ts:38-58](repo://src/middleware/timeout/index.ts#L38-L58)

`logger` writes one line when the request arrives, with the method and the path, and one line after the chain, with the status and the elapsed time. It prints through the function it is given, which defaults to `console.log`, and colours the status by its first digit when colour is enabled.

Sources: [src/middleware/logger/index.ts:50-63](repo://src/middleware/logger/index.ts#L50-L63), [src/middleware/logger/index.ts:81-91](repo://src/middleware/logger/index.ts#L81-L91), [src/middleware/logger/index.ts:28-46](repo://src/middleware/logger/index.ts#L28-L46)

## Conditions

`some(...)` runs its middleware in turn until one succeeds: a middleware that returns `true` or calls `next()` ends the list, and one that returns `false` moves on to the next. If none succeeds, the last error is thrown. `every(...)` runs all of them in order through `compose`, and a condition that returns `false` throws `Unmet condition`. `except(condition, ...middleware)` runs the middleware for every request that does not match the condition, which can be a path pattern or a function.

Sources: [src/middleware/combine/index.ts:38-69](repo://src/middleware/combine/index.ts#L38-L69), [src/middleware/combine/index.ts:99-117](repo://src/middleware/combine/index.ts#L99-L117), [src/middleware/combine/index.ts:141-150](repo://src/middleware/combine/index.ts#L141-L150)
